import type { Server, Socket } from 'socket.io'
import type { MemberConnection } from '../services/connectionAccess.js'
import { otherMemberId, room } from '../utils/connections.js'

// Two-player game relay (2.0.6). Never stored: each event is validated,
// re-authorized against the DB and forwarded to the partner's sockets only,
// with `from` added. Game rules live in the clients.

export const GAME_EVENTS = ['game:invite', 'game:accept', 'game:decline', 'game:move', 'game:end'] as const
export type GameEvent = (typeof GAME_EVENTS)[number]
export const GAMES = ['chess', 'pong', 'connect4', 'tictactoe', 'dots']
export type GameAck =
  | { ok: true }
  | { ok: false; error: 'invalid_payload' | 'not_member' | 'connection_inactive' | 'partner_offline' | 'rate_limited' }

const GAME_ID_RE = /^[A-Za-z0-9-]{1,64}$/
const MAX_PAYLOAD_BYTES = 4096
const MAX_REASON_CHARS = 64

// The relayed payload (only the known fields), or null when invalid.
export function gamePayload(event: GameEvent, msg: unknown): Record<string, unknown> | null {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null
  const m = msg as Record<string, unknown>
  let size: number
  try {
    size = Buffer.byteLength(JSON.stringify(m) ?? '')
  } catch {
    return null
  }
  if (size > MAX_PAYLOAD_BYTES) return null
  if (typeof m.gameId !== 'string' || !GAME_ID_RE.test(m.gameId)) return null
  const gameId = m.gameId
  switch (event) {
    case 'game:invite':
      return typeof m.game === 'string' && GAMES.includes(m.game) ? { gameId, game: m.game } : null
    case 'game:move':
      if (!Number.isSafeInteger(m.seq) || (m.seq as number) < 0 || m.data === undefined) return null
      return { gameId, seq: m.seq, data: m.data }
    case 'game:end':
      return typeof m.reason === 'string' && m.reason.length <= MAX_REASON_CHARS ? { gameId, reason: m.reason } : null
    default:
      return { gameId }
  }
}

export interface GameDeps {
  // The socket's generic per-socket flood guard (socketServer).
  withinRateLimit: () => boolean
  getConnection: (userId: string) => Promise<MemberConnection | null>
  hasInactiveConnection: (userId: string) => Promise<boolean>
}

const MOVES_PER_SECOND = 40

export function registerGameHandlers(io: Server, socket: Socket, deps: GameDeps): void {
  // game:move (pong paddles etc.) gets its own 40/s bucket instead of the
  // generic 60/10s guard, which a real-time game would trip in seconds.
  const recentMoves: number[] = []
  const withinMoveLimit = (): boolean => {
    const now = Date.now()
    while (recentMoves.length && now - recentMoves[0] > 1000) recentMoves.shift()
    if (recentMoves.length >= MOVES_PER_SECOND) return false
    recentMoves.push(now)
    return true
  }

  for (const event of GAME_EVENTS) {
    socket.on(event, async (msg: unknown, ack?: (res: GameAck) => void) => {
      const reply = (res: GameAck): void => {
        if (typeof ack === 'function') ack(res)
      }
      try {
        if (!(event === 'game:move' ? withinMoveLimit() : deps.withinRateLimit())) {
          return reply({ ok: false, error: 'rate_limited' })
        }
        const payload = gamePayload(event, msg)
        if (!payload) return reply({ ok: false, error: 'invalid_payload' })

        // Re-checked from the DB per event: membership AND live status.
        const userId = socket.data.userId as string
        const connection = await deps.getConnection(userId)
        if (!connection) {
          const inactive = await deps.hasInactiveConnection(userId)
          return reply({ ok: false, error: inactive ? 'connection_inactive' : 'not_member' })
        }

        const partnerId = otherMemberId(connection, userId)
        const sockets = await io.in(room(connection.id)).fetchSockets()
        const partnerSockets = sockets.filter((s) => s.data.userId === partnerId)
        if (!partnerSockets.length) return reply({ ok: false, error: 'partner_offline' })
        for (const s of partnerSockets) s.emit(event, { ...payload, from: userId })
        reply({ ok: true })
      } catch (err) {
        console.error(`${event} relay failed:`, err)
        reply({ ok: false, error: 'connection_inactive' })
      }
    })
  }
}
