import type { Server, Socket } from 'socket.io'
import type { MemberConnection } from '../services/connectionAccess.js'
import { otherMemberId, room } from '../utils/connections.js'

export interface PresenceUpdate {
  userId: string
  online: boolean
  lastSeenAt: string | null
}

export function registerPresence(
  io: Server,
  getConnection: (userId: string) => Promise<MemberConnection | null>,
): void {
  // shortcut: state is process-local, share it before adding server replicas.
  const states = new Map<string, PresenceUpdate>()
  io.on('connection', (socket: Socket) => {
    socket.data.active = false
    const recent: number[] = []
    let pending = Promise.resolve()

    const refresh = (active: boolean): void => {
      // Keep rapid focus/blur and disconnect events in their arrival order.
      pending = pending.then(async () => {
        const userId = socket.data.userId as string
        const connection = await getConnection(userId)
        if (!connection) return
        socket.data.active = active && socket.connected
        socket.data.presenceConnectionId = connection.id
        if (socket.connected) await socket.join(room(connection.id))
        const sockets = await io.in(room(connection.id)).fetchSockets()
        const stateOf = (id: string): PresenceUpdate => ({
          userId: id,
          online: sockets.some((s) => s.data.userId === id && s.data.active === true
            && s.data.presenceConnectionId === connection.id),
          lastSeenAt: states.get(`${connection.id}:${id}`)?.lastSeenAt ?? null,
        })
        const key = `${connection.id}:${userId}`
        const previous = states.get(key)
        const state = stateOf(userId)
        if (state.online) state.lastSeenAt = null
        else if (previous?.online) state.lastSeenAt = new Date().toISOString()
        states.set(key, state)
        const partnerId = otherMemberId(connection, userId)
        if (previous?.online !== state.online) {
          for (const peer of sockets) {
            if (peer.data.userId === partnerId) peer.emit('presence', state)
          }
        }
        if (socket.connected) {
          const partner = stateOf(partnerId)
          if (partner.online) partner.lastSeenAt = null
          socket.emit('presence', partner)
        }
      }).catch((err) => console.error('presence update failed:', err))
    }

    socket.on('presence', (msg: unknown) => {
      if (!msg || typeof msg !== 'object' || typeof (msg as { active?: unknown }).active !== 'boolean') return
      const now = Date.now()
      while (recent.length && now - recent[0] > 10_000) recent.shift()
      if (recent.length >= 20) return
      recent.push(now)
      refresh((msg as { active: boolean }).active)
    })
    socket.on('disconnect', () => refresh(false))
    refresh(false)
  })
}
