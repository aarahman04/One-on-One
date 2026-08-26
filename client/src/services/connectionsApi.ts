import { authedFetch } from './apiClient'

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export type ConnectionStatus = 'pending' | 'active' | 'leave_pending' | 'terminated' | 'declined'

export interface CurrentConnection {
  id: string
  status: ConnectionStatus
  isRequester: boolean
  otherNickname: string | null
  otherConnectionCode: string
  leaveRequestedByMe: boolean | null
  leaveRequestedAt: string | null
}

export async function getCurrentConnection(): Promise<CurrentConnection | null> {
  const res = await authedFetch('/api/connections/current')
  const body = await unwrap<{ connection: CurrentConnection | null }>(res)
  return body.connection
}

export async function requestConnection(connectionCode: string): Promise<void> {
  const res = await authedFetch('/api/connections/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionCode }),
  })
  await unwrap(res)
}

export async function acceptConnection(connectionId: string): Promise<void> {
  const res = await authedFetch(`/api/connections/${connectionId}/accept`, { method: 'POST' })
  await unwrap(res)
}

export async function declineConnection(connectionId: string): Promise<void> {
  const res = await authedFetch(`/api/connections/${connectionId}/decline`, { method: 'POST' })
  await unwrap(res)
}

export async function setNickname(connectionId: string, nickname: string): Promise<void> {
  const res = await authedFetch(`/api/connections/${connectionId}/nickname`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname }),
  })
  await unwrap(res)
}
