import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PongSim, FIRST_SERVE_MS, contactRadius } from '../src/games/pong.js'

test('fast diagonal swipes follow through and launch from the impact-time rim', () => {
  for (const seat of [1, 2] as const) {
    const p = new PongSim(() => seat === 1 ? 0 : .5), forward = seat === 1 ? -1 : 1
    const bx = p.x, by = p.y
    p.paddle(seat, bx - .35, by - forward * .35)
    p.step(FIRST_SERVE_MS)
    p.paddle(seat, bx + .22, by + forward * .22)
    assert.ok(Math.abs(p.paddles[seat - 1] - (bx + .22)) < 1e-6)
    assert.ok(Math.abs(p.paddleY[seat - 1] - (by + forward * .22)) < 1e-6)
    assert.ok(Math.abs(p.x - bx) < 1e-6 && Math.abs(p.y - by) < 1e-6)
    const start = [p.x, p.y, p.z]
    p.step(8)
    assert.equal(p.hits, 1)
    assert.deepEqual([p.x, p.y, p.z], start)
    assert.equal(p.frame().a![13], 1.3434)
  }
})

test('light and hard follow-through cannot relocate or recapture the outgoing flight', () => {
  for (const gap of [16, 250]) for (const seat of [1, 2] as const) {
    const p = new PongSim(() => seat === 1 ? 0 : .5), forward = seat === 1 ? -1 : 1
    const startY = seat === 1 ? 2.2 : -.4, endY = seat === 1 ? 1.3 : .5
    p.paddle(seat, .5, startY); p.step(FIRST_SERVE_MS)
    p.paddle(seat, .5, startY); p.step(gap)
    p.paddle(seat, .5, endY); p.step(8)
    assert.equal(p.hits, 1)
    for (let i = 0; i < 15; i++) {
      const before = p.frame().b
      p.paddle(seat, .5, endY)
      assert.deepEqual(p.frame().b, before)
      p.step(8)
      assert.ok(p.vy * forward > 0)
      assert.equal(p.hits, 1)
    }
  }
})

test('light strokes are slower than hard strokes and release preserves the strength at contact', () => {
  for (const seat of [1, 2] as const) {
    const duration = (delta: number, released: boolean) => {
      const p = new PongSim(() => seat === 1 ? 0 : .5), forward = seat === 1 ? -1 : 1
      p.paddle(seat, .5, seat === 1 ? 2.2 : -.4); p.step(FIRST_SERVE_MS)
      const edge = p.y - forward * contactRadius(p.z)
      p.paddle(seat, .5, edge - forward * (.02 + delta)); p.step(32)
      p.paddle(seat, .5, edge - forward * .02); p.step(32)
      p.paddle(seat, .5, edge + forward * delta, released); p.step(8)
      assert.equal(p.hits, 1)
      return p.frame().a![13]
    }
    for (const released of [false, true]) assert.ok(duration(.03, released) > duration(.5, released) + .25)
    assert.equal(duration(.5, false), duration(.5, true))
  }
})

test('hard follow-through moves each bat continuously without launching a second shot or changing its target', () => {
  for (const seat of [1, 2] as const) {
    const p = new PongSim(() => seat === 1 ? 0 : .5), forward = seat === 1 ? -1 : 1
    p.paddle(seat, .5, seat === 1 ? 2.2 : -.4); p.step(FIRST_SERVE_MS)
    p.paddle(seat, .5, seat === 1 ? 1.7 : .1); p.step(8)
    assert.equal(p.hits, 1)
    const target = p.frame().a!.slice(9, 12)
    for (const movement of [.2, .3, .4, .5]) {
      const y = seat === 1 ? 1.8 - movement : movement
      const before = p.frame().b
      p.paddle(seat, .5, y)
      assert.ok(Math.abs(p.paddleY[seat - 1] - y) < 1e-6)
      assert.deepEqual(p.frame().b, before)
      p.step(8)
      assert.equal(p.hits, 1)
      assert.deepEqual(p.frame().a!.slice(9, 12), target)
    }
  }
})

test('hard and slow corner follow-through cannot recapture or restart an outgoing ball', () => {
  for (const seat of [1, 2] as const) for (const side of [-1, 1]) for (const speed of [.005, .15]) {
    const forward = seat === 1 ? -1 : 1
    const moving = new PongSim(() => seat === 1 ? 0 : .5), control = new PongSim(() => seat === 1 ? 0 : .5)
    for (const p of [moving, control]) {
      p.paddle(seat, .5 + side * .12, seat === 1 ? 2.2 : -.4); p.step(FIRST_SERVE_MS)
      p.paddle(seat, .5 + side * .12, seat === 1 ? 1.68 : .12, true); p.step(8)
      assert.equal(p.hits, 1)
    }
    for (let i = 0; i < 12; i++) {
      const touch: [number, number] = [.5 + side * .12, (seat === 1 ? 1.68 : .12) + forward * speed * i]
      moving.paddle(seat, control.x + side * .08, control.y - forward * .06, false, touch)
      control.paddle(seat, side < 0 ? -.26 : 1.26, seat === 1 ? 2.5 : -.7, false, touch)
      assert.deepEqual(moving.frame().b, control.frame().b, `contact changed position: seat=${seat}, side=${side}, speed=${speed}, frame=${i}`)
      for (const p of [moving, control]) p.step(8)
      assert.deepEqual(moving.frame().b, control.frame().b)
      assert.deepEqual(moving.frame().a, control.frame().a)
      assert.equal(moving.hits, 1)
      assert.ok(moving.vy * forward > 0)
    }
  }
})

test('several bat packets before the physics tick still produce one contact at one position', () => {
  const p = new PongSim(() => .5)
  p.paddle(2, .62, -.4); p.step(FIRST_SERVE_MS)
  p.paddle(2, .62, .12)
  const contact = [p.x, p.y, p.z]
  p.paddle(2, .54, .25); p.paddle(2, .45, .5, true)
  assert.deepEqual([p.x, p.y, p.z], contact)
  p.step(8)
  assert.equal(p.hits, 1)
  assert.deepEqual([p.x, p.y, p.z], contact)
})
