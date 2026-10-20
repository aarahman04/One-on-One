import { authedFetch } from './apiClient'
import type { IncomingMessage } from './transport/Transport'

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export type ConnectionStatus = 'pending' | 'active' | 'leave_pending' | 'ended' | 'terminated' | 'declined'

export interface CurrentConnection {
  id: string
  status: ConnectionStatus
  myUserId: string
  isRequester: boolean
  otherNickname: string | null
  otherConnectionCode: string
  endedAt?: string | null
  endedBy?: string | null
  purgeAt?: string | null
  otherLastReadAt: string | null
  otherLastDeliveredAt: string | null
  wallpaper: string
  messageStyle: string
  pinnedMessageId: string | null
  pinnedBy: string | null
  pinnedAt: string | null
  myAvatarId: string | null
  otherAvatarId: string | null
}

export interface ReactionSummary {
  emoji: string
  userIds: string[]
}

export interface HistoryMessage extends IncomingMessage {
  reactions: ReactionSummary[]
}

export async function getCurrentConnection(): Promise<CurrentConnection | null> {
  const res = await authedFetch('/api/connections/current')
  const body = await unwrap<{ connection: CurrentConnection | null }>(res)
  const current = body.connection
  if (current) try {
    const key = `endedConnection:${current.myUserId}`
    if (current.status === 'ended') localStorage.setItem(key, current.id)
    else if (current.status !== 'pending') localStorage.removeItem(key)
  } catch { /* same-account recovery hint only; the backend still owns access */ }
  return current
}

export function endedConnectionId(userId: string): string | null {
  try { return localStorage.getItem(`endedConnection:${userId}`) } catch { return null }
}

export function forgetEndedConnection(userId: string): void {
  try { localStorage.removeItem(`endedConnection:${userId}`) } catch { /* optional hint */ }
}

// `after`: messages strictly newer than that createdAt, oldest first (reconnect resync).
export async function getMessages(connectionId: string, before?: string, after?: string, signal?: AbortSignal): Promise<HistoryMessage[]> {
  const qs = after ? `?after=${encodeURIComponent(after)}` : before ? `?before=${encodeURIComponent(before)}` : ''
  const res = await authedFetch(`/api/connections/${connectionId}/messages${qs}`, { signal })
  const body = await unwrap<{ messages: HistoryMessage[] }>(res)
  return Array.isArray(body?.messages) ? body.messages : []
}

export interface ReportInput {
  category: string
  reason: string
}

export async function reportMessage(messageId: string, input: ReportInput): Promise<void> {
  const res = await authedFetch(`/api/messages/${messageId}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  await unwrap(res)
}

// Report the other member of the connection (no specific message).
export async function reportConnectionUser(connectionId: string, input: ReportInput): Promise<void> {
  const res = await authedFetch(`/api/connections/${connectionId}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  await unwrap(res)
}

// "Block & end": ends the connection immediately and blocks the pair permanently.
export async function blockAndEnd(connectionId: string): Promise<void> {
  const res = await authedFetch(`/api/connections/${connectionId}/block`, { method: 'POST' })
  await unwrap(res)
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

export async function cancelRequest(connectionId: string): Promise<void> {
  const res = await authedFetch(`/api/connections/${connectionId}/cancel`, { method: 'POST' })
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

export async function setWallpaper(connectionId: string, wallpaper: string): Promise<void> {
  const res = await authedFetch(`/api/connections/${connectionId}/wallpaper`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallpaper }),
  })
  await unwrap(res)
}

export async function setMessageStyle(connectionId: string, style: string): Promise<void> {
  const res = await authedFetch(`/api/connections/${connectionId}/style`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ style }),
  })
  await unwrap(res)
}

export async function leaveConnection(connectionId: string): Promise<void> {
  const res = await authedFetch(`/api/connections/${connectionId}/leave`, { method: 'POST' })
  await unwrap(res)
}

export async function acknowledgeEnd(connectionId: string): Promise<void> {
  const res = await authedFetch(`/api/connections/${connectionId}/acknowledge-end`, { method: 'POST' })
  if (res.status !== 404) await unwrap(res)
}

export async function markDelivered(connectionId: string): Promise<void> {
  await unwrap(await authedFetch(`/api/connections/${connectionId}/delivered`, { method: 'POST' }))
}

export async function markRead(connectionId: string): Promise<void> {
  const res = await authedFetch(`/api/connections/${connectionId}/read`, { method: 'POST' })
  await unwrap(res)
}

export async function regenerateConnectionCode(): Promise<string> {
  const res = await authedFetch('/api/me/connection-code/regenerate', { method: 'POST' })
  const body = await unwrap<{ connectionCode: string }>(res)
  return body.connectionCode
}
