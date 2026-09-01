import { authedFetch } from './apiClient'

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `request failed (${res.status})`)
  }
  return res.json()
}

export type AttachmentKind = 'image' | 'voice' | 'file'

export interface UploadedAttachment {
  path: string
  mime: string
  size: number
}

// Uploads can be up to 25MB on a slow connection — apiClient's default 15s
// timeout is tuned for small JSON calls, not this.
const UPLOAD_TIMEOUT_MS = 60_000

export async function uploadAttachment(connectionId: string, kind: AttachmentKind, file: Blob): Promise<UploadedAttachment> {
  const res = await authedFetch(`/api/connections/${connectionId}/attachments?kind=${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  })
  return unwrap<UploadedAttachment>(res)
}

// Server-signed URLs last 1h (attachmentService.signAttachments); cache a bit
// short of that so a URL already close to expiry is never handed back.
const SIGNED_URL_TTL_MS = 55 * 60 * 1000
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()

export async function getSignedUrls(connectionId: string, paths: string[]): Promise<Record<string, string>> {
  const now = Date.now()
  const result: Record<string, string> = {}
  const toFetch: string[] = []
  for (const path of paths) {
    const cached = signedUrlCache.get(path)
    if (cached && cached.expiresAt > now) result[path] = cached.url
    else toFetch.push(path)
  }
  if (!toFetch.length) return result

  const res = await authedFetch(`/api/connections/${connectionId}/attachments/signed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: toFetch }),
  })
  const body = await unwrap<{ urls: Record<string, string> }>(res)
  for (const [path, url] of Object.entries(body.urls ?? {})) {
    signedUrlCache.set(path, { url, expiresAt: now + SIGNED_URL_TTL_MS })
    result[path] = url
  }
  return result
}
