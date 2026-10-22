import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PongSim, FIRST_SERVE_MS, contactRadius } from '../src/games/pong.js'

test('a fast diagonal sweep hits even when both endpoints miss the ball', () => {
  for (const seat of [1, 2] as const) {
    const p = new PongSim(() => seat === 1 ? 0 : .5)
    const dy = seat === 1 ? -Math.SQRT1_2 : Math.SQRT1_2
    const bx = p.x, by = p.y
    p.paddle(seat, bx - Math.SQRT1_2 * .5, by - dy * .5)
    p.step(FIRST_SERVE_MS)
    p.paddle(seat, bx + Math.SQRT1_2 * .3, by + dy * .3)
    p.step(8)
    assert.equal(p.hits, 1, `seat ${seat} diagonal contact`)
    assert.ok(Math.hypot(p.x - p.paddles[seat - 1], p.y - p.paddleY[seat - 1]) >= contactRadius(p.z) - 1e-5)
    assert.ok(p.vx > 0 && p.vy * dy > 0)
    assert.ok(Math.abs(p.vx / p.vy - Math.SQRT1_2 / dy) < .001)
  }
})
