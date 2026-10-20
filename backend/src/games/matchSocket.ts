import type { Server, Socket } from 'socket.io'
import type { MemberConnection } from '../services/connectionAccess.js'
import { otherMemberId, room } from '../utils/connections.js'
import { MATCH_GAMES, MatchManager, type MatchGame, type MatchResult } from './matches.js'

// Socket.IO surface of the authoritative matches (API-CONTRACT §12).
// Every event except match:paddle re-reads the caller's live connection from
// the DB. match:paddle (up to 30/s) is checked against the in-memory match,
// which only exists for a DB-verified live connection and is ended by the
// leave/terminate paths and by the 5 s liveness re-check below.

export const MATCH_EVENTS = ['match:invite', 'match:accept', 'match:decline', 'match:leave', 'match:resign', 'match:move', 'match:draw', 'match:rematch', 'match:sync'] as const
type MatchEvent = (typeof MATCH_EVENTS)[number]

const MAX_PAYLOAD_BYTES = 2048
const LIVENESS_CHECK_MS = 5000

let manager: MatchManager | null = null

export interface MatchDeps {
  getConnection: (userId: string) => Promise<MemberConnection | null>
  hasInactiveConnection: (userId: string) => Promise<boolean>
}

async function userOnline(io: Server, connectionId: string, userId: string): Promise<boolean> {
  const sockets = await io.in(room(connectionId)).fetchSockets()
  return sockets.some((s) => s.data.userId === userId)
}

export function initMatches(io: Server, deps: MatchDeps): MatchManager {
  manager?.dispose()
  const m = new MatchManager({
    emitState: (connectionId, snapshot) => io.to(room(connectionId)).emit('match:state', snapshot),
    // Frames are superseded 30 times a second: volatile drops them for a congested socket instead of queueing.
    emitFrame: (connectionId, frame) => io.to(room(connectionId)).volatile.emit('match:pong', frame),
  })
  manager = m
  const sweeper = setInterval(() => {
    m.sweep()
    // Re-check table tennis connections against the DB (paddle events skip it).
    for (const connectionId of m.pongConnections()) {
      const snapshot = m.get(connectionId)
      if (!snapshot) continue
      void deps
        .getConnection(snapshot.players[0])
        .then((live) => { if (live?.id !== connectionId) m.endConnection(connectionId) })
        .catch((err) => console.error('match liveness check failed:', err))
    }
  }, LIVENESS_CHECK_MS)
  sweeper.unref()
  return m
}

// Leave/terminate paths (emitConnectionEnded).
export function endMatchesForConnection(connectionId: string): void {
  manager?.endConnection(connectionId)
}

function payload(msg: unknown): Record<string, unknown> | null {
  if (msg === undefined || msg === null) return {}
  if (typeof msg !== 'object' || Array.isArray(msg)) return null
  try {
    if (Buffer.byteLength(JSON.stringify(msg) ?? '') > MAX_PAYLOAD_BYTES) return null
  } catch {
    return null
  }
  return msg as Record<string, unknown>
}

export function registerMatchHandlers(
  io: Server,
  socket: Socket,
  deps: MatchDeps & { withinRateLimit: () => boolean; withinPaddleLimit: () => boolean },
): void {
  const userId = (): string => socket.data.userId as string

  for (const event of MATCH_EVENTS) {
    socket.on(event, async (msg: unknown, ack?: (res: MatchResult) => void) => {
      const reply = (res: MatchResult): void => {
        if (typeof ack === 'function') ack(res)
      }
      try {
        const m = manager
        if (!m) return reply({ ok: false, error: 'unavailable' })
        if (!deps.withinRateLimit()) return reply({ ok: false, error: 'rate_limited' })
        const p = payload(msg)
        if (!p) return reply({ ok: false, error: 'invalid_payload' })
        const me = userId()
        const connection = await deps.getConnection(me)
        if (!connection) {
          const inactive = await deps.hasInactiveConnection(me)
          return reply({ ok: false, error: inactive ? 'connection_inactive' : 'not_member' })
        }
        socket.join(room(connection.id))
        reply(await handle(event, m, io, connection, me, p))
      } catch (err) {
        console.error(`${event} failed:`, err)
        reply({ ok: false, error: 'internal' })
      }
    })
  }

  // Paddle position, fire-and-forget. Checked against the in-memory match only.
  socket.on('match:paddle', (msg: unknown) => {
    if (!manager || !deps.withinPaddleLimit()) return
    const p = payload(msg)
    if (!p || typeof p.matchId !== 'string') return
    const joined = [...socket.rooms].find((r) => r.startsWith('conn:'))
    if (!joined) return
    manager.paddle(joined.slice('conn:'.length), userId(), p.matchId, p.x)
  })

  socket.on('disconnect', () => {
    const m = manager
    if (!m) return
    const me = userId()
    void deps
      .getConnection(me)
      .then(async (connection) => {
        if (connection && (await userOnline(io, connection.id, me))) return
        m.disconnected(me)
      })
      .catch((err) => console.error('match disconnect failed:', err))
  })
}

async function handle(
  event: MatchEvent,
  m: MatchManager,
  io: Server,
  connection: MemberConnection,
  me: string,
  p: Record<string, unknown>,
): Promise<MatchResult> {
  const id = connection.id
  switch (event) {
    case 'match:invite': {
      if (typeof p.game !== 'string' || !(MATCH_GAMES as readonly string[]).includes(p.game)) return { ok: false, error: 'invalid_payload' }
      const partner = otherMemberId(connection, me)
      if (!(await userOnline(io, id, partner))) return { ok: false, error: 'partner_offline' }
      return m.invite(id, me, partner, p.game as MatchGame)
    }
    case 'match:accept':
      return m.accept(id, me, p.matchId)
    case 'match:decline':
      return m.decline(id, me, p.matchId)
    case 'match:leave':
      return m.leave(id, me, p.matchId, 'left')
    case 'match:resign':
      return m.leave(id, me, p.matchId, 'resigned')
    case 'match:move':
      return m.move(id, me, p.matchId, p.seq, p.move)
    case 'match:draw':
      return m.draw(id, me, p.matchId, p.action)
    case 'match:rematch':
      return m.rematch(id, me, p.matchId)
    case 'match:sync':
      return m.sync(id, me)
  }
}
