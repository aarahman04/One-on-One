// GIPHY search, proxied so the API key stays on the server (GIPHY_API_KEY).
// Sending a GIF: the server fetches the chosen GIF by GIPHY id from GIPHY's own
// media host and stores it as a normal image/gif attachment of the caller's
// connection — the message then goes through the existing image flow, and the
// client never fetches an arbitrary URL on the server's behalf.

import { ConnectionError } from '../utils/connectionError.js'
import { uploadAttachment, maxBytesFor } from './attachmentService.js'

const API = 'https://api.giphy.com/v1/gifs'
const PAGE = 24
const TIMEOUT_MS = 8_000
const CACHE_MS = 10 * 60_000
const ID_RE = /^[A-Za-z0-9]{1,64}$/

export interface GifResult {
  id: string
  title: string
  previewUrl: string
  width: number
  height: number
}

interface GiphyImage { url?: string; width?: string; height?: string }
interface GiphyGif { id?: string; title?: string; images?: Record<string, GiphyImage | undefined> }

function apiKey(): string {
  const key = process.env.GIPHY_API_KEY
  if (!key) throw new ConnectionError(503, 'gif search is not configured')
  return key
}

// Only GIPHY's media CDN over https; anything else in a response is ignored.
export function isGiphyMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'giphy.com' || url.hostname.endsWith('.giphy.com')) && !url.port
  } catch {
    return false
  }
}

export function toResult(gif: GiphyGif): GifResult | null {
  const preview = gif.images?.fixed_width
  if (!gif.id || !ID_RE.test(gif.id) || !preview || !isGiphyMediaUrl(preview.url)) return null
  return {
    id: gif.id,
    title: (gif.title ?? '').slice(0, 120),
    previewUrl: preview.url,
    width: Number(preview.width) || 200,
    height: Number(preview.height) || 200,
  }
}

const cache = new Map<string, { at: number; value: { results: GifResult[]; next: number | null } }>()

async function giphy(path: string, params: Record<string, string>): Promise<{ data?: unknown; pagination?: { total_count?: number; count?: number; offset?: number } }> {
  const url = new URL(`${API}/${path}`)
  for (const [k, v] of Object.entries({ ...params, api_key: apiKey() })) url.searchParams.set(k, v)
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
  if (!response.ok) throw new ConnectionError(502, 'gif search failed')
  return (await response.json()) as { data?: unknown; pagination?: { total_count?: number; count?: number; offset?: number } }
}

/** Trending when [query] is empty, else search. Rated "pg". */
export async function searchGifs(query: unknown, offset: unknown): Promise<{ results: GifResult[]; next: number | null }> {
  const q = typeof query === 'string' ? query.trim().slice(0, 50) : ''
  const start = Math.min(Math.max(Number.parseInt(String(offset ?? '0'), 10) || 0, 0), 4_975)
  const key = `${q.toLowerCase()}|${start}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value

  const body = q
    ? await giphy('search', { q, limit: String(PAGE), offset: String(start), rating: 'pg', lang: 'en' })
    : await giphy('trending', { limit: String(PAGE), offset: String(start), rating: 'pg' })
  const results = (Array.isArray(body.data) ? body.data : []).map((g) => toResult(g as GiphyGif)).filter((r): r is GifResult => !!r)
  const count = body.pagination?.count ?? results.length
  const total = body.pagination?.total_count ?? 0
  const value = { results, next: count > 0 && start + count < Math.min(total, 5_000) ? start + count : null }
  if (cache.size > 500) cache.clear()
  cache.set(key, { at: Date.now(), value })
  return value
}

export function isGif(buffer: Buffer): boolean {
  const head = buffer.toString('ascii', 0, 6)
  return buffer.length >= 10 && (head === 'GIF87a' || head === 'GIF89a')
}

/** Logical screen size from the GIF header (bytes 6–9, little-endian): the image payload needs width/height. */
export function gifSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
}

async function download(url: string, maxBytes: number): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS * 2), redirect: 'error' })
  if (!response.ok || !response.body) throw new ConnectionError(502, 'could not fetch that gif')
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw new ConnectionError(400, 'gif is too large')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length
    if (size > maxBytes) throw new ConnectionError(400, 'gif is too large')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/** Fetch GIPHY gif [id] and store it as an image/gif attachment of [connectionId]. Membership is checked by the route. */
export async function attachGif(connectionId: string, id: unknown): Promise<{ path: string; mime: string; size: number; width: number; height: number }> {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new ConnectionError(400, 'invalid gif id')
  const body = await giphy(id, {})
  const images = (body.data as GiphyGif | undefined)?.images
  // Largest rendition that stays well under the image cap.
  const source = [images?.downsized_medium, images?.downsized, images?.fixed_width].find((i) => i && isGiphyMediaUrl(i.url))
  if (!source?.url) throw new ConnectionError(404, 'gif not found')
  const buffer = await download(source.url, maxBytesFor('image'))
  if (!isGif(buffer)) throw new ConnectionError(502, 'could not fetch that gif')
  const { width, height } = gifSize(buffer)
  if (width < 1 || height < 1 || width > 20_000 || height > 20_000) throw new ConnectionError(502, 'could not fetch that gif')
  return { ...(await uploadAttachment(connectionId, 'image', buffer, 'image/gif')), width, height }
}
