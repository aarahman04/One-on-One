import { randomUUID } from 'node:crypto'
import type { Server, Socket } from 'socket.io'
import type { MemberConnection } from '../services/connectionAccess.js'
import { otherMemberId, room } from '../utils/connections.js'
import { supabaseAdmin } from '../database/supabaseAdmin.js'
import { saveMessage } from '../services/messageService.js'
import { sendNativeCallPush } from '../services/pushService.js'
import { MATCH_GAMES, MatchManager, parseClock, parsePoints, type MatchGame, type MatchLog, type MatchResult } from './matches.js'

// Socket.IO surface of the authoritative matches (API-CONTRACT §12).
// Every event except match:paddle re-reads the caller's live connection from
// the DB. match:paddle (60/s with release burst allowance) is checked against the in-memory match,
// which only exists for a DB-verified live connection and is ended by the
// leave/terminate paths and by the 5 s liveness re-check below.

export const MATCH_EVENTS = ['match:invite', 'match:accept', 'match:decline', 'match:leave', 'match:resign', 'match:move', 'match:draw', 'match:rematch', 'match:sync', 'match:away', 'match:react'] as const
type MatchEvent = (typeof MATCH_EVENTS)[number]

const MAX_PAYLOAD_BYTES = 2048
const LIVENESS_CHECK_MS = 5000
const INVITE_PUSH_TTL = '30s' // matches INVITE_TTL_MS: a later delivery is an expired invite
// In-game reactions: a short emoji or comment that pops up on both players' screens. Not stored.
export const REACTION_MAX_CHARS = 60
const REACTION_GAP_MS = 700
const lastReaction = new Map<string, number>()

export const GAME_TITLES: Record<MatchGame, string> = {
  chess: 'Chess', pong: 'Ping Pong', connect4: 'Connect 4', tictactoe: 'Tic-Tac-Toe', dots: 'Dots & Boxes', reversi: 'Reversi',
}

// Readable fallback `content` for clients that don't render the 'game' type yet.
export function gameLogText(log: MatchLog): string {
  const s = log.durationSec
  const hr = Math.floor(s / 3600)
  const min = Math.floor(s / 60) % 60
  const time = s < 60 ? `${s} sec` : s < 3600 ? (s % 60 ? `${min} min ${s % 60} sec` : `${min} min`) : min ? `${hr} hr ${min} min` : `${hr} hr`
  return `Played ${GAME_TITLES[log.game]} · ${time}`
}

// Server-authored chat row for a finished game, like callService.writeCallLog:
// sender is the inviter; fire-and-forget so a failed write never touches the match.
function writeGameLog(io: Server, connectionId: string, log: MatchLog): void {
  void saveMessage({ id: connectionId }, log.inviter, gameLogText(log), 'game', log)
    .then((message) => io.to(room(connectionId)).emit('message:new', message))
    .catch((err) => console.error('matches: failed to write game to chat history', err))
}

// Data-only push so a member whose app is backgrounded (socket still open) or
// not on the chat screen still learns about the invite. The app decides
// whether to show it; best-effort like every push.
async function pushInvite(connectionId: string, inviterId: string, partnerId: string, matchId: string, game: MatchGame): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('connection_members')
      .select('nickname')
      .eq('connection_id', connectionId)
      .eq('user_id', inviterId)
      .maybeSingle()
    await sendNativeCallPush(
      partnerId,
      { type: 'game_invite', matchId, connectionId, game, inviterName: (data?.nickname as string | undefined) ?? '' },
      INVITE_PUSH_TTL,
    )
  } catch (err) {
    console.error('matches: invite push failed', err)
  }
}

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
    finished: (connectionId, log) => writeGameLog(io, connectionId, log),
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

function payload(msg: unknown, limit = MAX_PAYLOAD_BYTES): Record<string, unknown> | null {
  if (msg === undefined || msg === null) return {}
  if (typeof msg !== 'object' || Array.isArray(msg)) return null
  try {
    if (Buffer.byteLength(JSON.stringify(msg) ?? '') > limit) return null
  } catch {
    return null
  }
  return msg as Record<string, unknown>
}

export function registerMatchHandlers(
  io: Server,
  socket: Socket,
  deps: MatchDeps & { withinRateLimit: () => boolean; withinPaddleLimit: () => boolean; measuredRtt?: () => number | undefined },
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
  let lastPaddleCt = -1
  socket.on('match:paddle', (msg: unknown) => {
    if (!manager || !deps.withinPaddleLimit()) return
    const p = payload(msg, 8192)
    if (!p || typeof p.matchId !== 'string') return
    if (p.ct !== undefined && (typeof p.ct !== 'number' || !Number.isSafeInteger(p.ct) || p.ct <= lastPaddleCt)) return
    const joined = [...socket.rooms].find((r) => r.startsWith('conn:'))
    if (!joined) return
    const accepted = manager.paddle(joined.slice('conn:'.length), userId(), p.matchId, p.x, p.y, p.released, p.touch, p.ct, p.v, p.n, socket.id, p.samples, deps.measuredRtt?.())
    if (accepted && typeof p.ct === 'number') lastPaddleCt = p.ct
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
      const clock = parseClock(p.clock)
      const points = parsePoints(p.points)
      if (clock === 'invalid' || points === 'invalid') return { ok: false, error: 'invalid_payload' }
      const partner = otherMemberId(connection, me)
      const result = m.invite(id, me, partner, p.game as MatchGame, clock, points)
      if (result.ok && result.match) void pushInvite(id, me, partner, result.match.id, p.game as MatchGame)
      return result
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
    case 'match:away':
      return m.away(id, me, p.matchId, p.away)
    case 'match:react': {
      const current = m.get(id)
      if (!current || current.id !== p.matchId || !current.players.includes(me)) return { ok: false, error: 'not_found' }
      if (current.status !== 'playing' && current.status !== 'over') return { ok: false, error: 'bad_state' }
      if (typeof p.text !== 'string') return { ok: false, error: 'invalid_payload' }
      // One line, collapsed whitespace; length counts code points so an emoji is one character.
      const text = p.text.replace(/\s+/g, ' ').trim()
      const length = [...text].length
      if (length < 1 || length > REACTION_MAX_CHARS) return { ok: false, error: 'invalid_payload' }
      const now = Date.now()
      if (now - (lastReaction.get(me) ?? 0) < REACTION_GAP_MS) return { ok: false, error: 'rate_limited' }
      lastReaction.set(me, now)
      io.to(room(id)).emit('match:reaction', { id: randomUUID(), matchId: current.id, from: me, text })
      return { ok: true, match: null }
    }
  }
}
