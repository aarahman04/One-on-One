import { authedFetch } from './apiClient'
import { getSession } from './authService'
import { forgetFirstRunGates } from '../features/gateStorage'

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
  const owner = (await getSession())?.user.id
  await unwrap(await authedFetch('/api/me', { method: 'DELETE' }))
  if (owner) forgetFirstRunGates(owner)
}

export interface Gates {
  ageVerifiedAt: string | null
  termsAcceptedAt: string | null
}

export async function getGates(): Promise<Gates> {
  return unwrap(await authedFetch('/api/me'))
}

export async function saveGates(gates: { ageVerified?: true; termsAccepted?: true }): Promise<Gates> {
  return unwrap(await authedFetch('/api/me/gates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gates),
  }))
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
