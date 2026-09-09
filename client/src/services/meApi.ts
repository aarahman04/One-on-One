import { authedFetch } from './apiClient'

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

// Account deletion (Google Play policy). Backend deletes the Supabase auth user
// and everything cascading off it; the caller signs out afterwards.
export async function deleteAccount(): Promise<void> {
  await unwrap(await authedFetch('/api/me', { method: 'DELETE' }))
}

export interface BlockRow {
  blockedUserId: string
  createdAt: string
}

export async function listBlocks(): Promise<BlockRow[]> {
  const body = await unwrap<{ blocks: BlockRow[] }>(await authedFetch('/api/me/blocks'))
  return Array.isArray(body?.blocks) ? body.blocks : []
}

export async function unblock(blockedUserId: string): Promise<void> {
  await unwrap(await authedFetch(`/api/me/blocks/${encodeURIComponent(blockedUserId)}`, { method: 'DELETE' }))
}
