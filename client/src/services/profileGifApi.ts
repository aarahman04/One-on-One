import { authedFetch } from './apiClient'
export interface Gif { id: string; title: string; previewUrl: string; width: number; height: number }
export interface MediaPayload { path: string; mime: string; size: number; width: number; height: number }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(path, init)
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error ?? `Request failed (${res.status}).`) }
  return res.status === 204 ? undefined as T : res.json()
}
export const getAvatars = () => request<{ mine: string | null; other: string | null }>('/api/me/avatars')
export const putAvatar = (blob: Blob) => request<{ avatarId: string }>('/api/me/avatar', { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob })
export const removeAvatar = () => request<void>('/api/me/avatar', { method: 'DELETE' })
export const getGifs = (q: string, offset = 0) => request<{ results: Gif[]; next: number | null }>(`/api/gifs?q=${encodeURIComponent(q)}&offset=${offset}`)
export const prepareGif = (connectionId: string, id: string) => request<MediaPayload>(`/api/connections/${connectionId}/gifs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(60_000) })
