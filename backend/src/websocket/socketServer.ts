import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { resolveUserFromToken } from '../services/authToken.js'
import { ConnectionError, markDelivered } from '../services/connectionService.js'
import { getLiveConnectionForUser, type MemberConnection } from '../services/connectionAccess.js'
import { saveMessage, bumpSenderLastRead, isMessageType, type Message } from '../services/messageService.js'
import { signAttachments, isAttachmentKind } from '../services/attachmentService.js'
import { addReaction, removeReaction } from '../services/reactionService.js'
import { sendToUser } from '../services/pushService.js'
import { otherMemberId, room } from '../utils/connections.js'
import {
  acceptCall,
  declineCall,
  endCall,
  getRingingCallForCallee,
  inviteAllowed,
  inviteCall,
  relaySignal,
  setIo,
  type CallKind,
} from '../services/callService.js'
import { getIceServers } from '../services/turnService.js'

interface SocketData {
  userId: string
  connectionId: string | null
}

// Only surface domain errors to the client; everything else is 'internal error'
// so raw Postgres/PostgREST strings (constraint names, columns) don't leak.
function clientError(err: unknown, fallback: string): string {
  if (err instanceof ConnectionError) return err.message
  console.error(fallback, err)
  return fallback
}

// The user's connection can change during one socket's lifetime (formed after
// connect, or terminated + re-formed), so it is re-resolved per event via
// getLiveConnectionForUser rather than trusting the value pinned at handshake.

let ioRef: Server | null = null

// Called by the leave/terminate REST paths so the other member's client learns
// the connection is gone immediately instead of on its next 4s poll.
export function emitConnectionEnded(connectionId: string): void {
  ioRef?.to(room(connectionId)).emit('connection:ended')
}

function mediaNoticeFor(message: Message): string {
  switch (message.type) {
    case 'letter':
      return 'sent you a letter'
    case 'image':
      return 'sent you a photo'
    case 'voice':
      return 'sent you a voice message'
    case 'file':
      return 'sent you a file'
    case 'alarm':
      return (message.payload as { ack?: string } | null)?.ack
        ? 'acknowledged the alarm'
        : '🚨 sent an emergency alarm'
    default:
      return message.content.slice(0, 120)
  }
}

// A raise-alarm sender can only fire so often — an emergency feature is a
// tempting spam vector otherwise. Acknowledgements are exempt (they're a
// reply to someone else's alarm, not a new alert). Keyed by userId (not
// socket) so reconnecting doesn't reset the window; in-memory is fine for a
// single-instance server.
const ALARM_COOLDOWN_MS = 3 * 60_000
const lastAlarmRaiseAt = new Map<string, number>()
function alarmRaiseAllowed(userId: string): boolean {
  const last = lastAlarmRaiseAt.get(userId)
  const now = Date.now()
  if (last !== undefined && now - last < ALARM_COOLDOWN_MS) return false
  lastAlarmRaiseAt.set(userId, now)
  return true
}

// One fetchSockets() decides both delivery paths for a just-sent message: if
// the recipient has a live socket in the room, the message reached them over
// the open connection right now — mark it delivered immediately rather than
// waiting for their next socket (re)connect. Otherwise fall back to push. A
// room is exactly the two members of a 1:1 connection, so "any other socket
// present" means the recipient is already here.
async function syncDelivery(io: Server, connection: MemberConnection, senderId: string, message: Message): Promise<void> {
  const recipientId = otherMemberId(connection, senderId)
  try {
    const sockets = await io.in(room(connection.id)).fetchSockets()
    const recipientOnline = sockets.some((s) => (s.data as SocketData).userId !== senderId)
    if (recipientOnline) {
      await markDelivered(connection.id, recipientId)
      return
    }

    // Nicknames are stored on the OTHER member's row (spec §11) — so "what
    // the recipient calls the sender" lives on the sender's own member row.
    const { data: senderMember } = await supabaseAdmin
      .from('connection_members')
      .select('nickname')
      .eq('connection_id', connection.id)
      .eq('user_id', senderId)
      .maybeSingle()

    const title = senderMember?.nickname ?? 'New message'
    const body = mediaNoticeFor(message)
    await sendToUser(recipientId, { title, body, urgent: message.type === 'alarm' })
  } catch {
    /* best-effort — never fail the send because delivery-sync/push failed */
  }
}

export function createSocketServer(httpServer: HttpServer, allowedOrigins: string[]): Server {
  const io = new Server(httpServer, { cors: { origin: allowedOrigins } })
  ioRef = io
  setIo(io) // lets callService.forceEndCall run from outside the socket layer

  // Auth handshake: verify the Supabase JWT and resolve the app user. The
  // client never gets to name its own connection or sender (spec §20); the
  // live connection is re-resolved per event, not trusted from here.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined
      if (!token) return next(new Error('missing token'))

      const user = await resolveUserFromToken(token)
      const connection = await getLiveConnectionForUser(user.id)

      const socketData = socket.data as SocketData
      socketData.userId = user.id
      socketData.connectionId = connection?.id ?? null
      next()
    } catch (err) {
      next(err as Error)
    }
  })

  io.on('connection', (socket: Socket) => {
    const { userId, connectionId } = socket.data as SocketData
    if (connectionId) {
      socket.join(room(connectionId))
      // This socket coming online means everything sent so far has now
      // reached this member's device — flips the sender's tick(s) to
      // delivered without waiting for a message:send round-trip.
      void markDelivered(connectionId, userId)
      // A socket that reconnects mid-ring (brief network blip) never got the
      // original call:incoming — replay it so the ring isn't silently missed.
      const ringing = getRingingCallForCallee(connectionId, userId)
      if (ringing) socket.emit('call:incoming', ringing)
    }

    // Per-socket flood guard: a legit client sends a handful of events a
    // minute. Anything past this is abuse.
    const recentEvents: number[] = []
    const withinRateLimit = (): boolean => {
      const now = Date.now()
      while (recentEvents.length && now - recentEvents[0] > 10_000) recentEvents.shift()
      if (recentEvents.length >= 60) return false
      recentEvents.push(now)
      return true
    }

    // call:signal carries WebRTC trickle ICE — one event per candidate, and a
    // peer on VPN + wifi + cellular plus an ICE restart or two can legitimately
    // emit dozens in the first few seconds. It gets its own, looser bucket so
    // call setup never trips the general guard (relaySignal already checks the
    // sender is a participant of the named call).
    const recentSignals: number[] = []
    const withinSignalRateLimit = (): boolean => {
      const now = Date.now()
      while (recentSignals.length && now - recentSignals[0] > 10_000) recentSignals.shift()
      if (recentSignals.length >= 250) return false
      recentSignals.push(now)
      return true
    }

    socket.on(
      'message:send',
      async (
        msg: { content?: unknown; type?: unknown; payload?: unknown; replyTo?: unknown; tempId?: unknown },
        ack?: (res: unknown) => void,
      ) => {
      try {
        if (!withinRateLimit()) {
          ack?.({ error: 'slow down' })
          return
        }
        const { userId } = socket.data as SocketData
        const connection = await getLiveConnectionForUser(userId)
        if (!connection) {
          ack?.({ error: 'no active connection' })
          return
        }
        socket.join(room(connection.id))
        // 'call' messages are server-authored only (callService.ts, at call
        // resolution) — reject explicitly rather than silently downgrading,
        // so a forged client-sent 'call' type never passes as ordinary text.
        if (msg?.type === 'call') {
          ack?.({ error: 'call messages are server-authored' })
          return
        }
        const content = typeof msg?.content === 'string' ? msg.content : ''
        const type = isMessageType(msg?.type) ? msg.type : 'text'
        const replyTo = typeof msg?.replyTo === 'string' ? msg.replyTo : null
        const tempId = typeof msg?.tempId === 'string' ? msg.tempId : undefined
        // Only a fresh raise is rate-limited — an ack payload replies to
        // someone else's alarm and shouldn't be throttled by the raiser's window.
        const isAlarmRaise = type === 'alarm' && !(msg?.payload as { ack?: unknown } | null)?.ack
        if (isAlarmRaise && !alarmRaiseAllowed(userId)) {
          ack?.({ error: 'wait a bit before sending another alarm' })
          return
        }
        const message = await saveMessage(connection, userId, content, type, msg?.payload ?? null, replyTo)

        // Sign media at broadcast time so BOTH sides get a viewable/playable
        // URL in the same event, instead of every viewer (sender included)
        // making their own follow-up signed-URL request the moment they try
        // to render it. Best-effort: on failure the client's own hydrateMedia
        // fallback still fetches its own URL, same as before this change.
        let outgoingPayload = message.payload
        if (isAttachmentKind(message.type)) {
          const path = (message.payload as { path?: unknown } | null)?.path
          if (typeof path === 'string') {
            try {
              const urls = await signAttachments([path])
              const url = urls[path]
              if (url) outgoingPayload = { ...(message.payload as object), url }
            } catch (err) {
              console.error('message:send: failed to sign attachment URL', err)
            }
          }
        }

        // tempId echoed so the sender can reconcile its optimistic row exactly.
        io.to(room(connection.id)).emit('message:new', { ...message, payload: outgoingPayload, tempId })
        void syncDelivery(io, connection, userId, message)
        void bumpSenderLastRead(connection.id, userId, message.createdAt)
        ack?.({ ok: true })
      } catch (err) {
        ack?.({ error: clientError(err, 'failed to send message') })
      }
    })

    socket.on(
      'reaction:add',
      async (msg: { messageId?: unknown; emoji?: unknown }, ack?: (res: unknown) => void) => {
        try {
          if (!withinRateLimit()) return ack?.({ error: 'slow down' })
          const { userId } = socket.data as SocketData
          const messageId = typeof msg?.messageId === 'string' ? msg.messageId : ''
          const connId = await addReaction(messageId, userId, msg?.emoji)
          io.to(room(connId)).emit('reaction:update', { messageId, emoji: msg?.emoji, userId, op: 'add' })
          ack?.({ ok: true })
        } catch (err) {
          ack?.({ error: clientError(err, 'failed to add reaction') })
        }
      },
    )

    socket.on(
      'reaction:remove',
      async (msg: { messageId?: unknown; emoji?: unknown }, ack?: (res: unknown) => void) => {
        try {
          if (!withinRateLimit()) return ack?.({ error: 'slow down' })
          const { userId } = socket.data as SocketData
          const messageId = typeof msg?.messageId === 'string' ? msg.messageId : ''
          const connId = await removeReaction(messageId, userId, msg?.emoji)
          io.to(room(connId)).emit('reaction:update', { messageId, emoji: msg?.emoji, userId, op: 'remove' })
          ack?.({ ok: true })
        } catch (err) {
          ack?.({ error: clientError(err, 'failed to remove reaction') })
        }
      },
    )

    // --- Calls (audio/video signaling) ------------------------------------
    // Every handler re-resolves the caller's live connection server-side
    // (never trusts a client-sent connection/peer id) before touching
    // callService, matching the same rule message:send follows above.

    socket.on(
      'call:invite',
      async (msg: { kind?: unknown }, ack?: (res: unknown) => void) => {
        try {
          if (!withinRateLimit()) return ack?.({ error: 'slow down' })
          const { userId } = socket.data as SocketData
          if (!inviteAllowed(userId)) {
            ack?.({ error: 'wait a moment before calling again' })
            return
          }
          const connection = await getLiveConnectionForUser(userId)
          if (!connection) {
            ack?.({ error: 'no active connection' })
            return
          }
          const kind: CallKind = msg?.kind === 'video' ? 'video' : 'audio'
          const { callId } = await inviteCall(io, connection, userId, kind)
          const iceServers = await getIceServers()
          ack?.({ ok: true, callId, iceServers })
        } catch (err) {
          ack?.({ error: clientError(err, 'failed to start call') })
        }
      },
    )

    socket.on(
      'call:accept',
      async (msg: { callId?: unknown }, ack?: (res: unknown) => void) => {
        try {
          if (!withinRateLimit()) return ack?.({ error: 'slow down' })
          const { userId } = socket.data as SocketData
          const connection = await getLiveConnectionForUser(userId)
          if (!connection) return ack?.({ error: 'no active connection' })
          const callId = typeof msg?.callId === 'string' ? msg.callId : ''
          acceptCall(io, connection.id, callId, userId)
          const iceServers = await getIceServers()
          ack?.({ ok: true, iceServers })
        } catch (err) {
          ack?.({ error: clientError(err, 'failed to accept call') })
        }
      },
    )

    socket.on(
      'call:decline',
      async (msg: { callId?: unknown }, ack?: (res: unknown) => void) => {
        try {
          if (!withinRateLimit()) return ack?.({ error: 'slow down' })
          const { userId } = socket.data as SocketData
          const connection = await getLiveConnectionForUser(userId)
          if (!connection) return ack?.({ error: 'no active connection' })
          const callId = typeof msg?.callId === 'string' ? msg.callId : ''
          declineCall(io, connection.id, callId, userId)
          ack?.({ ok: true })
        } catch (err) {
          ack?.({ error: clientError(err, 'failed to decline call') })
        }
      },
    )

    socket.on(
      'call:signal',
      async (msg: { callId?: unknown; data?: unknown }, ack?: (res: unknown) => void) => {
        try {
          if (!withinSignalRateLimit()) return ack?.({ error: 'slow down' })
          const { userId } = socket.data as SocketData
          const connection = await getLiveConnectionForUser(userId)
          if (!connection) return ack?.({ error: 'no active connection' })
          const callId = typeof msg?.callId === 'string' ? msg.callId : ''
          await relaySignal(io, connection.id, callId, userId, msg?.data)
          ack?.({ ok: true })
        } catch (err) {
          ack?.({ error: clientError(err, 'failed to relay call signal') })
        }
      },
    )

    socket.on(
      'call:end',
      async (msg: { callId?: unknown }, ack?: (res: unknown) => void) => {
        try {
          if (!withinRateLimit()) return ack?.({ error: 'slow down' })
          const { userId } = socket.data as SocketData
          const connection = await getLiveConnectionForUser(userId)
          if (!connection) return ack?.({ error: 'no active connection' })
          const callId = typeof msg?.callId === 'string' ? msg.callId : ''
          endCall(io, connection.id, callId, userId)
          ack?.({ ok: true })
        } catch (err) {
          ack?.({ error: clientError(err, 'failed to end call') })
        }
      },
    )
  })

  return io
}
