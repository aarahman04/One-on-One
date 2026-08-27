import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { getOrCreateUser } from '../services/userService.js'
import { getCurrentConnection } from '../services/connectionService.js'
import { saveMessage } from '../services/messageService.js'

interface SocketData {
  userId: string
  connectionId: string | null
}

function room(connectionId: string): string {
  return `conn:${connectionId}`
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
        ack?.({ ok: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'failed to send message'
        ack?.({ error: message })
      }
    })
  })

  return io
}
