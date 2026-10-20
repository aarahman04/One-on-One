import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChessRules, ConnectFourRules, DotsRules, ReversiRules, TicTacToeRules } from '../src/games/rules.js'
import { BALL_R, COURT_H, HEAD_R, MAX_ANGLE, MAX_SPEED, MAX_SPIN, PongSim, RACKET_MAX, RACKET_MIN, START_SPEED, WIN_SCORE } from '../src/games/pong.js'
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

// Serves straight at seat 2 (random 0.5 -> angle 0; serveTo = 2 because 0.5 is not < 0.5).
const served = () => {
  const p = new PongSim(() => 0.5)
  p.step(3000)
  return p
}
// Run until the ball is returned by `seat`, or give up.
const untilHit = (p: PongSim, hits: number, ms = 16, max = 600) => {
  for (let i = 0; i < max && p.hits === hits && !p.outcome; i++) p.step(ms)
}

test('pong: serve after the countdown, straight down the table', () => {
  const p = new PongSim(() => 0.5)
  p.step(2999)
  assert.deepEqual([p.vx, p.vy], [0, 0])
  p.step(1)
  assert.ok(p.vy < 0 && Math.abs(p.vx) < 1e-9)
  assert.ok(Math.abs(Math.hypot(p.vx, p.vy) - START_SPEED) < 1e-9)
})

test('pong: the contact point on the round head sets the return angle', () => {
  const centre = served()
  centre.paddle(2, 0.5)
  untilHit(centre, 0)
  assert.equal(centre.hits, 1)
  assert.ok(centre.vy > 0 && Math.abs(centre.vx) < 1e-6, 'a centre hit goes straight back')
  assert.ok(Math.hypot(centre.vx, centre.vy) > START_SPEED, 'each return is faster')

  const edge = served()
  edge.paddle(2, 0.5 - HEAD_R * 0.8) // ball meets the head's right-hand side
  untilHit(edge, 0)
  assert.equal(edge.hits, 1)
  assert.ok(edge.vx > 0.2, 'an off-centre hit is angled away from the head centre')
  const angle = Math.atan2(Math.abs(edge.vx), Math.abs(edge.vy))
  assert.ok(angle <= MAX_ANGLE + 1e-9)

  const left = served()
  left.paddle(2, 0.5 + HEAD_R * 0.8)
  untilHit(left, 0)
  assert.ok(left.vx < -0.2)
})

test('pong: a swinging racket adds spin', () => {
  // Same centred contact; only the racket's sideways speed differs.
  // Racket updates every 32 ms (~30/s, like a client), moving at `speed` so it
  // passes the ball's x exactly when the ball reaches the head.
  const contact = (speed: number) => {
    const p = served()
    const meet = HEAD_R + BALL_R + 0.025
    for (let i = 0; i < 2000 && p.hits === 0; i++) {
      if (i % 8 === 0) p.paddle(2, 0.5 - (speed * (p.y - meet)) / Math.abs(p.vy))
      p.step(4)
    }
    assert.equal(p.hits, 1)
    return p.vx
  }
  assert.ok(Math.abs(contact(0)) < 0.02)
  assert.ok(contact(1.2) > 0.1, 'moving right pushes the ball right')
  assert.ok(contact(-1.2) < -0.1, 'moving left pushes the ball left')
})

test('pong: sidespin bends the flight, is sent in frames and decays', () => {
  for (const spin of [0.6, -0.6]) {
    const p = served()
    p.spin = spin
    for (let i = 0; i < 20; i++) p.step(16)
    assert.ok(Math.sign(p.vx) === Math.sign(spin) && Math.sign(p.x - 0.5) === Math.sign(spin), `curves with spin ${spin}`)
    assert.ok(Math.abs(p.spin) < 0.6, 'decays')
    assert.equal(p.frame().w, Math.round(p.spin * 10_000) / 10_000)
  }
})

test('pong: a sideways swing at contact spins the ball, capped', () => {
  const contact = (speed: number) => {
    const p = served()
    const meet = HEAD_R + BALL_R + 0.025
    for (let i = 0; i < 2000 && p.hits === 0; i++) {
      if (i % 8 === 0) p.paddle(2, 0.5 - (speed * (p.y - meet)) / Math.abs(p.vy))
      p.step(4)
    }
    assert.equal(p.hits, 1)
    return p.spin
  }
  assert.ok(Math.abs(contact(0)) < 0.05)
  assert.ok(contact(1.2) > 0.2)
  assert.ok(contact(-1.2) < -0.2)
  assert.equal(contact(5), MAX_SPIN)
})

test('pong: incoming spin kicks off the racket; a side bounce kills spin; curve stays within the max angle', () => {
  const kick = (spin: number) => {
    const p = served()
    p.paddle(2, 0.5)
    p.x = 0.5
    p.y = HEAD_R + BALL_R + 0.01
    p.vx = 0
    p.vy = -1
    p.spin = spin
    p.step(4)
    assert.equal(p.hits, 1)
    return p.vx
  }
  assert.ok(Math.abs(kick(0)) < 1e-6)
  assert.ok(kick(0.6) > 0.1 && kick(-0.6) < -0.1)

  const w = served()
  w.vx = 0.8
  w.spin = 0.5
  for (let i = 0; i < 200 && w.vx > 0; i++) w.step(8)
  assert.ok(w.vx < 0)
  assert.equal(w.spin, 0)

  const steep = served()
  steep.vy = -0.5
  steep.spin = MAX_SPIN
  for (let i = 0; i < 400 && !steep.score[0] && !steep.hits; i++) {
    steep.step(16)
    assert.ok(Math.abs(steep.vx) <= Math.abs(steep.vy) * Math.tan(MAX_ANGLE) + 1e-9)
  }
})

test('pong: side edges reflect, misses score for the opponent, ball resets and serves to the loser', () => {
  const p = served()
  p.paddle(2, RACKET_MAX) // far from the ball: a miss
  for (let i = 0; i < 400 && p.score[0] === 0; i++) p.step(16)
  assert.deepEqual(p.score, [1, 0])
  assert.deepEqual([p.x, p.y, p.vx, p.vy], [0.5, COURT_H / 2, 0, 0])
  assert.ok(p.countdownMs > 0)
  p.step(p.countdownMs)
  assert.ok(p.vy < 0, 'seat 2 lost the point and receives the serve')

  const w = served()
  w.paddle(2, 0.5 - HEAD_R * 0.9)
  untilHit(w, 0)
  let reflected = false
  for (let i = 0; i < 400 && !reflected; i++) {
    w.step(16)
    reflected = w.vx < 0
    assert.ok(w.x >= BALL_R - 1e-9 && w.x <= 1 - BALL_R + 1e-9)
  }
  assert.ok(reflected, 'bounced off the side edge')
})

test('pong: never passes through a racket, even at top speed with 50 ms frames', () => {
  for (const x of [0.5, 0.5 - HEAD_R, 0.5 + HEAD_R]) {
    const p = served()
    p.vx = 0
    p.vy = -MAX_SPEED
    p.paddle(2, x)
    for (let i = 0; i < 40 && p.hits === 0 && !p.score[0]; i++) p.step(50)
    assert.equal(p.hits, 1, `racket at ${x}`)
    assert.deepEqual(p.score, [0, 0])
  }
})

test('pong: a ball past the end line cannot be hit any more; rackets stay on the table', () => {
  const p = served()
  p.paddle(2, RACKET_MAX)
  for (let i = 0; i < 400 && p.y > -BALL_R / 2; i++) p.step(4)
  p.paddle(2, 0.5) // too late
  p.step(16)
  assert.equal(p.hits, 0)
  p.paddle(1, -3)
  p.paddle(2, 9)
  assert.deepEqual(p.paddles, [RACKET_MIN, RACKET_MAX])
})

test('pong: two tracking players keep a long rally; first to 7 ends the game', () => {
  const p = new PongSim(() => 0.37)
  for (let i = 0; i < 60 * 60; i++) {
    p.paddle(1, p.x)
    p.paddle(2, p.x)
    p.step(1000 / 60)
  }
  assert.deepEqual(p.score, [0, 0])
  assert.ok(p.hits > 20, `${p.hits} returns in a minute`)
  const g = new PongSim(() => 0.5)
  g.paddle(1, RACKET_MIN)
  g.paddle(2, RACKET_MAX)
  for (let i = 0; i < 20_000 && !g.outcome; i++) g.step(16)
  assert.equal(Math.max(...g.score), WIN_SCORE)
  assert.equal(g.outcome?.reason, 'first_to_7')
})

test('reversi: opening, flips, illegal and malformed moves', () => {
  const g = new ReversiRules()
  assert.deepEqual(g.view().legal, [19, 26, 37, 44])
  assert.equal(g.apply(2, { cell: 19 }), 'not_your_turn')
  assert.equal(g.apply(1, { cell: 0 }), 'illegal_move')
  assert.equal(g.apply(1, { cell: 27 }), 'illegal_move')
  assert.equal(g.apply(1, { cell: 64 }), 'invalid_move')
  assert.equal(g.apply(1, { cell: '19' }), 'invalid_move')
  assert.equal(g.apply(1, { cell: 19, x: 1 }), 'invalid_move')
  assert.equal(g.apply(1, { cell: 19 }), null)
  assert.deepEqual(g.view().flipped, [27])
  assert.equal(g.cells[27], 1)
  assert.equal(g.turn, 2)
  assert.deepEqual(g.view().legal, [18, 20, 34])
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
