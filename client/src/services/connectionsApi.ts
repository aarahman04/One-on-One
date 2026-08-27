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
  myUserId: string
  isRequester: boolean
  otherNickname: string | null
  otherConnectionCode: string
  myLeaveStep: number
  otherLeaveStep: number
  daysRemaining: number | null
  bothLeaving: boolean
  canAdvanceLeave: boolean
  otherLastReadAt: string | null
}

export interface LeaveResult {
  status: ConnectionStatus
  myLeaveStep: number
  daysRemaining: number | null
  bothLeaving: boolean
  terminated: boolean
}

export interface HistoryMessage {
  id: string
  senderId: string
  content: string
  createdAt: string
  type: 'text' | 'letter'
  payload: unknown | null
  replyTo: string | null
}

export async function getCurrentConnection(): Promise<CurrentConnection | null> {
  const res = await authedFetch('/api/connections/current')
  const body = await unwrap<{ connection: CurrentConnection | null }>(res)
  return body.connection
}

export async function getMessages(connectionId: string): Promise<HistoryMessage[]> {
  const res = await authedFetch(`/api/connections/${connectionId}/messages`)
  const body = await unwrap<{ messages: HistoryMessage[] }>(res)
  return body.messages
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

export async function advanceLeave(connectionId: string): Promise<LeaveResult> {
  const res = await authedFetch(`/api/connections/${connectionId}/leave`, { method: 'POST' })
  const body = await unwrap<{ leave: LeaveResult }>(res)
  return body.leave
}

export async function cancelLeave(connectionId: string): Promise<LeaveResult> {
  const res = await authedFetch(`/api/connections/${connectionId}/leave/cancel`, { method: 'POST' })
  const body = await unwrap<{ leave: LeaveResult }>(res)
  return body.leave
}

export async function confirmEndLeave(connectionId: string): Promise<LeaveResult> {
  const res = await authedFetch(`/api/connections/${connectionId}/leave/confirm-end`, { method: 'POST' })
  const body = await unwrap<{ leave: LeaveResult }>(res)
  return body.leave
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
