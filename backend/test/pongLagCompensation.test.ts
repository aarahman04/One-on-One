import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PongSim } from '../src/games/pong.js'

test('timed back-half contact launches forward immediately at impact', () => {
  const p = new PongSim(() => .75)
  p.paddle(2, .5, .5); p.step(3000)
  p.paddle(2, .5, .24, false, undefined, { ct: 1000, v: 3000, n: 1 })
  assert.equal(p.hits, 1)
  assert.ok(p.frame().a![10] > .9)
  assert.equal(p.frame().ack[1], 1)
})

test('duplicated and reordered timed samples cannot move the bat or replay contact', () => {
  const p = new PongSim(() => .75)
  p.paddle(1, .2, 2.4, false, undefined, { ct: 1000, v: 0, n: 5 })
  const before = p.frame()
  p.paddle(1, .8, 1.3, false, undefined, { ct: 1001, v: 0, n: 5 })
  p.paddle(1, .9, 1.4, false, undefined, { ct: 1002, v: 0, n: 4 })
  assert.deepEqual(p.frame().p, before.p)
  assert.equal(p.frame().ack[0], 5)
})

test('a delayed bat segment is judged against the displayed ball, then fast-forwarded', () => {
  const p = new PongSim(() => .75)
  p.paddle(1, .5, 2.5, true); p.paddle(2, .5, -.4); p.step(3000)
  p.paddle(2, .5, .44, true); p.step(8)
  for (let i = 0; i < 500 && !(p.frame().l && p.y > 1.5); i++) p.step(8)
  assert.equal(p.hits, 1)
  const v = (p as unknown as { clock: number }).clock
  const x = p.x, y = p.y
  p.paddle(1, x, 2.4, false, undefined, { ct: 1000, v, n: 1 })
  p.step(120)
  p.paddle(1, x, y, false, undefined, { ct: 1033, v, n: 3 })
  assert.equal(p.hits, 2)
  assert.ok(p.frame().a![12] >= .119, 'return flight includes time since historical impact')
  assert.equal(p.frame().ack[0], 3, 'a missing sequence does not discard the covering segment')
})
