import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import zlib from 'node:zlib'
import { ConnectionError } from './connectionService.js'

// Link previews (title + cover art / favicon) fetched by the SERVER, so the
// linked site never sees a reader's IP and the phone never fetches arbitrary
// URLs. The server is the one exposed instead, so every fetch is SSRF-guarded:
// http(s) on 80/443 only, every resolved address must be public (checked at
// connect time, so DNS rebinding can't swap in an internal address), manual
// redirects re-checked hop by hop, hard size and time caps.

export interface LinkPreview {
  url: string
  title: string | null
  description: string | null
  siteName: string
  // base64 image bytes (cover art / og:image, or the site's icon), or null.
  image: string | null
  imageMime: string | null
  imageKind: 'cover' | 'icon' | null
}

const TIMEOUT_MS = 10_000 // whole preview: page + image, every redirect included
const MAX_HTML_BYTES = 768 * 1024
const MAX_IMAGE_BYTES = 600_000
const MAX_REDIRECTS = 3
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon']
// Sites hand their Open Graph tags (and skip bot walls) for messenger link
// previews, so ask like one first; a plain browser-ish agent is the fallback.
const USER_AGENTS = ['WhatsApp/2.23.20.0', 'Mozilla/5.0 (compatible; OneOnOneLinkPreview/1.0)']

function ipv4Public(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
  if (a === 169 && b === 254) return false // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 168 || b === 0)) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  return true
}

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4Public(ip)
  if (!net.isIPv6(ip)) return false
  const v6 = ip.toLowerCase()
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return ipv4Public(mapped[1])
  if (v6 === '::' || v6 === '::1') return false
  if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff')) return false // ULA, link-local, multicast
  if (v6.startsWith('64:ff9b:') || v6.startsWith('2002:')) return false // NAT64 / 6to4 can embed private v4
  return true
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void
function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '')
    const list = addresses as dns.LookupAddress[]
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      return callback(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }), '')
    }
    if (options.all) callback(null, list)
    else callback(null, list[0].address, list[0].family)
  })
}

export function checkUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConnectionError(400, 'invalid url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ConnectionError(400, 'invalid url')
  if (url.port && url.port !== '80' && url.port !== '443') throw new ConnectionError(400, 'invalid url')
  if (url.username || url.password) throw new ConnectionError(400, 'invalid url')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host) && !isPublicAddress(host)) throw new ConnectionError(400, 'invalid url')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new ConnectionError(400, 'invalid url')
  }
  return url
}

interface Fetched {
  url: URL
  mime: string
  body: Buffer
}

function fetchOnce(url: URL, maxBytes: number, accept: string, deadline: number, userAgent: string): Promise<{ status: number; location?: string; mime: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const req = client.get(url, {
      lookup: safeLookup as unknown as typeof dns.lookup,
      headers: { 'user-agent': userAgent, accept, 'accept-encoding': 'gzip, deflate, br', 'accept-language': 'en' },
      timeout: Math.max(1, deadline - Date.now()),
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400) {
        res.resume()
        return resolve({ status, location: res.headers.location, mime: '', body: Buffer.alloc(0) })
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        // HTML: the <head> is all we need, so keep what fits and stop. Images must be whole.
        if (size > maxBytes) {
          if (accept.startsWith('text/html')) { chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (size - maxBytes)))); res.destroy(); done() }
          else { res.destroy(); reject(new Error('too large')) }
          return
        }
        chunks.push(chunk)
      })
      let finished = false
      const done = () => {
        if (finished) return
        finished = true
        let body = Buffer.concat(chunks)
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase()
        try {
          const opts = { maxOutputLength: maxBytes * 4, finishFlush: zlib.constants.Z_SYNC_FLUSH }
          if (encoding === 'gzip') body = zlib.gunzipSync(body, opts)
          else if (encoding === 'deflate') body = zlib.inflateSync(body, opts)
          else if (encoding === 'br') body = zlib.brotliDecompressSync(body, { maxOutputLength: maxBytes * 4, finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH })
        } catch (err) {
          return reject(err)
        }
        resolve({ status, mime: String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), body })
      }
      res.on('end', done)
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

async function fetchLimited(start: URL, maxBytes: number, accept: string, deadline: number, userAgent: string): Promise<Fetched> {
  let url = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (Date.now() >= deadline) throw new Error('timeout')
    const res = await fetchOnce(url, maxBytes, accept, deadline, userAgent)
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = checkUrl(new URL(res.location, url).toString())
      continue
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`status ${res.status}`)
    return { url, mime: res.mime, body: res.body }
  }
  throw new Error('too many redirects')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '')
  }
  return out
}

function clean(value: string | undefined, max: number): string | null {
  const text = value?.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : null
}

// Pure HTML -> metadata (unit-tested). Relative URLs resolve against `base`.
export function parseMeta(html: string, base: URL): { title: string | null; description: string | null; siteName: string; image: string | null; icon: string } {
  const meta: Record<string, string> = {}
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(m[0])
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase()
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content
  }
  let icon: string | null = null
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attributes(m[0])
    const rel = (a.rel ?? '').toLowerCase()
    if (a.href && /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(rel) && (!icon || rel.includes('apple-touch-icon'))) icon = a.href
  }
  const imageSrc = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => attributes(m[0])).find((a) => (a.rel ?? '').toLowerCase() === 'image_src')?.href
  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
  const resolve = (href: string | null | undefined): string | null => {
    if (!href) return null
    try {
      const u = new URL(href, base)
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
    } catch {
      return null
    }
  }
  return {
    title: clean(meta['og:title'] ?? meta['twitter:title'] ?? (titleTag ? decodeEntities(titleTag) : undefined), 200),
    description: clean(meta['og:description'] ?? meta['twitter:description'] ?? meta.description, 300),
    siteName: clean(meta['og:site_name'], 80) ?? base.hostname.replace(/^www\./, ''),
    image: resolve(meta['og:image:secure_url'] ?? meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'] ?? meta['twitter:image:src'] ?? meta.image ?? imageSrc),
    icon: resolve(icon) ?? new URL('/favicon.ico', base).toString(),
  }
}

async function fetchImage(raw: string | null, deadline: number, userAgent: string): Promise<{ data: string; mime: string } | null> {
  if (!raw) return null
  try {
    const res = await fetchLimited(checkUrl(raw), MAX_IMAGE_BYTES, 'image/*', deadline, userAgent)
    // SVG is never served on: it can carry script.
    if (!IMAGE_MIMES.includes(res.mime) || res.body.length === 0) return null
    return { data: res.body.toString('base64'), mime: res.mime }
  } catch {
    return null
  }
}

const CACHE_TTL_MS = 60 * 60_000
const CACHE_MAX = 300
const cache = new Map<string, { at: number; value: LinkPreview | null }>()

export async function getLinkPreview(raw: unknown): Promise<LinkPreview | null> {
  if (typeof raw !== 'string' || raw.length > 2048) throw new ConnectionError(400, 'invalid url')
  const url = checkUrl(raw)
  const key = url.toString()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const deadline = Date.now() + TIMEOUT_MS
  let value: LinkPreview | null = null
  for (const userAgent of USER_AGENTS) {
    value = await unfurl(url, deadline, userAgent).catch(() => null)
    if (value?.image || Date.now() >= deadline) break
  }
  // TikTok serves no Open Graph to fetchers; its public oEmbed does.
  if (!value?.image && /(^|\.)tiktok\.com$/.test(url.hostname)) value = (await tiktok(url, deadline).catch(() => null)) ?? value
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(key, { at: Date.now(), value })
  return value
}

async function unfurl(url: URL, deadline: number, userAgent: string): Promise<LinkPreview | null> {
  const page = await fetchLimited(url, MAX_HTML_BYTES, 'text/html,application/xhtml+xml', deadline, userAgent)
  if (page.mime !== 'text/html' && page.mime !== 'application/xhtml+xml') return null
  const meta = parseMeta(page.body.toString('utf8'), page.url)
  const cover = await fetchImage(meta.image, deadline, userAgent)
  const icon = cover ? null : await fetchImage(meta.icon, deadline, userAgent)
  const image = cover ?? icon
  if (!meta.title && !image) return null
  return {
    url: page.url.toString(),
    title: meta.title,
    description: meta.description,
    siteName: meta.siteName,
    image: image?.data ?? null,
    imageMime: image?.mime ?? null,
    imageKind: cover ? 'cover' : icon ? 'icon' : null,
  }
}

async function tiktok(url: URL, deadline: number): Promise<LinkPreview | null> {
  const endpoint = new URL('https://www.tiktok.com/oembed')
  endpoint.searchParams.set('url', url.toString())
  const res = await fetchLimited(endpoint, 64 * 1024, 'application/json', deadline, USER_AGENTS[1])
  const data = JSON.parse(res.body.toString('utf8')) as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown }
  const cover = typeof data.thumbnail_url === 'string' ? await fetchImage(data.thumbnail_url, deadline, USER_AGENTS[1]) : null
  const title = clean(typeof data.title === 'string' && data.title ? data.title : typeof data.author_name === 'string' ? data.author_name : undefined, 200)
  if (!title && !cover) return null
  return {
    url: url.toString(), title, description: typeof data.author_name === 'string' ? clean(data.author_name, 300) : null, siteName: 'TikTok',
    image: cover?.data ?? null, imageMime: cover?.mime ?? null, imageKind: cover ? 'cover' : null,
  }
}
