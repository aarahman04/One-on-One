import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from '../utils/connectionError.js'
import { getLiveConnectionForUser } from './connectionAccess.js'

const BUCKET = 'attachments'
const UNDEFINED_COLUMN = '42703'
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const AVATAR_MIMES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

// The declared mime must match the file's magic bytes: never store a
// renamed HTML/SVG/whatever as an "image".
export function sniffImage(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

export function validateAvatar(buffer: Buffer, mime: string): string {
  const ext = AVATAR_MIMES[mime]
  if (!ext) throw new ConnectionError(400, 'unsupported image type')
  if (buffer.length < 1) throw new ConnectionError(400, 'empty upload')
  if (buffer.length > AVATAR_MAX_BYTES) throw new ConnectionError(400, 'image exceeds size limit')
  if (sniffImage(buffer) !== mime) throw new ConnectionError(400, 'unsupported image type')
  return ext
}

/** Opaque id of the current photo (changes on every replace), so clients know when to refetch. */
export function avatarId(path: string | null | undefined): string | null {
  return path ? path.slice(path.lastIndexOf('/') + 1, path.lastIndexOf('.')) || null : null
}

async function currentPath(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('users').select('avatar_path').eq('id', userId).maybeSingle()
  if (error) throw error
  return (data?.avatar_path as string | null) ?? null
}

async function removeFile(path: string): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path])
  if (error) console.error('avatar remove failed', error)
}

export async function setAvatar(userId: string, buffer: Buffer, mime: string): Promise<{ avatarId: string }> {
  const ext = validateAvatar(buffer, mime)
  const previous = await currentPath(userId)
  const path = `avatars/${userId}/${randomUUID()}.${ext}`
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, { contentType: mime })
  if (error) throw error
  const { error: updateError } = await supabaseAdmin.from('users').update({ avatar_path: path }).eq('id', userId)
  if (updateError) {
    await removeFile(path)
    throw updateError
  }
  if (previous && previous !== path) await removeFile(previous)
  return { avatarId: avatarId(path)! }
}

export async function removeAvatar(userId: string): Promise<void> {
  const previous = await currentPath(userId)
  if (!previous) return
  const { error } = await supabaseAdmin.from('users').update({ avatar_path: null }).eq('id', userId)
  if (error) throw error
  await removeFile(previous)
}

/** Account deletion: Storage isn't covered by the users FK cascade. Best-effort. */
export async function deleteAvatarFiles(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(`avatars/${userId}`, { limit: 100 })
  if (error) throw error
  if (data?.length) await supabaseAdmin.storage.from(BUCKET).remove(data.map((f) => `avatars/${userId}/${f.name}`))
}

/** Avatar ids for the caller and the other member of their live connection (other is null when not live). */
export async function avatarIds(userId: string, otherUserId: string | null): Promise<{ mine: string | null; other: string | null }> {
  const ids = otherUserId ? [userId, otherUserId] : [userId]
  const { data, error } = await supabaseAdmin.from('users').select('id, avatar_path').in('id', ids)
  // Migration 037 not applied yet: the chat must keep working, just without photos.
  if (error?.code === UNDEFINED_COLUMN) return { mine: null, other: null }
  if (error) throw error
  const pathOf = (id: string | null) => (data ?? []).find((u) => u.id === id)?.avatar_path as string | null | undefined
  return { mine: avatarId(pathOf(userId)), other: otherUserId ? avatarId(pathOf(otherUserId)) : null }
}

/**
 * Short-lived signed URLs: your own photo, and your live partner's. Nobody else's photo is ever signed;
 * a pending, ended or blocked connection gets other = null.
 */
export async function avatarUrls(userId: string): Promise<{ mine: string | null; other: string | null }> {
  const live = await getLiveConnectionForUser(userId)
  const otherUserId = live ? (live.user_a_id === userId ? live.user_b_id : live.user_a_id) : null
  const ids = otherUserId ? [userId, otherUserId] : [userId]
  const { data, error } = await supabaseAdmin.from('users').select('id, avatar_path').in('id', ids)
  if (error) throw error
  const pathOf = (id: string | null) => ((data ?? []).find((u) => u.id === id)?.avatar_path as string | null) ?? null
  const paths = [pathOf(userId), pathOf(otherUserId)].filter((p): p is string => !!p)
  if (!paths.length) return { mine: null, other: null }
  const { data: signed, error: signError } = await supabaseAdmin.storage.from(BUCKET).createSignedUrls(paths, 3600)
  if (signError) throw signError
  const urlOf = (path: string | null) => (path ? (signed ?? []).find((s) => s.path === path)?.signedUrl ?? null : null)
  return { mine: urlOf(pathOf(userId)), other: urlOf(pathOf(otherUserId)) }
}
