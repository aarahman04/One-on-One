import { randomUUID } from 'node:crypto'
import { ChessRules, createRules, type Outcome, type Seat, type TurnGameKind, type TurnRules } from './rules.js'
import { PongSim, type PongFrame } from './pong.js'

// Authoritative two-player matches (2.0.7). One match per connection, kept in
// memory (single-instance backend, like calls). The server assigns seats,
// validates every move, runs the table tennis simulation and is the only
// source of game state; a server restart ends all matches.

export const MATCH_GAMES = ['chess', 'pong', 'connect4', 'tictactoe', 'dots'] as const
export type MatchGame = (typeof MATCH_GAMES)[number]
export type MatchStatus = 'invited' | 'playing' | 'over'

export const INVITE_TTL_MS = 30_000
export const OVER_TTL_MS = 120_000
export const TURN_AWAY_GRACE_MS = 120_000
export const PONG_AWAY_GRACE_MS = 30_000
export const IDLE_TTL_MS = 30 * 60_000
export const RESUME_MS = 3000
const PONG_TICK_MS = 1000 / 60
const FRAME_EVERY = 2 // 30 frames/s

export interface MatchSnapshot {
  id: string
  game: MatchGame
  status: MatchStatus
  inviter: string
  // [seat 1, seat 2]. Chess: seat 1 plays white. Seat 1 moves first.
  players: [string, string]
  turn: string | null
  seq: number
  version: number
  board: Record<string, unknown> | null
  outcome: { winner: string | null; reason: string } | null
  drawOffer: string | null
  rematch: string[]
  series: Record<string, number>
  away: string[]
  paused: boolean
  expiresAt: number | null
}

export type MatchResult = { ok: true; match: MatchSnapshot | null } | { ok: false; error: string; match?: MatchSnapshot | null }

interface Match {
  id: string
  connectionId: string
  game: MatchGame
  status: MatchStatus
  inviter: string
  players: [string, string]
  rules: TurnRules | null
  pong: PongSim | null
  seq: number
  log: string[] // `${seat}:${JSON.stringify(move)}` per applied move, for idempotent retries
  outcome: Outcome | null
  drawOffer: Seat | 0
  rematch: Set<string>
  series: Record<string, number>
  away: Map<string, number>
  version: number
  createdAt: number
  startedAt: number
  updatedAt: number
  loop: ReturnType<typeof setInterval> | null
}

export interface MatchHost {
  emitState(connectionId: string, snapshot: MatchSnapshot): void
  emitFrame(connectionId: string, frame: PongFrame & { id: string; t: number }): void
  // A game that was actually played ended (not an unanswered invite or a torn-down connection): the chat log row.
  finished?(connectionId: string, log: MatchLog): void
  now?: () => number
  random?: () => number
}

export interface MatchLog {
  game: MatchGame
  inviter: string
  winner: string | null
  reason: string
  durationSec: number
}

const ok = (match: MatchSnapshot | null): MatchResult => ({ ok: true, match })
const fail = (error: string, match?: MatchSnapshot | null): MatchResult => ({ ok: false, error, match })

export class MatchManager {
  private matches = new Map<string, Match>() // by connectionId
  private host: MatchHost
  private now: () => number
  private random: () => number

  constructor(host: MatchHost) {
    this.host = host
    this.now = host.now ?? Date.now
    this.random = host.random ?? Math.random
  }

  private seat(m: Match, userId: string): Seat | 0 {
    return m.players[0] === userId ? 1 : m.players[1] === userId ? 2 : 0
  }

  snapshot(m: Match): MatchSnapshot {
    const turn = m.status === 'playing' && m.rules ? m.players[m.rules.turn - 1] : null
    return {
      id: m.id,
      game: m.game,
      status: m.status,
      inviter: m.inviter,
      players: m.players,
      turn,
      seq: m.seq,
      version: m.version,
      board: m.rules ? m.rules.view() : m.pong ? { score: m.pong.score } : null,
      outcome: m.outcome ? { winner: m.outcome.winner ? m.players[m.outcome.winner - 1] : null, reason: m.outcome.reason } : null,
      drawOffer: m.drawOffer ? m.players[m.drawOffer - 1] : null,
      rematch: [...m.rematch],
      series: m.series,
      away: [...m.away.keys()],
      paused: m.status === 'playing' && m.game === 'pong' && m.away.size > 0,
      expiresAt: m.status === 'invited' ? m.createdAt + INVITE_TTL_MS : null,
    }
  }

  private emit(m: Match): MatchSnapshot {
    m.version++
    m.updatedAt = this.now()
    const snap = this.snapshot(m)
    this.host.emitState(m.connectionId, snap)
    return snap
  }

  // The caller's match on this connection, if `matchId` names it.
  private find(connectionId: string, userId: string, matchId: unknown): Match | null {
    const m = this.matches.get(connectionId)
    if (!m || m.id !== matchId || !this.seat(m, userId)) return null
    return m
  }

  get(connectionId: string): MatchSnapshot | null {
    const m = this.matches.get(connectionId)
    return m ? this.snapshot(m) : null
  }

  invite(connectionId: string, userId: string, partnerId: string, game: MatchGame): MatchResult {
    const old = this.matches.get(connectionId)
    if (old && old.status !== 'over') return fail('busy', this.snapshot(old))
    if (old) this.drop(old)
    const players: [string, string] = this.random() < 0.5 ? [userId, partnerId] : [partnerId, userId]
    const series = old && old.game === game ? old.series : { [userId]: 0, [partnerId]: 0 }
    const m = this.create(connectionId, game, userId, players, series)
    return ok(this.emit(m))
  }

  private create(connectionId: string, game: MatchGame, inviter: string, players: [string, string], series: Record<string, number>): Match {
    const now = this.now()
    const m: Match = {
      id: randomUUID(), connectionId, game, status: 'invited', inviter, players, rules: null, pong: null,
      seq: 0, log: [], outcome: null, drawOffer: 0, rematch: new Set(), series, away: new Map(),
      version: 0, createdAt: now, startedAt: now, updatedAt: now, loop: null,
    }
    this.matches.set(connectionId, m)
    return m
  }

  private start(m: Match): void {
    m.status = 'playing'
    m.startedAt = this.now()
    m.seq = 0
    m.log = []
    m.outcome = null
    m.drawOffer = 0
    m.rematch.clear()
    if (m.game === 'pong') {
      m.pong = new PongSim(this.random)
      this.startLoop(m)
    } else m.rules = createRules(m.game as TurnGameKind)
  }

  accept(connectionId: string, userId: string, matchId: unknown): MatchResult {
    const m = this.find(connectionId, userId, matchId)
    if (!m) return fail('not_found', this.get(connectionId))
    if (m.status !== 'invited' || m.inviter === userId) return fail('bad_state', this.snapshot(m))
    m.away.delete(userId)
    this.start(m)
    return ok(this.emit(m))
  }

  decline(connectionId: string, userId: string, matchId: unknown): MatchResult {
    const m = this.find(connectionId, userId, matchId)
    if (!m) return fail('not_found', this.get(connectionId))
    if (m.status !== 'invited') return fail('bad_state', this.snapshot(m))
    return ok(this.finish(m, { winner: 0, reason: m.inviter === userId ? 'cancelled' : 'declined' }))
  }

  // Leaving: cancels an invite, forfeits a running game, or withdraws a rematch request.
  leave(connectionId: string, userId: string, matchId: unknown, reason: 'left' | 'resigned'): MatchResult {
    const m = this.find(connectionId, userId, matchId)
    if (!m) return fail('not_found', this.get(connectionId))
    if (m.status === 'invited') return this.decline(connectionId, userId, matchId)
    if (m.status === 'over') {
      if (m.rematch.delete(userId)) return ok(this.emit(m))
      return ok(this.snapshot(m))
    }
    const seat = this.seat(m, userId) as Seat
    return ok(this.finish(m, { winner: seat === 1 ? 2 : 1, reason }))
  }

  move(connectionId: string, userId: string, matchId: unknown, seq: unknown, move: unknown): MatchResult {
    const m = this.find(connectionId, userId, matchId)
    if (!m) return fail('not_found', this.get(connectionId))
    if (m.status !== 'playing' || !m.rules) return fail(m.status === 'over' ? 'game_over' : 'bad_state', this.snapshot(m))
    if (!Number.isSafeInteger(seq) || (seq as number) < 0) return fail('invalid_payload')
    const seat = this.seat(m, userId) as Seat
    let key: string
    try {
      key = `${seat}:${JSON.stringify(move)}`
    } catch {
      return fail('invalid_move')
    }
    const n = seq as number
    // A retry of a move that was already applied (lost ack) is acknowledged, not replayed.
    if (n < m.seq) return m.log[n] === key ? ok(this.snapshot(m)) : fail('stale', this.snapshot(m))
    if (n > m.seq) return fail('out_of_order', this.snapshot(m))
    const error = m.rules.apply(seat, move)
    if (error) return fail(error, this.snapshot(m))
    m.seq++
    m.log.push(key)
    m.drawOffer = 0 // moving declines a pending draw offer
    if (m.rules.outcome) return ok(this.finish(m, m.rules.outcome))
    return ok(this.emit(m))
  }

  draw(connectionId: string, userId: string, matchId: unknown, action: unknown): MatchResult {
    const m = this.find(connectionId, userId, matchId)
    if (!m) return fail('not_found', this.get(connectionId))
    if (m.status !== 'playing' || !(m.rules instanceof ChessRules)) return fail('bad_state', this.snapshot(m))
    const seat = this.seat(m, userId) as Seat
    const other: Seat = seat === 1 ? 2 : 1
    const chess = m.rules
    switch (action) {
      case 'offer':
        if (m.drawOffer === other) {
          chess.agreeDraw()
          return ok(this.finish(m, chess.outcome!))
        }
        if (m.drawOffer === seat) return ok(this.snapshot(m))
        m.drawOffer = seat
        return ok(this.emit(m))
      case 'accept':
        if (m.drawOffer !== other) return fail('no_offer', this.snapshot(m))
        chess.agreeDraw()
        return ok(this.finish(m, chess.outcome!))
      case 'decline':
        if (m.drawOffer !== other) return fail('no_offer', this.snapshot(m))
        m.drawOffer = 0
        return ok(this.emit(m))
      case 'claim': {
        const error = chess.claim(seat)
        if (error) return fail(error, this.snapshot(m))
        return ok(this.finish(m, chess.outcome!))
      }
      default:
        return fail('invalid_payload')
    }
  }

  rematch(connectionId: string, userId: string, matchId: unknown): MatchResult {
    const m = this.find(connectionId, userId, matchId)
    if (!m) return fail('not_found', this.get(connectionId))
    if (m.status !== 'over' || ['declined', 'cancelled', 'expired'].includes(m.outcome?.reason ?? '')) return fail('bad_state', this.snapshot(m))
    m.rematch.add(userId)
    if (m.rematch.size < 2) return ok(this.emit(m))
    // Both asked: a fresh match with the seats swapped (colours / first move alternate).
    this.drop(m)
    const next = this.create(connectionId, m.game, m.inviter, [m.players[1], m.players[0]], m.series)
    this.start(next)
    return ok(this.emit(next))
  }

  paddle(connectionId: string, userId: string, matchId: unknown, x: unknown): boolean {
    const m = this.find(connectionId, userId, matchId)
    if (!m || m.status !== 'playing' || !m.pong || typeof x !== 'number' || !Number.isFinite(x)) return false
    m.pong.paddle(this.seat(m, userId) as Seat, x)
    return true
  }

  // A member's app is (re)connected: returns the current state for recovery.
  sync(connectionId: string, userId: string): MatchResult {
    const m = this.matches.get(connectionId)
    if (!m || !this.seat(m, userId)) return ok(null)
    if (m.away.delete(userId)) {
      if (m.status === 'playing' && m.pong && m.away.size === 0) m.pong.holdServe(RESUME_MS)
      return ok(this.emit(m))
    }
    return ok(this.snapshot(m))
  }

  // The member's app went to the background (or came back) with its socket still open.
  away(connectionId: string, userId: string, matchId: unknown, away: unknown): MatchResult {
    const m = this.find(connectionId, userId, matchId)
    if (!m) return fail('not_found', this.get(connectionId))
    if (typeof away !== 'boolean') return fail('invalid_payload')
    if (m.status !== 'playing') return ok(this.snapshot(m))
    if (!away) return this.sync(connectionId, userId)
    if (m.away.has(userId)) return ok(this.snapshot(m))
    m.away.set(userId, this.now())
    return ok(this.emit(m))
  }

  // The member has no socket left. Turn games wait; table tennis pauses.
  disconnected(userId: string): void {
    for (const m of this.matches.values()) {
      if (!this.seat(m, userId) || m.away.has(userId)) continue
      if (m.status === 'invited') {
        this.finish(m, { winner: 0, reason: m.inviter === userId ? 'cancelled' : 'declined' })
        continue
      }
      if (m.status !== 'playing') continue
      m.away.set(userId, this.now())
      this.emit(m)
    }
  }

  // Leave/terminate/block: the connection is no longer live.
  endConnection(connectionId: string): void {
    const m = this.matches.get(connectionId)
    if (!m) return
    if (m.status !== 'over') this.finish(m, { winner: 0, reason: 'connection_ended' })
    this.drop(m)
  }

  pongConnections(): string[] {
    return [...this.matches.values()].filter((m) => m.status === 'playing' && m.pong).map((m) => m.connectionId)
  }

  // Expiry and abandonment; called every few seconds.
  sweep(): void {
    const now = this.now()
    for (const m of [...this.matches.values()]) {
      if (m.status === 'invited' && now - m.createdAt >= INVITE_TTL_MS) this.finish(m, { winner: 0, reason: 'expired' })
      else if (m.status === 'over' && now - m.updatedAt >= OVER_TTL_MS) this.drop(m)
      else if (m.status === 'playing') {
        const grace = m.pong ? PONG_AWAY_GRACE_MS : TURN_AWAY_GRACE_MS
        const gone = [...m.away.entries()].filter(([, since]) => now - since >= grace).map(([u]) => u)
        if (gone.length === 2) this.finish(m, { winner: 0, reason: 'abandoned' })
        else if (gone.length === 1) this.finish(m, { winner: gone[0] === m.players[0] ? 2 : 1, reason: 'abandoned' })
        else if (!m.pong && now - m.updatedAt >= IDLE_TTL_MS) this.finish(m, { winner: 0, reason: 'inactive' })
      }
    }
  }

  private finish(m: Match, outcome: Outcome): MatchSnapshot {
    this.stopLoop(m)
    const wasPlaying = m.status === 'playing'
    m.status = 'over'
    m.outcome = outcome
    m.drawOffer = 0
    m.rematch.clear()
    if (wasPlaying && outcome.winner) {
      const winner = m.players[outcome.winner - 1]
      m.series = { ...m.series, [winner]: (m.series[winner] ?? 0) + 1 }
    }
    const snap = this.emit(m)
    if (wasPlaying && outcome.reason !== 'connection_ended') {
      this.host.finished?.(m.connectionId, {
        game: m.game, inviter: m.inviter, winner: snap.outcome?.winner ?? null, reason: outcome.reason,
        durationSec: Math.max(0, Math.round((this.now() - m.startedAt) / 1000)),
      })
    }
    return snap
  }

  private drop(m: Match): void {
    this.stopLoop(m)
    if (this.matches.get(m.connectionId) === m) this.matches.delete(m.connectionId)
  }

  private startLoop(m: Match): void {
    let last = this.now()
    let tick = 0
    m.loop = setInterval(() => this.tick(m, () => {
      const now = this.now()
      const dt = Math.min(50, Math.max(0, now - last))
      last = now
      return dt
    }, tick++), PONG_TICK_MS)
    m.loop.unref?.()
  }

  // One simulation step; exposed for tests (which drive time themselves).
  tick(m: Match, elapsed: () => number, n: number): void {
    const pong = m.pong
    if (!pong || m.status !== 'playing') return
    const dt = elapsed()
    if (m.away.size === 0) pong.step(dt)
    if (pong.outcome) {
      this.host.emitFrame(m.connectionId, { id: m.id, t: this.now(), ...pong.frame() })
      this.finish(m, pong.outcome)
    } else if (n % FRAME_EVERY === 0) this.host.emitFrame(m.connectionId, { id: m.id, t: this.now(), ...pong.frame() })
  }

  // Test hook: advance a running table tennis match by `ms` without timers.
  advancePong(connectionId: string, ms: number): void {
    const m = this.matches.get(connectionId)
    if (!m) return
    for (let left = ms, i = 0; left > 0; left -= PONG_TICK_MS, i++) this.tick(m, () => Math.min(PONG_TICK_MS, left), i)
  }

  private stopLoop(m: Match): void {
    if (m.loop) clearInterval(m.loop)
    m.loop = null
  }

  dispose(): void {
    for (const m of this.matches.values()) this.stopLoop(m)
    this.matches.clear()
  }
}
