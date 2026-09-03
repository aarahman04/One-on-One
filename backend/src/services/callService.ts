// Call signaling state (spec: audio/video calling, batch 1). One-active-
// connection means "the connection" already identifies the pair, so calls
// are keyed by connectionId — never by a client-supplied peer id. Every
// caller here re-resolves the live connection server-side before touching
// this registry (see socketServer's call:* handlers), matching the rest of
// the app's "backend is the sole trust boundary" rule (spec §20).
//
// State is in-memory only, same stance as socketServer's alarm cooldown map:
// single-instance server, and a live call has nothing worth surviving a
// restart — a dropped call should just end.

import { randomUUID } from 'node:crypto'
import type { Server } from 'socket.io'
import { ConnectionError } from '../utils/connectionError.js'
import { otherMemberId, room } from '../utils/connections.js'
import type { MemberConnection } from './connectionAccess.js'
import { saveMessage } from './messageService.js'

export type CallKind = 'audio' | 'video'
export type CallOutcome = 'missed' | 'declined' | 'cancelled' | 'completed' | 'failed'

interface CallRecord {
  id: string
  connectionId: string
  callerId: string
  calleeId: string
  kind: CallKind
  state: 'ringing' | 'connected'
  connectedAt: number | null
  ringTimer: ReturnType<typeof setTimeout>
}

const RING_TIMEOUT_MS = 45_000

// At most one live call per connection — the connection IS the pair.
const activeCalls = new Map<string, CallRecord>()

// A fresh invite is throttled per-caller so ring-spamming a peer isn't free.
// Accept/decline/signal/end are never gated by this (mirrors alarmRaiseAllowed
// in socketServer.ts, which exempts replies the same way).
const INVITE_COOLDOWN_MS = 5_000
const lastInviteAt = new Map<string, number>()
export function inviteAllowed(userId: string): boolean {
  const last = lastInviteAt.get(userId)
  const now = Date.now()
  if (last !== undefined && now - last < INVITE_COOLDOWN_MS) return false
  lastInviteAt.set(userId, now)
  return true
}

function socketUserId(s: { data: unknown }): string {
  return (s.data as { userId: string }).userId
}

// The single resolution path for every outcome — and so the one place the
// call gets written into chat history. Server-authored: senderId is always the
// CALLER, and the client renders incoming/outgoing framing by comparing that
// to its own user id (message:send refuses a client-sent 'call' type).
// Fire-and-forget: a failed log write must never block tearing the call down.
function resolveCall(io: Server, record: CallRecord, outcome: CallOutcome): void {
  clearTimeout(record.ringTimer)
  activeCalls.delete(record.connectionId)
  const durationSec = record.connectedAt ? Math.round((Date.now() - record.connectedAt) / 1000) : 0
  void saveMessage({ id: record.connectionId }, record.callerId, '', 'call', {
    kind: record.kind,
    outcome,
    durationSec,
  })
    // Broadcast like any other message so both sides render the row live
    // instead of only seeing it after a reload.
    .then((message) => io.to(room(record.connectionId)).emit('message:new', message))
    .catch((err) => console.error('callService: failed to write call to chat history', err))
}

// Caller invites the connection's other member. Resolves once call:incoming
// has been delivered to at least one of the callee's live sockets; throws if
// the callee has no live socket at all (nothing to ring) or a call is already
// active on this connection.
export async function inviteCall(
  io: Server,
  connection: MemberConnection,
  callerId: string,
  kind: CallKind,
): Promise<{ callId: string }> {
  if (activeCalls.has(connection.id)) {
    throw new ConnectionError(409, 'a call is already in progress on this connection')
  }
  const calleeId = otherMemberId(connection, callerId)
  const sockets = await io.in(room(connection.id)).fetchSockets()
  const calleeSockets = sockets.filter((s) => socketUserId(s) === calleeId)
  if (calleeSockets.length === 0) {
    throw new ConnectionError(409, 'peer is not reachable right now')
  }

  const id = randomUUID()
  const record: CallRecord = {
    id,
    connectionId: connection.id,
    callerId,
    calleeId,
    kind,
    state: 'ringing',
    connectedAt: null,
    ringTimer: setTimeout(() => {
      const current = activeCalls.get(connection.id)
      if (current?.id !== id) return
      io.to(room(connection.id)).emit('call:ended', { callId: id, reason: 'missed' })
      resolveCall(io, current, 'missed')
    }, RING_TIMEOUT_MS),
  }
  activeCalls.set(connection.id, record)

  for (const s of calleeSockets) s.emit('call:incoming', { callId: id, kind, fromUserId: callerId })
  return { callId: id }
}

export function acceptCall(io: Server, connectionId: string, callId: string, userId: string): void {
  const record = activeCalls.get(connectionId)
  if (!record || record.id !== callId) throw new ConnectionError(409, 'call is no longer active')
  if (record.calleeId !== userId) throw new ConnectionError(403, 'not the callee')
  clearTimeout(record.ringTimer)
  record.state = 'connected'
  record.connectedAt = Date.now()
  // Broadcast to the whole room (not just the caller) so any other device the
  // callee is also signed into drops its own incoming-call prompt — same
  // broadcast-and-let-the-client-filter pattern as message:new.
  io.to(room(connectionId)).emit('call:accepted', { callId })
}

export function declineCall(io: Server, connectionId: string, callId: string, userId: string): void {
  const record = activeCalls.get(connectionId)
  if (!record || record.id !== callId) throw new ConnectionError(409, 'call is no longer active')
  if (record.calleeId !== userId) throw new ConnectionError(403, 'not the callee')
  io.to(room(connectionId)).emit('call:ended', { callId, reason: 'declined' })
  resolveCall(io, record, 'declined')
}

// No-op (not an error) if the call already ended — end races with the ring
// timeout and with the other party's own end/decline are expected.
export function endCall(io: Server, connectionId: string, callId: string, userId: string): void {
  const record = activeCalls.get(connectionId)
  if (!record || record.id !== callId) return
  if (record.callerId !== userId && record.calleeId !== userId) {
    throw new ConnectionError(403, 'not a participant in this call')
  }
  const outcome: CallOutcome =
    record.state === 'connected' ? 'completed' : record.callerId === userId ? 'cancelled' : 'declined'
  io.to(room(connectionId)).emit('call:ended', { callId, reason: outcome })
  resolveCall(io, record, outcome)
}

// Relays an opaque SDP/ICE payload to the OTHER participant's live sockets
// only — never to the sender's own other tabs, and never parsed or stored.
export async function relaySignal(
  io: Server,
  connectionId: string,
  callId: string,
  userId: string,
  data: unknown,
): Promise<void> {
  const record = activeCalls.get(connectionId)
  if (!record || record.id !== callId) throw new ConnectionError(409, 'call is no longer active')
  if (record.callerId !== userId && record.calleeId !== userId) {
    throw new ConnectionError(403, 'not a participant in this call')
  }
  const targetUserId = record.callerId === userId ? record.calleeId : record.callerId
  const sockets = await io.in(room(connectionId)).fetchSockets()
  for (const s of sockets) {
    if (socketUserId(s) === targetUserId) s.emit('call:signal', { callId, data })
  }
}
