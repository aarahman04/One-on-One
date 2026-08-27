import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { getOrCreateUser } from '../services/userService.js'
import { getCurrentConnection } from '../services/connectionService.js'
import { saveMessage, type Message } from '../services/messageService.js'
import { addReaction, removeReaction } from '../services/reactionService.js'
import { sendToUser } from '../services/pushService.js'

interface SocketData {
  userId: string
  connectionId: string | null
}

function room(connectionId: string): string {
  return `conn:${connectionId}`
}

// Push only when the recipient has no live socket in the room — a room is
// exactly the two members of a 1:1 connection, so "any other socket present"
// means the recipient is already here and will get the message over the
// open connection instead.
async function notifyIfOffline(io: Server, connId: string, senderId: string, message: Message): Promise<void> {
  try {
    const sockets = await io.in(room(connId)).fetchSockets()
    const recipientOnline = sockets.some((s) => (s.data as SocketData).userId !== senderId)
    if (recipientOnline) return

    const { data: conn } = await supabaseAdmin
      .from('connections')
      .select('user_a_id, user_b_id')
      .eq('id', connId)
      .maybeSingle()
    if (!conn) return
    const recipientId = conn.user_a_id === senderId ? conn.user_b_id : conn.user_a_id

    // Nicknames are stored on the OTHER member's row (spec §11) — so "what
    // the recipient calls the sender" lives on the sender's own member row.
    const { data: senderMember } = await supabaseAdmin
      .from('connection_members')
      .select('nickname')
      .eq('connection_id', connId)
      .eq('user_id', senderId)
      .maybeSingle()

    const title = senderMember?.nickname ?? 'New message'
    const body = message.type === 'letter' ? 'sent you a letter' : message.content.slice(0, 120)
    await sendToUser(recipientId, { title, body })
  } catch {
    /* best-effort — never fail the send because push failed */
  }
}

export function createSocketServer(httpServer: HttpServer, allowedOrigins: string[]): Server {
  const io = new Server(httpServer, { cors: { origin: allowedOrigins } })

  // Auth handshake: verify the Supabase JWT, resolve the app user, and pin
  // the user's current live connection to the socket. The client never gets
  // to name its own connection or sender (spec §20).
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined
      if (!token) return next(new Error('missing token'))

      const { data, error } = await supabaseAdmin.auth.getUser(token)
      if (error || !data.user) return next(new Error('invalid token'))

      const user = await getOrCreateUser(data.user.id)
      const current = await getCurrentConnection(user.id)
      const liveConnectionId =
        current && (current.status === 'active' || current.status === 'leave_pending') ? current.id : null

      const socketData = socket.data as SocketData
      socketData.userId = user.id
      socketData.connectionId = liveConnectionId
      next()
    } catch (err) {
      next(err as Error)
    }
  })

  io.on('connection', (socket: Socket) => {
    const { connectionId } = socket.data as SocketData
    if (connectionId) socket.join(room(connectionId))

    socket.on(
      'message:send',
      async (
        msg: { content?: unknown; type?: unknown; payload?: unknown; replyTo?: unknown },
        ack?: (res: unknown) => void,
      ) => {
      try {
        const { userId, connectionId: connId } = socket.data as SocketData
        if (!connId) {
          ack?.({ error: 'no active connection' })
          return
        }
        const content = typeof msg?.content === 'string' ? msg.content : ''
        const type = msg?.type === 'letter' ? 'letter' : 'text'
        const replyTo = typeof msg?.replyTo === 'string' ? msg.replyTo : null
        const message = await saveMessage(connId, userId, content, type, msg?.payload ?? null, replyTo)
        io.to(room(connId)).emit('message:new', message)
        void notifyIfOffline(io, connId, userId, message)
        ack?.({ ok: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'failed to send message'
        ack?.({ error: message })
      }
    })

    socket.on(
      'reaction:add',
      async (msg: { messageId?: unknown; emoji?: unknown }, ack?: (res: unknown) => void) => {
        try {
          const { userId } = socket.data as SocketData
          const messageId = typeof msg?.messageId === 'string' ? msg.messageId : ''
          const connId = await addReaction(messageId, userId, msg?.emoji)
          io.to(room(connId)).emit('reaction:update', { messageId, emoji: msg?.emoji, userId, op: 'add' })
          ack?.({ ok: true })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'failed to add reaction'
          ack?.({ error: message })
        }
      },
    )

    socket.on(
      'reaction:remove',
      async (msg: { messageId?: unknown; emoji?: unknown }, ack?: (res: unknown) => void) => {
        try {
          const { userId } = socket.data as SocketData
          const messageId = typeof msg?.messageId === 'string' ? msg.messageId : ''
          const connId = await removeReaction(messageId, userId, msg?.emoji)
          io.to(room(connId)).emit('reaction:update', { messageId, emoji: msg?.emoji, userId, op: 'remove' })
          ack?.({ ok: true })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'failed to remove reaction'
          ack?.({ error: message })
        }
      },
    )
  })

  return io
}
