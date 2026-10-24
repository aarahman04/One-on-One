import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BALL_R, COURT_H, FIRST_SERVE_MS, PongSim, RACKET_MAX, RACKET_MIN, SPIN_DRIFT, contactRadius, flightPosition } from '../src/games/pong.js'

const near = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`)
const run = (p: PongSim, until: () => boolean, limit = 4000) => {
  for (let i = 0; i < limit && !until(); i++) p.step(8)
  assert.ok(until(), 'simulation reached the expected event')
}
const manual = () => {
  const p = new PongSim(() => .5)
  p.paddle(2, .2, .21)
  p.step(FIRST_SERVE_MS)
  return p
}
const stroke = (dx: number, dy: number, gap = 16) => {
  const p = new PongSim(() => .5)
  p.paddle(2, .5 - dx, .24 - dy); p.step(FIRST_SERVE_MS)
  p.paddle(2, .5 - dx, .24 - dy); p.step(gap)
  p.paddle(2, .5, .24); p.step(8)
  assert.equal(p.hits, 1)
  return p
}

test('ping pong: fast forward strokes meet the painted rim for either seat', () => {
  for (const seat of [1, 2] as const) {
    const p = new PongSim(() => seat === 1 ? 0 : .5)
    const forward = seat === 1 ? -1 : 1
    p.paddle(seat, .5, p.y - forward * .7)
    p.step(FIRST_SERVE_MS)
    p.paddle(seat, .5, p.y + forward * .2)
    near(p.x, .5); near(p.y, seat === 1 ? COURT_H - .24 : .24)
    const start = [p.x, p.y, p.z]
    p.step(8)
    assert.equal(p.hits, 1)
    assert.deepEqual([p.x, p.y, p.z], start)
  }
})

test('ping pong: rally contacts remain outside the visible outline', () => {
  const p = new PongSim(() => .5)
  p.paddle(1, .5, 1.88, true); p.step(FIRST_SERVE_MS)
  let previous = p.hits
  for (let i = 0; i < 2000 && p.hits < 8; i++) {
    p.step(8)
    if (p.hits > previous) {
      const a = p.frame().a!, receiver = a[10] < .9 ? 0 : 1
      // The sub-step may already have advanced the new curve beyond its impact.
      near(Math.hypot(a[0] - p.paddles[receiver], a[1] - p.paddleY[receiver]), contactRadius(a[2]), .002)
      previous = p.hits
    }
  }
  assert.ok(p.hits >= 8)
})

test('ping pong: pulling the red racket back then forward cannot skip a rally contact', () => {
  const p = new PongSim(() => .5)
  p.paddle(1, .5, 2.4, true); p.step(FIRST_SERVE_MS)
  run(p, () => p.bounces > 0 && p.y >= 1.5)
  assert.equal(p.hits, 1)
  const before = [p.x, p.y]
  p.paddle(1, p.x, 1.3)
  near(p.x, before[0]); near(p.y, before[1])
  p.step(8)
  assert.equal(p.hits, 2)
  assert.ok(p.frame().a![10] < .9)
  near(p.paddleY[0], 1.3)
})

test('ping pong: the recovered cubic has real height and eased progress', () => {
  const points: [number, number, number][] = [[0, 0, 0], [0, 1, 1], [1, 1, 1], [1, 0, -1]]
  assert.deepEqual(flightPosition(points, 0), points[0])
  assert.deepEqual(flightPosition(points, 1), points[3])
  const middle = flightPosition(points, .5)
  assert.ok(middle[0] > .5 && middle[2] > 0)
})

test('ping pong: a 2D serve waits for contact and launches from the moving bat rim', () => {
  for (const seat of [1, 2] as const) {
    const p = new PongSim(() => seat === 1 ? 0 : .5)
    p.paddle(seat, .2, seat === 1 ? 1.8 : 0)
    p.step(FIRST_SERVE_MS); p.step(5000)
    assert.equal(p.hits, 0)
    const [x, y, z] = [p.x, p.y, p.z]
    p.paddle(seat, x, y + (seat === 1 ? .19 : -.19), true)
    p.step(8)
    assert.equal(p.hits, 1)
    assert.equal(p.frame().serve, 0)
    assert.equal(p.frame().a?.length, 14)
    near(p.x, x); near(p.y, y)
    near(p.z, z)
    p.step(100)
    assert.ok(p.z > z && (p.y - y) * (seat === 1 ? -1 : 1) > 0)
  }
})

test('ping pong: a table landing separates racket returns; neutral baselines can rally', () => {
  const p = new PongSim(() => .5)
  p.paddle(1, .5, 1.88, true)
  p.step(FIRST_SERVE_MS)
  run(p, () => p.bounces === 1)
  assert.equal(p.hits, 1)
  assert.ok(p.y > COURT_H / 2 && p.z <= BALL_R + .02)
  run(p, () => p.hits >= 7)
  assert.deepEqual(p.score, [0, 0])
})

test('ping pong: swipe strength spans 1 to 1.35 seconds without per-hit acceleration', () => {
  const hard = stroke(0, .3).frame().a!
  near(hard[13], 1, .0001)
  near(hard[10], 1.8868, .0001)
  const soft = stroke(0, -.3).frame().a!
  near(soft[13], 1.35)
  near(soft[10], 1.0234, .0001)
  const neutral = new PongSim(() => .5)
  neutral.step(FIRST_SERVE_MS)
  near(neutral.frame().a![13], 1.35)
})

test('ping pong: stroke direction aims to either side, including the native unclamped soft remap', () => {
  const right = stroke(.3, .03), left = stroke(-.3, .03)
  assert.ok(right.frame().a![9] > .9 && left.frame().a![9] < .1)
  near(right.frame().a![9] + left.frame().a![9], 1, .0001)
  const soft = stroke(.3, -.3)
  assert.ok(soft.frame().a![9] > .7 && soft.frame().a![9] < .8)
})

test('ping pong: the contact stroke fixes a constant curve; release and later movement cannot steer it', () => {
  const p = stroke(.3, .03)
  near(p.frame().spin, 1)
  const start = p.frame().a![9]
  p.step(64)
  near(p.frame().a![9] - start, SPIN_DRIFT * .064, .0002)
  p.paddle(2, .5, .24, true); p.step(64)
  near(p.frame().spin, 1); near(p.frame().drift, SPIN_DRIFT, .0001)
  near(p.frame().a![9] - start, SPIN_DRIFT * .128, .0004)
  p.paddle(2, .3, .24); p.step(16); p.paddle(2, .1, .24); p.step(16)
  near(p.frame().spin, 1)
  near(p.frame().a![9] - start, SPIN_DRIFT * .16, .0004)
})

test('ping pong: a stationary held touch and lost-input timeout clear the live stroke, not the contact curve', () => {
  const live = (p: PongSim) => (p as unknown as { strokes: { side: number }[] }).strokes[1].side
  const stationary = stroke(.3, .03)
  stationary.paddle(2, .5, .24)
  near(live(stationary), 0); near(stationary.frame().spin, 1)
  const lost = stroke(.3, .03)
  lost.step(121)
  near(live(lost), 0); near(lost.frame().spin, 1)
  assert.ok(lost.frame().a!.every(Number.isFinite))
})

test('ping pong: raw touch controls the stroke while the racket eases toward it', () => {
  const p = manual()
  p.paddle(2, .2, .21, false, [.2, .21]); p.step(16)
  p.paddle(2, .35, .225, false, [.5, .24]); p.step(8)
  assert.equal(p.hits, 1)
  near(p.frame().spin, 1)
  const duration = p.frame().a![13]
  // Same held finger, racket still catching up: the finger's stroke has stopped; the shot keeps its contact curve.
  p.paddle(2, .425, .2325, false, [.5, .24])
  near((p as unknown as { strokes: { side: number }[] }).strokes[1].side, 0)
  near(p.frame().spin, 1)
  near(duration, 1.287, .0001)
})

test('ping pong: 30 and 60 Hz input preserve equal swipe strength', () => {
  const at = (ms: number) => {
    const p = manual()
    p.paddle(2, .05, -.2); p.step(ms)
    p.paddle(2, .05 + ms / 1000, -.2 + ms / 1000)
    p.x = p.paddles[1]; p.y = p.paddleY[1]
    p.step(1)
    return p.frame()
  }
  const thirty = at(1000 / 30), sixty = at(1000 / 60)
  near(thirty.spin, sixty.spin); near(thirty.drift, sixty.drift)
  near(thirty.a![9], sixty.a![9]); near(thirty.a![10], sixty.a![10]); near(thirty.a![13], sixty.a![13])
})

test('ping pong: a table bounce follows incoming 3D direction without a random heading kick', () => {
  const p = stroke(.2, .03)
  p.paddle(2, .5, .24, true)
  p.paddle(1, RACKET_MIN, 2.5, true)
  run(p, () => p.bounces === 1)
  const curve = p.frame().a!
  near((curve[9] - p.x) / (curve[10] - p.y), p.vx / p.vy, .001)
  near(curve[11], BALL_R - 6 / 12.16, .0001)
})

test('ping pong: side misses continue off the open table and score', () => {
  const p = stroke(.3, .03)
  p.paddle(1, RACKET_MIN, 2.5, true)
  run(p, () => p.x > 1.02)
  const outside = p.x
  assert.ok(p.vx > 0)
  p.step(16)
  assert.ok(p.x > outside && p.vx > 0)
  run(p, () => p.score[0] + p.score[1] === 1)
  assert.deepEqual(p.score, [1, 0], 'missing the table loses the point')
})

test('ping pong: a landed ball escaping past the opponent wins for the last hitter', () => {
  const p = new PongSim(() => .5)
  p.paddle(1, RACKET_MIN)
  p.step(FIRST_SERVE_MS)
  run(p, () => p.score[0] + p.score[1] === 1)
  assert.ok(p.bounces > 0)
  assert.deepEqual(p.score, [0, 1])
})

test('ping pong: the back of either head launches forward once, including a resting bat', () => {
  for (const seat of [1, 2] as const) {
    const p = new PongSim(() => seat === 1 ? 0 : .5)
    const forward = seat === 1 ? -1 : 1
    p.paddle(seat, p.x, p.y + forward * .1, true)
    p.step(FIRST_SERVE_MS); p.step(500)
    assert.equal(p.hits, 1)
    assert.ok((p.frame().a![10] - .9) * forward > 0)
    p.paddle(seat, p.x, p.y - forward * .19, true); p.step(8)
    assert.equal(p.hits, 1)
  }
})

test('ping pong: each player reaches beyond the sides but remains on their own half', () => {
  const p = new PongSim(() => .5)
  p.paddle(1, -4, -4); p.paddle(2, 4, 4)
  assert.deepEqual(p.paddles, [RACKET_MIN, RACKET_MAX])
  near(p.paddleY[0], 1.3); near(p.paddleY[1], COURT_H - 1.3)
  p.paddle(1, .5, 8); p.paddle(2, .5, -8)
  near(p.paddleY[0], 2.5); near(p.paddleY[1], COURT_H - 2.5)
})

test('ping pong: every two points changes server; pause preserves scores and target wins', () => {
  const p = new PongSim(() => .5)
  p.paddle(1, RACKET_MIN); p.paddle(2, RACKET_MAX)
  p.step(FIRST_SERVE_MS)
  run(p, () => p.score[1] === 1)
  assert.equal(p.frame().serve, 2)
  p.step(1000); run(p, () => p.score[1] === 2)
  assert.equal(p.frame().serve, 1)
  p.holdServe(3000)
  assert.deepEqual(p.score, [0, 2])
  assert.equal(p.countdownMs, 3000)
  run(p, () => p.outcome !== null, 20_000)
  assert.equal(Math.max(...p.score), 7)
  assert.equal(p.outcome?.reason, 'first_to_7')
  assert.ok(p.frame().z.every(Number.isFinite))
})

test('ping pong: backend fixture stays aligned with the Android demo and renderer', () => {
  const p = stroke(.3, .03)
  p.step(64)
  const f = p.frame()
  // The same input/clock sequence is asserted by DemoPongTest.
  assert.deepEqual(f.b.slice(0, 2), [.5256, .3019])
  near(f.z[0], .2265)
  near(f.drift, SPIN_DRIFT, .0001)
})
