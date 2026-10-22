import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChessRules, ConnectFourRules, DotsRules, ReversiRules, TicTacToeRules } from '../src/games/rules.js'
import { COURT_H, RACKET_MIN } from '../src/games/pong.js'
import { INVITE_TTL_MS, MatchManager, parseClock, parsePoints, OVER_TTL_MS, PONG_AWAY_GRACE_MS, TURN_AWAY_GRACE_MS, type MatchSnapshot } from '../src/games/matches.js'

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
  assert.deepEqual(g.view().history, ['f3', 'e5', 'g4', 'Qh4#'])
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

test('reversi: opening, flips, illegal and malformed moves', () => {
  const g = new ReversiRules()
  assert.deepEqual(g.view().legal, [20, 29, 34, 43])
  assert.equal(g.apply(2, { cell: 20 }), 'not_your_turn')
  assert.equal(g.apply(1, { cell: 0 }), 'illegal_move')
  assert.equal(g.apply(1, { cell: 28 }), 'illegal_move')
  assert.equal(g.apply(1, { cell: 64 }), 'invalid_move')
  assert.equal(g.apply(1, { cell: '20' }), 'invalid_move')
  assert.equal(g.apply(1, { cell: 20, x: 1 }), 'invalid_move')
  assert.equal(g.apply(1, { cell: 20 }), null)
  assert.deepEqual(g.view().flipped, [28])
  assert.equal(g.cells[28], 1)
  assert.equal(g.turn, 2)
  assert.deepEqual(g.view().legal, [19, 21, 37])
})

test('reversi: a player without a move passes; the game ends when nobody can move', () => {
  const pass = new ReversiRules()
  pass.cells.fill(0)
  Object.assign(pass.cells, { 0: 1, 1: 2, 56: 1, 57: 2, 58: 2 })
  assert.equal(pass.apply(1, { cell: 2 }), null)
  assert.equal(pass.turn, 1, 'white has no move: black again')
  assert.equal(pass.view().passed, true)
  assert.equal(pass.outcome, null)
  assert.equal(pass.apply(1, { cell: 59 }), null)
  assert.deepEqual(pass.outcome, { winner: 1, reason: 'most_discs' })
  assert.equal(pass.apply(1, { cell: 3 }), 'game_over')

  const draw = new ReversiRules()
  draw.cells.fill(0)
  Object.assign(draw.cells, { 0: 1, 1: 2, 61: 2, 62: 2, 63: 2 })
  assert.equal(draw.apply(1, { cell: 2 }), null)
  assert.deepEqual(draw.outcome, { winner: 0, reason: 'equal_discs' })
  assert.deepEqual(draw.view().legal, [])
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
  assert.equal(m.paddle(C, A, id, 0.3, 1.8, true), true)
  assert.equal(m.paddle(C, A, id, 0.3, 1.8, false, [0.5, 1.6]), true)
  for (const touch of [null, [], [0.5], [0.5, 1.6, 0], ['0.5', 1.6], [NaN, 1.6]])
    assert.equal(m.paddle(C, A, id, 0.3, 1.8, false, touch), false)
  assert.equal(m.paddle(C, A, id, 0.3, 1.8, 'true'), false)
  assert.equal(m.paddle(C, 'stranger', id, 0.3, 1.8, true), false)
  assert.equal(m.paddle(C, A, id, Number.NaN), false)
  assert.equal(m.paddle(C, A, id, 0.3, Number.POSITIVE_INFINITY), false)
  assert.equal(m.paddle(C, A, id, 0.3, '1.8'), false)
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
  for (let i = 0; i < 7500 && m.get(C)!.status === 'playing'; i++) {
    const f = frames.at(-1) as { b: number[]; serve: number; c: number }
    for (const seat of [1, 2]) {
      const user = m.get(C)!.players[seat - 1]
      const serving = f.serve === seat && f.c === 0
      m.paddle(C, user, id, serving ? f.b[0] : RACKET_MIN, serving ? f.b[1] : seat === 1 ? 2.5 : COURT_H - 2.5, true)
    }
    m.advancePong(C, 16)
  }
  const end = m.get(C)!
  assert.equal(end.status, 'over')
  assert.equal(end.outcome!.reason, 'first_to_7')
  m.disconnected(A)
  assert.ok(PONG_AWAY_GRACE_MS < TURN_AWAY_GRACE_MS)
})

test('matches: a clock charges the side to move, adds the increment and ends on time', () => {
  const { m, advance } = manager()
  const id = m.invite(C, A, B, 'chess', { base: 10_000, inc: 2_000 }).match!.id
  assert.equal(m.get(C)!.clock!.left[0], 10_000)
  m.accept(C, B, id)
  advance(3_000)
  assert.deepEqual(m.get(C)!.clock!.left, [7_000, 10_000]) // white's clock runs
  assert.ok(m.move(C, A, id, 0, { uci: 'e2e4' }).ok)
  assert.deepEqual(m.get(C)!.clock!.left, [9_000, 10_000]) // + 2 s increment
  advance(10_000)
  m.sweep()
  assert.deepEqual(m.get(C)!.outcome, { winner: A, reason: 'timeout' })
  assert.deepEqual(m.get(C)!.clock!.left, [9_000, 0])
  // A move that arrives after the flag fell does not count.
  const late = m.invite(C, A, B, 'tictactoe', { base: 10_000, inc: 0 }).match!.id
  m.accept(C, B, late)
  advance(10_001)
  const tooLate = m.move(C, A, late, 0, { cell: 4 })
  assert.equal(!tooLate.ok && tooLate.error, 'game_over')
  assert.deepEqual(m.get(C)!.outcome, { winner: B, reason: 'timeout' })
  // Rematch keeps the time control; no limit is the default, and Ping Pong never has a clock.
  m.rematch(C, A, late)
  assert.deepEqual(m.rematch(C, B, late).match!.clock, { base: 10_000, inc: 0, left: [10_000, 10_000] })
  m.leave(C, A, m.get(C)!.id, 'resigned')
  assert.equal(m.invite(C, A, B, 'connect4').match!.clock, null)
  m.decline(C, B, m.get(C)!.id)
  assert.equal(m.invite(C, A, B, 'pong', { base: 60_000, inc: 0 }).match!.clock, null)
})

for (const game of ['chess', 'tictactoe', 'connect4', 'reversi'] as const) {
  test(`${game}: clocks survive sync/away/draw, expire, and reset on rematch`, () => {
    const { m, advance } = manager()
    try {
      const id = m.invite(C, A, B, game, { base: 10_000, inc: 2_000 }).match!.id
      advance(2_000)
      assert.deepEqual(m.get(C)!.clock!.left, [10_000, 10_000], 'invites do not spend playing time')
      m.accept(C, B, id)
      advance(1_000)
      assert.deepEqual(m.sync(C, A).match!.clock!.left, [9_000, 10_000])
      const move = game === 'chess' ? { uci: 'e2e4' } : game === 'connect4' ? { col: 3 } :
        { cell: game === 'reversi' ? (m.get(C)!.board!.legal as number[])[0] : 4 }
      assert.equal(m.move(C, A, id, 0, move).ok, true)
      assert.deepEqual(m.get(C)!.clock!.left, [11_000, 10_000], 'increment belongs to the mover')
      advance(2_000)
      m.away(C, B, id, true)
      advance(1_000)
      assert.deepEqual(m.sync(C, B).match!.clock!.left, [11_000, 7_000], 'turn clocks keep running while away')
      m.draw(C, A, id, 'offer')
      advance(1_000)
      m.draw(C, B, id, 'decline')
      assert.deepEqual(m.get(C)!.clock!.left, [11_000, 6_000])
      advance(6_001)
      m.sweep()
      assert.deepEqual(m.get(C)!.outcome, { winner: A, reason: 'timeout' })
      assert.deepEqual(m.get(C)!.clock!.left, [11_000, 0])
      m.rematch(C, A, id)
      const next = m.rematch(C, B, id).match!
      assert.deepEqual(next.players, [B, A])
      assert.deepEqual(next.clock, { base: 10_000, inc: 2_000, left: [10_000, 10_000] })
      advance(10_001)
      assert.equal(m.move(C, B, next.id, 0, move).ok, false, 'late moves cannot rescue an expired clock')
      assert.deepEqual(m.get(C)!.outcome, { winner: A, reason: 'timeout' })
      const unlimited = m.invite(C, A, B, game).match!.id
      m.accept(C, B, unlimited)
      advance(20_000); m.sweep()
      assert.equal(m.get(C)!.clock, null)
      assert.equal(m.get(C)!.status, 'playing')
    } finally { m.dispose() }
  })
}

test('matches: invite clocks are validated', () => {
  assert.equal(parseClock(undefined), null)
  assert.equal(parseClock(null), null)
  assert.deepEqual(parseClock({ base: 60_000, inc: 1_000 }), { base: 60_000, inc: 1_000 })
  for (const bad of [5, 'x', [], { base: 9_999, inc: 0 }, { base: 3 * 3600_000 + 1, inc: 0 }, { base: 60_000, inc: -1 }, { base: 60_000, inc: 60_001 }, { base: 1.5e4, inc: 0.5 }]) {
    assert.equal(parseClock(bad), 'invalid', JSON.stringify(bad))
  }
})

test('matches: Ping Pong plays to the chosen score, kept for the rematch', () => {
  assert.equal(parsePoints(undefined), 7)
  assert.equal(parsePoints(21), 21)
  for (const bad of [0, 100, 2.5, '11', -1]) assert.equal(parsePoints(bad), 'invalid')
  const { m } = manager()
  const id = m.invite(C, A, B, 'pong', null, 3).match!.id
  assert.equal(m.get(C)!.points, 3)
  m.accept(C, B, id)
  assert.deepEqual(m.get(C)!.board, { score: [0, 0], target: 3 })
  m.leave(C, A, id, 'resigned')
  m.rematch(C, A, id)
  assert.equal(m.rematch(C, B, id).match!.points, 3)
  m.leave(C, A, m.get(C)!.id, 'resigned')
  assert.equal(m.invite(C, A, B, 'chess').match!.points, null)
})

test('matches: leaving the results or disconnecting there tells the partner; rematch then fails until they return', () => {
  const { m } = manager()
  const id = m.invite(C, A, B, 'tictactoe').match!.id
  m.accept(C, B, id)
  m.leave(C, A, id, 'resigned')
  assert.equal(m.rematch(C, B, id).match!.rematch.length, 1) // B asks
  const left = m.leave(C, A, id, 'left') // A closes the results
  assert.deepEqual(left.ok && left.match!.away, [A])
  const refused = m.rematch(C, B, id)
  assert.equal(!refused.ok && refused.error, 'partner_left')
  assert.ok(m.sync(C, A).ok) // A comes back to the results
  assert.deepEqual(m.get(C)!.away, [])
  m.disconnected(B) // B's phone dies on the results screen
  assert.deepEqual([m.get(C)!.away, m.get(C)!.rematch], [[B], []])
  const again = m.rematch(C, A, id)
  assert.equal(!again.ok && again.error, 'partner_left')
})

test('matches: every game can be drawn by agreement or declined; table tennis included', () => {
  const { m } = manager()
  for (const game of ['tictactoe', 'connect4', 'reversi', 'dots'] as const) {
    const id = m.invite(C, A, B, game).match!.id
    m.accept(C, B, id)
    assert.equal(m.draw(C, A, id, 'offer').match!.drawOffer, A)
    const declined = m.draw(C, B, id, 'decline')
    assert.equal(declined.ok && declined.match!.drawOffer, null)
    assert.equal(m.draw(C, A, id, 'claim').error, 'no_claim')
    m.draw(C, B, id, 'offer')
    const drawn = m.draw(C, A, id, 'accept')
    assert.deepEqual(drawn.ok && drawn.match!.outcome, { winner: null, reason: 'agreement' }, game)
  }
  const pong = m.invite(C, A, B, 'pong').match!.id
  m.accept(C, B, pong)
  assert.equal(m.draw(C, B, pong, 'offer').match!.drawOffer, B)
  const tied = m.draw(C, A, pong, 'accept')
  assert.deepEqual(tied.ok && tied.match!.outcome, { winner: null, reason: 'agreement' })
})
