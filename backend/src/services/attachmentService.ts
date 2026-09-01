import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from '../utils/connectionError.js'

export type AttachmentKind = 'image' | 'voice' | 'file'

const BUCKET = 'attachments'

// Mirrors the caps/mime allowlists baked into the Supabase bucket config
// (migration 025) — enforced again here so a rejection is a clean 400 with
// a domain message instead of a raw Storage error.
const LIMITS: Record<AttachmentKind, { maxBytes: number; mimes: Record<string, string> }> = {
  image: {
    maxBytes: 10 * 1024 * 1024,
    mimes: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' },
  },
  voice: {
    maxBytes: 16 * 1024 * 1024,
    mimes: { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3' },
  },
  file: {
    maxBytes: 25 * 1024 * 1024,
    mimes: {
      'application/pdf': 'pdf',
      'text/plain': 'txt',
      'text/csv': 'csv',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    },
  },
}

export function isAttachmentKind(x: unknown): x is AttachmentKind {
  return x === 'image' || x === 'voice' || x === 'file'
}

export function isAllowedMime(kind: AttachmentKind, mime: string): boolean {
  return mime in LIMITS[kind].mimes
}

export function maxBytesFor(kind: AttachmentKind): number {
  return LIMITS[kind].maxBytes
}

// Upload a validated buffer under this connection's prefix. Path shape
// `{connectionId}/{uuid}.{ext}` is what messageService checks the message
// payload's path against before it will let a message reference it.
export async function uploadAttachment(
  connectionId: string,
  kind: AttachmentKind,
  buffer: Buffer,
  mime: string,
): Promise<{ path: string; mime: string; size: number }> {
  const limits = LIMITS[kind]
  const ext = limits.mimes[mime]
  if (!ext) throw new ConnectionError(400, `unsupported ${kind} type`)
  if (buffer.length < 1) throw new ConnectionError(400, 'empty upload')
  if (buffer.length > limits.maxBytes) throw new ConnectionError(400, `${kind} exceeds size limit`)

  const path = `${connectionId}/${randomUUID()}.${ext}`
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, { contentType: mime })
  if (error) throw error

  return { path, mime, size: buffer.length }
}

// Short-lived signed URLs so the private bucket never needs a public policy.
// Every path must belong to the caller's own connection (checked by the
// route before calling this) — this just does the batch sign.
export async function signAttachments(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrls(paths, 3600)
  if (error) throw error

  const urls: Record<string, string> = {}
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl
  }
  return urls
}

// Called from connectionService.terminate() — Storage isn't covered by the
// connections table's FK cascade, so a left connection's media would
// otherwise outlive it (privacy leak). Best-effort: the caller logs and
// swallows failures rather than blocking termination on a Storage hiccup.
export async function deleteConnectionAttachments(connectionId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(connectionId, { limit: 1000 })
  if (error) throw error
  if (!data?.length) return

  const paths = data.map((f) => `${connectionId}/${f.name}`)
  const { error: removeError } = await supabaseAdmin.storage.from(BUCKET).remove(paths)
  if (removeError) throw removeError
}
