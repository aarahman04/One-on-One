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
import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { ConnectionError } from '../utils/connectionError.js'
import { otherMemberId, room } from '../utils/connections.js'
import type { MemberConnection } from './connectionAccess.js'
import { saveMessage } from './messageService.js'
import { sendToUser } from './pushService.js'

export type CallKind = 'audio' | 'video'
// 'unreachable' = the callee had no live socket at all when the invite came
// in (their app is fully closed) — distinct from 'missed', where it rang and
// they didn't pick up. Both show as a missed call to the callee.
export type CallOutcome = 'missed' | 'declined' | 'cancelled' | 'completed' | 'failed' | 'unreachable'

// Set once by createSocketServer at startup — mirrors socketServer.ts's own
// ioRef (emitConnectionEnded). Lets server-initiated code outside the socket
// layer (forceEndCall, called from connectionService.terminate) reach the
// live io instance without connectionService <-> socketServer importing each
// other.
let ioRef: Server | null = null
export function setIo(io: Server): void {
  ioRef = io
}

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

// Writes the server-authored call row into chat history and broadcasts it
// like any other message so both sides render it live. Server-authored:
// senderId is always the CALLER, and the client derives incoming/outgoing
// framing by comparing that to its own user id (message:send refuses a
// client-sent 'call' type). Fire-and-forget — a failed log write must never
// block tearing the call down. Also used by inviteCall's no-record
// unreachable path, which has no CallRecord to resolve.
function writeCallLog(
  io: Server,
  connectionId: string,
  callerId: string,
  kind: CallKind,
  outcome: CallOutcome,
  durationSec: number,
): void {
  void saveMessage({ id: connectionId }, callerId, '', 'call', { kind, outcome, durationSec })
    .then((message) => io.to(room(connectionId)).emit('message:new', message))
    .catch((err) => console.error('callService: failed to write call to chat history', err))
}

// The single resolution path for every outcome of a live call.
// `notify` is false only when the CONNECTION itself is being torn down
// (forceEndCall) — pushing "missed call" to someone whose connection is
// being deleted a moment later is noise.
function resolveCall(io: Server, record: CallRecord, outcome: CallOutcome, notify = true): void {
  clearTimeout(record.ringTimer)
  activeCalls.delete(record.connectionId)
  const durationSec = record.connectedAt ? Math.round((Date.now() - record.connectedAt) / 1000) : 0
  writeCallLog(io, record.connectionId, record.callerId, record.kind, outcome, durationSec)

  // 'missed'/'cancelled' both mean the callee never actually engaged (ring
  // timed out, or the caller hung up before they answered) — the one case a
  // nudge helps, the same way a phone rings a missed-call notification
  // whether or not the Phone app was open. 'declined' needs no push (they
  // were right there); 'completed' obviously doesn't either.
  if (notify && (outcome === 'missed' || outcome === 'cancelled')) {
    void notifyMissedCall(record.connectionId, record.callerId, record.calleeId, record.kind)
  }
}

async function notifyMissedCall(
  connectionId: string,
  callerId: string,
  calleeId: string,
  kind: CallKind,
): Promise<void> {
  try {
    // Nicknames live on the OTHER member's row (spec §11) — same lookup
    // syncDelivery uses in socketServer.ts for the equivalent text-message push.
    const { data: callerMember } = await supabaseAdmin
      .from('connection_members')
      .select('nickname')
      .eq('connection_id', connectionId)
      .eq('user_id', callerId)
      .maybeSingle()
    const title = callerMember?.nickname ?? 'Missed call'
    const body = kind === 'video' ? 'Missed video call' : 'Missed voice call'
    await sendToUser(calleeId, { title, body })
  } catch {
    /* best-effort — never fail call teardown because push failed */
  }
}

// A socket that (re)connects mid-ring never received the original
// call:incoming — it was emitted only to the sockets live at invite time.
// socketServer's connection handler calls this for every new socket so a
// network blip during ringing doesn't silently swallow the incoming call.
export function getRingingCallForCallee(
  connectionId: string,
  userId: string,
): { callId: string; kind: CallKind; fromUserId: string } | null {
  const record = activeCalls.get(connectionId)
  if (!record || record.state !== 'ringing' || record.calleeId !== userId) return null
  return { callId: record.id, kind: record.kind, fromUserId: record.callerId }
}

// Server-initiated: ends whatever call is active on a connection, with no
// participant check — used when the CONNECTION itself is going away
// (connectionService.terminate), not by either caller or callee's own action.
export function forceEndCall(connectionId: string, reason: CallOutcome = 'cancelled'): void {
  if (!ioRef) return
  const record = activeCalls.get(connectionId)
  if (!record) return
  ioRef.to(room(connectionId)).emit('call:ended', { callId: record.id, reason })
  // notify=false: the connection is being deleted, so the call row cascades
  // away with it and a "missed call" push would land moments before the
  // whole conversation vanishes.
  resolveCall(ioRef, record, reason, false)
}

// Caller invites the connection's other member. Resolves once call:incoming
// has been delivered to at least one of the callee's live sockets. Throws if
// a call is already active on this connection, or if the callee has no live
// socket at all — but that last case still logs an 'unreachable' call row and
// pushes first, so the attempt isn't silent.
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
    // Their app is fully closed — nothing to ring. Still leave a trace, the
    // way a phone logs a call to someone who was unreachable: a call row on
    // both sides + a push so they see it when they next open the app.
    writeCallLog(io, connection.id, callerId, kind, 'unreachable', 0)
    void notifyMissedCall(connection.id, callerId, calleeId, kind)
    throw new ConnectionError(409, "They're not reachable right now — they'll see that you called")
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
