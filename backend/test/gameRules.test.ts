import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChessRules, ConnectFourRules, DotsRules, TicTacToeRules } from '../src/games/rules.js'
import { BALL_R, COURT_H, PADDLE_INSET, PongSim, WIN_SCORE } from '../src/games/pong.js'
import { INVITE_TTL_MS, MatchManager, OVER_TTL_MS, PONG_AWAY_GRACE_MS, TURN_AWAY_GRACE_MS, type MatchSnapshot } from '../src/games/matches.js'

const play = (game: ChessRules, ...ucis: string[]) => {
  for (const uci of ucis) assert.equal(game.apply(game.turn, { uci }), null, uci)
}
const board = (game: ChessRules) => (game.view().fen as string).split(' ')[0]

test('chess: legal moves, turn order, captures and malformed input', () => {
  const g = new ChessRules()
  assert.equal(g.apply(2, { uci: 'e7e5' }), 'not_your_turn')
  assert.equal(g.apply(1, { uci: 'e2e5' }), 'illegal_move')
  assert.equal(g.apply(1, { uci: 'e7e5' }), 'illegal_move') // opponent's piece
  for (const bad of [null, {}, { uci: 'e2e4', extra: 1 }, { uci: 'E2E4' }, { uci: 'e2e4k' }, { uci: 42 }]) {
    assert.equal(g.apply(1, bad), 'invalid_move', JSON.stringify(bad))
  }
  play(g, 'e2e4', 'd7d5', 'e4d5')
  assert.deepEqual(g.view().last, { from: 'e4', to: 'd5', captured: 'p' })
  assert.equal(g.turn, 2)
  assert.equal(g.outcome, null)
})

test('chess: check and checkmate', () => {
  const g = new ChessRules()
  play(g, 'f2f3', 'e7e5')
  play(g, 'g2g4')
  assert.equal(g.apply(2, { uci: 'd8h4' }), null)
  assert.equal(g.view().check, true)
  assert.deepEqual(g.outcome, { winner: 2, reason: 'checkmate' })
  assert.equal(g.apply(1, { uci: 'a2a3' }), 'game_over')
})

test('chess: stalemate and insufficient material', () => {
  const s = new ChessRules('7k/8/6K1/8/8/8/8/5Q2 w - - 0 1')
  play(s, 'f1f7')
  assert.deepEqual(s.outcome, { winner: 0, reason: 'stalemate' })
  const i = new ChessRules('4k3/8/8/8/8/8/3r4/4K3 w - - 0 1')
  play(i, 'e1d2')
  assert.deepEqual(i.outcome, { winner: 0, reason: 'insufficient_material' })
})

test('chess: castling and all its restrictions', () => {
  play(new ChessRules('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'e1g1')
  const q = new ChessRules('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
  play(q, 'e1c1')
  assert.equal(board(q), 'r3k2r/8/8/8/8/8/8/2KR3R')
  // Through an attacked square (f1), but the other side is fine.
  const through = new ChessRules('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1')
  assert.equal(through.apply(1, { uci: 'e1g1' }), 'illegal_move')
  play(through, 'e1c1')
  // Out of check.
  assert.equal(new ChessRules('4k3/4r3/8/8/8/8/8/R3K2R w KQ - 0 1').apply(1, { uci: 'e1g1' }), 'illegal_move')
  // Into check (g1 attacked).
  assert.equal(new ChessRules('4k1r1/8/8/8/8/8/8/R3K2R w KQ - 0 1').apply(1, { uci: 'e1g1' }), 'illegal_move')
  // Piece in between.
  assert.equal(new ChessRules('4k3/8/8/8/8/8/8/RN2K2R w KQ - 0 1').apply(1, { uci: 'e1c1' }), 'illegal_move')
  // Rights lost after the king moved, even when it returns.
  const moved = new ChessRules('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1')
  play(moved, 'e1f1', 'e8d8', 'f1e1', 'd8e8')
  assert.equal(moved.apply(1, { uci: 'e1g1' }), 'illegal_move')
  // Rights lost on one side after that rook moved.
  const rook = new ChessRules('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1')
  play(rook, 'h1h2', 'e8d8', 'h2h1', 'd8e8')
  assert.equal(rook.apply(1, { uci: 'e1g1' }), 'illegal_move')
  play(rook, 'e1c1')
})

test('chess: en passant only immediately, and removes the passed pawn', () => {
  const g = new ChessRules('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1')
  play(g, 'e2e4', 'd4e3')
  assert.equal(board(g), '4k3/8/8/8/8/4p3/8/4K3')
  assert.deepEqual(g.view().last, { from: 'd4', to: 'e3', captured: 'p' })
  const late = new ChessRules('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1')
  play(late, 'e2e4', 'e8d8', 'e1d1')
  assert.equal(late.apply(2, { uci: 'd4e3' }), 'illegal_move')
})

test('chess: promotion requires and honours the chosen piece', () => {
  const g = new ChessRules('8/4P3/8/8/8/8/k7/4K3 w - - 0 1')
  assert.equal(g.apply(1, { uci: 'e7e8' }), 'illegal_move')
  play(g, 'e7e8n')
  assert.equal(board(g), '4N3/8/8/8/8/8/k7/4K3')
  assert.equal(new ChessRules('8/4P3/8/8/8/8/k7/4K3 w - - 0 1').apply(1, { uci: 'e7e8k' }), 'invalid_move')
})

test('chess: threefold is claimable by the side to move; fivefold ends the game', () => {
  const g = new ChessRules()
  const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8']
  play(g, ...cycle)
  assert.equal(g.view().claim, null)
  play(g, ...cycle)
  assert.equal(g.view().claim, 'threefold_repetition')
  assert.equal(g.claim(2), 'not_your_turn')
  const five = new ChessRules()
  play(five, ...cycle, ...cycle, ...cycle)
  assert.equal(five.outcome, null)
  play(five, ...cycle)
  assert.deepEqual(five.outcome, { winner: 0, reason: 'fivefold_repetition' })
  assert.equal(g.claim(1), null)
  assert.deepEqual(g.outcome, { winner: 0, reason: 'threefold_repetition' })
})

test('chess: fifty-move claim and seventy-five-move automatic draw', () => {
  const fifty = new ChessRules('4k3/8/8/8/8/8/8/R3K3 w - - 99 60')
  assert.equal(fifty.claim(1), 'no_claim')
  play(fifty, 'a1a2')
  assert.equal(fifty.view().claim, 'fifty_moves')
  assert.equal(fifty.claim(2), null)
  assert.deepEqual(fifty.outcome, { winner: 0, reason: 'fifty_moves' })
  const auto = new ChessRules('4k3/8/8/8/8/8/8/R3K3 w - - 149 90')
  play(auto, 'a1a2')
  assert.deepEqual(auto.outcome, { winner: 0, reason: 'seventy_five_moves' })
  // A pawn move resets the clock.
  const reset = new ChessRules('4k3/8/8/8/8/8/4P3/R3K3 w - - 99 60')
  play(reset, 'e2e3')
  assert.equal(reset.view().claim, null)
})

test('tic-tac-toe, connect four and dots & boxes', () => {
  const t = new TicTacToeRules()
  for (const [seat, cell] of [[1, 0], [2, 3], [1, 1], [2, 4]] as const) assert.equal(t.apply(seat, { cell }), null)
  assert.equal(t.apply(1, { cell: 3 }), 'illegal_move')
  assert.equal(t.apply(2, { cell: 2 }), 'not_your_turn')
  assert.equal(t.apply(1, { cell: 9 }), 'invalid_move')
  assert.equal(t.apply(1, { cell: 2 }), null)
  assert.deepEqual([t.outcome, t.line], [{ winner: 1, reason: 'three_in_a_row' }, [0, 1, 2]])
  const draw = new TicTacToeRules()
  for (const cell of [0, 1, 2, 4, 3, 5, 7, 6, 8]) assert.equal(draw.apply(draw.turn, { cell }), null)
  assert.deepEqual(draw.outcome, { winner: 0, reason: 'board_full' })

  const c = new ConnectFourRules()
  for (const col of [3, 4, 3, 4, 3, 4]) assert.equal(c.apply(c.turn, { col }), null)
  assert.equal(c.apply(1, { col: 3 }), null)
  assert.deepEqual([c.outcome, c.line], [{ winner: 1, reason: 'four_connected' }, [17, 24, 31, 38]])
  const full = new ConnectFourRules()
  for (let i = 0; i < 6; i++) assert.equal(full.apply(full.turn, { col: 0 }), null)
  assert.equal(full.apply(full.turn, { col: 0 }), 'illegal_move')
  assert.equal(full.apply(full.turn, { col: 7 }), 'invalid_move')

  const d = new DotsRules()
  assert.equal(d.apply(1, { h: true, r: 0, c: 0 }), null)
  assert.equal(d.apply(2, { h: true, r: 1, c: 0 }), null)
  assert.equal(d.apply(1, { h: false, r: 0, c: 0 }), null)
  assert.equal(d.apply(2, { h: false, r: 0, c: 1 }), null) // closes box 0
  assert.deepEqual([d.boxes[0], d.turn], [2, 2]) // and plays again
  assert.equal(d.apply(2, { h: true, r: 0, c: 0 }), 'illegal_move')
  assert.equal(d.apply(2, { h: true, r: 6, c: 0 }), 'invalid_move')
  assert.equal(d.apply(2, { h: 1, r: 0, c: 1 }), 'invalid_move')
})

test('pong: serve, paddle bounce, wall bounce, scoring and reset, first to 7', () => {
  const p = new PongSim(() => 0.5) // straight serve to seat 2 (top)
  p.step(2999)
  assert.deepEqual([p.vx, p.vy], [0, 0])
  p.step(1)
  assert.ok(p.vy < 0 && Math.abs(p.vx) < 1e-9)
  p.paddle(2, 0.5)
  for (let i = 0; i < 120 && p.hits === 0; i++) p.step(16)
  assert.equal(p.hits, 1)
  assert.ok(p.vy > 0 && p.y >= PADDLE_INSET + BALL_R - 1e-9)
  // Seat 1 is away from the ball: seat 2 scores, ball resets and serves to seat 1.
  p.paddle(1, 0.95)
  for (let i = 0; i < 400 && p.score[1] === 0; i++) p.step(16)
  assert.deepEqual(p.score, [0, 1])
  assert.deepEqual([p.x, p.y, p.vx, p.vy], [0.5, COURT_H / 2, 0, 0])
  assert.ok(p.countdownMs > 0)
  // Off-centre hits angle the ball; walls reflect it.
  const w = new PongSim(() => 0.5)
  w.step(3000)
  w.paddle(2, 0.5 - 0.1)
  for (let i = 0; i < 200 && w.hits === 0; i++) w.step(16)
  assert.ok(w.vx > 0)
  let bounced = false
  for (let i = 0; i < 400 && !bounced; i++) { w.step(16); bounced = w.vx < 0 }
  assert.ok(bounced && w.x <= 1 - BALL_R)
  // Never tunnels: even a 50 ms step at max speed is caught by the paddle plane test.
  const fast = new PongSim(() => 0.5)
  fast.step(3000)
  for (let i = 0; i < 60 && fast.hits === 0; i++) fast.step(50)
  assert.equal(fast.hits, 1)
  // Scoring to 7 ends the game.
  const g = new PongSim(() => 0.5)
  g.paddle(1, 0.12)
  g.paddle(2, 0.88)
  for (let i = 0; i < 20_000 && !g.outcome; i++) g.step(16)
  assert.equal(Math.max(...g.score), WIN_SCORE)
  assert.equal(g.outcome?.reason, 'first_to_7')
})

function manager(random = 0.1) {
  let now = 1_000_000
  const states: MatchSnapshot[] = []
  const frames: unknown[] = []
  const m = new MatchManager({ emitState: (_c, s) => states.push(s), emitFrame: (_c, f) => frames.push(f), now: () => now, random: () => random })
  return { m, states, frames, advance: (ms: number) => { now += ms } }
}
const A = 'user-a'
const B = 'user-b'
const C = 'conn-1'

test('matches: seats, turns, duplicates, stale and out-of-order moves', () => {
  const { m } = manager()
  const invite = m.invite(C, A, B, 'chess')
  assert.ok(invite.ok)
  const id = invite.match!.id
  assert.deepEqual(invite.match!.players, [A, B]) // random 0.1 < .5: inviter is white
  assert.equal(m.invite(C, B, A, 'pong').ok, false) // busy
  assert.deepEqual(m.accept(C, A, id), { ok: false, error: 'bad_state', match: m.get(C) }) // inviter can't accept
  assert.equal(m.accept(C, 'stranger', id).ok, false)
  const started = m.accept(C, B, id)
  assert.equal(started.ok && started.match!.turn, A)
  assert.equal(m.move(C, B, id, 0, { uci: 'e7e5' }).ok, false) // not white
  assert.equal(m.move(C, A, id, 1, { uci: 'e2e4' }).ok, false) // out of order
  assert.ok(m.move(C, A, id, 0, { uci: 'e2e4' }).ok)
  assert.ok(m.move(C, A, id, 0, { uci: 'e2e4' }).ok) // retried: acknowledged once
  assert.equal(m.get(C)!.seq, 1)
  const stale = m.move(C, A, id, 0, { uci: 'd2d4' })
  assert.equal(!stale.ok && stale.error, 'stale')
  assert.equal(m.move(C, B, id, 1, { uci: 'e5e4' }).ok, false) // illegal never advances
  assert.equal(m.get(C)!.seq, 1)
  assert.equal(m.get(C)!.turn, B)
})

test('matches: resign, series, rematch swaps colours, draw by agreement', () => {
  const { m } = manager()
  const id = m.invite(C, A, B, 'chess').match!.id
  m.accept(C, B, id)
  const over = m.leave(C, B, id, 'resigned')
  assert.deepEqual(over.ok && [over.match!.outcome, over.match!.series], [{ winner: A, reason: 'resigned' }, { [A]: 1, [B]: 0 }])
  assert.equal(m.rematch(C, A, id).match!.rematch.length, 1)
  const next = m.rematch(C, B, id)
  assert.ok(next.ok)
  assert.notEqual(next.match!.id, id)
  assert.deepEqual([next.match!.status, next.match!.players, next.match!.turn], ['playing', [B, A], B])
  assert.deepEqual(next.match!.series, { [A]: 1, [B]: 0 })
  const nid = next.match!.id
  assert.equal(m.draw(C, A, nid, 'accept').ok, false) // nothing offered
  assert.equal(m.draw(C, A, nid, 'offer').match!.drawOffer, A)
  m.move(C, B, nid, 0, { uci: 'e2e4' }) // moving declines the offer
  assert.equal(m.get(C)!.drawOffer, null)
  m.draw(C, A, nid, 'offer')
  const drawn = m.draw(C, B, nid, 'accept')
  assert.deepEqual(drawn.ok && drawn.match!.outcome, { winner: null, reason: 'agreement' })
})

test('matches: invite expiry, decline, cancel, cleanup and connection end', () => {
  const { m, advance } = manager()
  const id = m.invite(C, A, B, 'tictactoe').match!.id
  advance(INVITE_TTL_MS)
  m.sweep()
  assert.deepEqual(m.get(C)!.outcome, { winner: null, reason: 'expired' })
  assert.equal(m.rematch(C, A, id).ok, false)
  advance(OVER_TTL_MS)
  m.sweep()
  assert.equal(m.get(C), null)
  const d = m.invite(C, A, B, 'dots').match!.id
  assert.equal(m.decline(C, B, d).match!.outcome!.reason, 'declined')
  const c = m.invite(C, A, B, 'dots').match!.id
  assert.equal(m.leave(C, A, c, 'left').match!.outcome!.reason, 'cancelled')
  const p = m.invite(C, A, B, 'connect4').match!.id
  m.accept(C, B, p)
  m.endConnection(C)
  assert.equal(m.get(C), null)
})

test('matches: reconnection keeps the board; abandonment after the grace period', () => {
  const { m, advance } = manager()
  const id = m.invite(C, A, B, 'connect4').match!.id
  m.accept(C, B, id)
  m.move(C, A, id, 0, { col: 3 })
  m.disconnected(B)
  assert.deepEqual(m.get(C)!.away, [B])
  advance(TURN_AWAY_GRACE_MS - 1)
  m.sweep()
  const back = m.sync(C, B)
  assert.ok(back.ok)
  assert.deepEqual([back.match!.status, back.match!.away, (back.match!.board!.cells as number[])[38]], ['playing', [], 1])
  m.disconnected(B)
  advance(TURN_AWAY_GRACE_MS)
  m.sweep()
  assert.deepEqual(m.get(C)!.outcome, { winner: A, reason: 'abandoned' })
  assert.equal(m.sync(C, 'stranger').match, null)
})

test('matches: pong runs only on the server, pauses for an absent player and ends at 7', () => {
  const { m, frames } = manager(0.5)
  const id = m.invite(C, A, B, 'pong').match!.id
  m.accept(C, B, id)
  assert.equal(m.paddle(C, A, id, 0.3), true)
  assert.equal(m.paddle(C, A, id, Number.NaN), false)
  assert.equal(m.paddle(C, A, 'other', 0.3), false)
  m.advancePong(C, 3500)
  assert.ok(frames.length > 100)
  const before = frames.length
  m.disconnected(B)
  assert.equal(m.get(C)!.paused, true)
  const frozen = JSON.stringify((frames.at(-1) as { b: number[] }).b)
  m.advancePong(C, 1000)
  assert.equal(JSON.stringify((frames.at(-1) as { b: number[] }).b), frozen)
  m.sync(C, B)
  assert.equal(m.get(C)!.paused, false)
  // Backgrounded with the socket still open: same pause, explicit resume.
  assert.equal(m.away(C, A, id, true).match!.paused, true)
  assert.equal(m.away(C, A, id, 'yes').ok, false)
  assert.equal(m.away(C, A, id, false).match!.paused, false)
  assert.ok(frames.length > before)
  m.advancePong(C, 120_000)
  const end = m.get(C)!
  assert.equal(end.status, 'over')
  assert.equal(end.outcome!.reason, 'first_to_7')
  m.disconnected(A)
  assert.ok(PONG_AWAY_GRACE_MS < TURN_AWAY_GRACE_MS)
})
