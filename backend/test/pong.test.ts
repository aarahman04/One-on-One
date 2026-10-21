import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ARC_H, BALL_R, COURT_H, FIRST_SERVE_MS, FLOOR_H, PongSim, RACKET_MAX, RACKET_MIN, flightPosition } from '../src/games/pong.js'

const near = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`)
const run = (p: PongSim, until: () => boolean, limit = 4000) => {
  for (let i = 0; i < limit && !until(); i++) p.step(8)
  assert.ok(until(), 'simulation reached the expected event')
}
const manual = () => {
  const p = new PongSim(() => 0.5)
  p.paddle(2, 0.2, 0.21)
  p.step(FIRST_SERVE_MS)
  return p
}

test('ping pong: flight is a height-bearing cubic, with exact start and end', () => {
  const points: [number, number, number][] = [[0, 0, 0], [0, 1, 1], [1, 1, 1], [1, 0, -1]]
  assert.deepEqual(flightPosition(points, 0), points[0])
  assert.deepEqual(flightPosition(points, 1), points[3])
  const middle = flightPosition(points, 0.5)
  assert.ok(middle[0] > 0.5 && middle[2] > 0, 'quick departure, actual height above table')
})

test('ping pong: a two-dimensional racket serves by contacting the waiting ball', () => {
  const p = manual()
  p.step(5000)
  assert.equal(p.hits, 0)
  assert.equal(p.frame().serve, 2)
  p.paddle(2, p.x, p.y, true)
  p.step(16)
  assert.equal(p.hits, 1)
  assert.equal(p.frame().serve, 0)
  assert.ok(p.frame().a?.length === 14)
  p.step(100)
  assert.ok(p.z > 2 / 12.16 && p.y > 0.24)
})

test('ping pong: contact launches outside the racket instead of through its centre', () => {
  for (const seat of [1, 2] as const) {
    const p = new PongSim(() => seat === 1 ? 0 : .5)
    p.paddle(seat, .2, seat === 1 ? 1.8 : 0)
    p.step(FIRST_SERVE_MS)
    p.paddle(seat, p.x, p.y, true)
    p.step(8)
    assert.equal(p.hits, 1)
    const gap = Math.hypot(p.x - p.paddles[seat - 1], p.y - p.paddleY[seat - 1])
    assert.ok(gap >= .205 - 1e-6, `clear contact, gap ${gap}`)
    assert.ok((p.y - p.paddleY[seat - 1]) * (seat === 1 ? -1 : 1) > 0)
    for (let i = 0; i < 10; i++) {
      p.step(8)
      assert.ok(Math.hypot(p.x - p.paddles[seat - 1], p.y - p.paddleY[seat - 1]) >= .2)
    }
  }
})

test('ping pong: the ball lands on the far half before an opponent can return it', () => {
  const p = new PongSim(() => 0.5)
  p.step(FIRST_SERVE_MS)
  p.paddle(1, 0.5, 1.8, true)
  run(p, () => p.bounces === 1)
  assert.equal(p.hits, 1, 'no volley before the table bounce')
  assert.ok(p.y > COURT_H / 2 && p.z <= BALL_R + 0.02)
  p.paddle(1, p.x, p.y, true)
  run(p, () => p.hits === 2)
  assert.deepEqual(p.score, [0, 0])
  assert.ok(p.frame().a)
})

test('ping pong: shot direction follows the stroke, with power setting depth and duration', () => {
  const stroke = (dx: number, dy: number) => {
    const p = manual()
    p.paddle(2, 0.5 - dx, 0.24 - dy)
    p.step(16)
    p.paddle(2, 0.5, 0.24)
    p.step(8)
    return p.frame().a!
  }
  const right = stroke(0.3, 0.03), left = stroke(-0.3, 0.03)
  assert.ok(right[9] > 0.75 && left[9] < 0.25, 'stroke aims across the table with room to land')
  const neutral = manual()
  neutral.paddle(2, .5, .24, true); neutral.step(8)
  const soft = neutral.frame().a!, hard = stroke(0, 0.3)
  assert.ok(hard[10] > soft[10], 'a forward stroke lands deeper')
  assert.ok(hard[13] < soft[13], 'a forward stroke travels faster')
})

test('ping pong: a brushing stroke spins the ball after release, without later racket motion redirecting it', () => {
  const brush = (release: boolean) => {
    const p = manual()
    p.paddle(2, 0.2, 0.21)
    p.step(16)
    p.paddle(2, 0.5, 0.24)
    p.step(8)
    const target = p.frame().a![9]
    if (release) p.paddle(2, 0.5, 0.24, true)
    p.step(64)
    return { p, target }
  }
  const active = brush(false), released = brush(true)
  assert.ok(active.p.frame().a![9] > active.target + 0.004)
  near(released.p.frame().a![9], active.p.frame().a![9])
  near(active.p.x, released.p.x)
  assert.ok(released.p.frame().spin > 0.36 && released.p.frame().spin < 0.4)
  const spin = released.p.frame().spin
  released.p.paddle(2, 0.2, 0.24)
  released.p.step(16)
  assert.ok(released.p.frame().spin > 0 && released.p.frame().spin < spin)
})

test('ping pong: equal-speed gestures at 30 and 60 Hz have equal power and spin', () => {
  const stroke = (ms: number) => {
    const p = manual()
    p.paddle(2, 0.05, -0.2)
    p.step(ms)
    p.paddle(2, 0.05 + ms / 1000, -0.2 + ms / 1000)
    // Contact on the following update uses the already sampled stroke.
    p.x = p.paddles[1]; p.y = p.paddleY[1]
    p.step(1)
    return p.frame()
  }
  const thirty = stroke(1000 / 30), sixty = stroke(1000 / 60)
  near(thirty.spin, sixty.spin)
  near(thirty.a![9], sixty.a![9]); near(thirty.a![10], sixty.a![10]); near(thirty.a![13], sixty.a![13])
})

test('ping pong: side and corner misses keep travelling outside instead of reflecting', () => {
  const p = manual()
  p.paddle(1, RACKET_MIN, 2.5, true)
  p.paddle(2, 0.2, 0.24)
  p.step(16)
  p.paddle(2, 0.5, 0.24)
  p.step(8)
  run(p, () => p.x > 1.02)
  assert.ok(p.vx > 0, 'continues right beyond the side edge')
  const outside = p.x
  p.step(16)
  assert.ok(p.x > outside && p.vx > 0, 'no hidden corner wall')
  run(p, () => p.score[0] + p.score[1] === 1)
})

test('ping pong: a rotated stroke lands before escaping, instead of easily missing the table', () => {
  const fault = manual()
  fault.paddle(1, RACKET_MIN, 2.5, true)
  fault.paddle(2, 0.2, 0.21); fault.step(16)
  fault.paddle(2, 0.5, 0.24); fault.step(8)
  run(fault, () => fault.score[0] + fault.score[1] === 1)
  assert.ok(fault.bounces > 0)
  assert.deepEqual(fault.score, [0, 1])

  const legal = new PongSim(() => 0.5)
  legal.paddle(1, RACKET_MIN)
  legal.step(FIRST_SERVE_MS)
  run(legal, () => legal.score[0] + legal.score[1] === 1)
  assert.ok(legal.bounces > 0)
  assert.deepEqual(legal.score, [0, 1])
  assert.deepEqual(legal.frame().b.slice(2), [0, 0])
})

test('ping pong: brushing spin kicks sideways on the table, while a plain block does not', () => {
  const p = manual()
  p.paddle(1, RACKET_MIN, 2.5, true)
  p.paddle(2, .2, .21); p.step(16); p.paddle(2, .5, .24); p.step(8)
  let incoming = p.vx / p.vy
  for (let i = 0; i < 200 && p.bounces === 0; i++) { incoming = p.vx / p.vy; p.step(8) }
  assert.equal(p.bounces, 1)
  assert.ok(p.x > .1 && p.x < .95, 'the spinning shot visibly touches the table')
  const a = p.frame().a!
  const outgoing = (a[9] - p.x) / (a[10] - p.y)
  assert.ok(outgoing > incoming + .05, 'sidespin changes direction at the bounce')

  const flat = new PongSim(() => .5)
  flat.paddle(1, RACKET_MIN); flat.step(FIRST_SERVE_MS)
  run(flat, () => flat.bounces === 1)
  near(flat.frame().spin, 0); near(flat.frame().a![9], .5)
})

test('ping pong: ordinary angled strokes have room to land on either side', () => {
  for (const dx of [-.3, -.2, .2, .3]) for (const dy of [.02, .035, .05]) {
    const p = manual()
    p.paddle(1, RACKET_MIN, 2.5, true)
    p.paddle(2, .5 - dx, .24 - dy); p.step(16)
    p.paddle(2, .5, .24); p.step(8)
    run(p, () => p.bounces > 0 || p.score[0] + p.score[1] > 0)
    assert.equal(p.bounces, 1, `stroke ${dx},${dy} lands`)
    assert.deepEqual(p.score, [0, 0])
  }
})

test('ping pong: a very hard stroke sails long off the table', () => {
  const p = manual()
  p.paddle(1, RACKET_MIN, 2.5, true)
  p.paddle(2, .5, -.06); p.step(16)
  p.paddle(2, .5, .24); p.step(8)
  run(p, () => p.score[0] + p.score[1] > 0)
  assert.equal(p.bounces, 0, 'never touches the table')
  assert.deepEqual(p.score, [1, 0], 'the hitter loses the point')
})

test('ping pong: a gentle angled placement aims without adding the brush kick', () => {
  const p = manual()
  p.paddle(2, .2, -.06); p.step(900)
  p.paddle(2, .5, .24); p.step(8)
  assert.ok(p.frame().a![9] > .65, 'placement still aims to the right')
  assert.equal(p.frame().spin, 0, 'rotation alone at low speed does not make every shot spin')
})

test('ping pong: a hard brush has at most twice the spin of a light brush', () => {
  const brush = (ms: number) => {
    const p = manual()
    p.paddle(2, .2, -.06); p.step(ms)
    p.paddle(2, .5, .24); p.step(8)
    return p.frame().spin
  }
  const light = brush(400), hard = brush(16)
  assert.ok(light >= .2 && hard > light * 1.5)
  assert.ok(hard <= light * 2 && hard <= .4)
})

test('ping pong: moving past the ball cannot return it with the back of the bat', () => {
  for (const seat of [1, 2] as const) {
    const p = new PongSim(() => seat === 1 ? 0 : .5)
    const forward = seat === 1 ? -1 : 1
    p.paddle(seat, p.x, p.y + forward * .1, true)
    p.step(FIRST_SERVE_MS); p.step(500)
    assert.equal(p.hits, 0)
    p.paddle(seat, p.x, p.y - forward * .19, true); p.step(8)
    assert.equal(p.hits, 1)
  }
})

test('ping pong: rackets reach beyond the edges, stay on their own side, and rotate symmetrically', () => {
  const p = manual()
  p.paddle(1, -4, -4); p.paddle(2, 4, 4)
  assert.deepEqual(p.paddles, [RACKET_MIN, RACKET_MAX])
  near(p.paddleY[0], 1.3); near(p.paddleY[1], COURT_H - 1.3)
  p.paddle(1, 0.5, 8); p.paddle(2, 0.5, -8)
  near(p.paddleY[0], 2.5); near(p.paddleY[1], COURT_H - 2.5)
})

test('ping pong: every two points changes server, first to seven finishes, pause preserves score', () => {
  const p = new PongSim(() => 0.5)
  p.paddle(1, RACKET_MIN); p.paddle(2, RACKET_MAX)
  p.step(FIRST_SERVE_MS)
  run(p, () => p.score[1] === 1)
  assert.equal(p.frame().serve, 2)
  p.step(1000)
  run(p, () => p.score[1] === 2)
  assert.equal(p.frame().serve, 1)
  p.holdServe(3000)
  assert.deepEqual(p.score, [0, 2])
  assert.equal(p.countdownMs, 3000)
  run(p, () => p.outcome !== null, 20_000)
  assert.equal(Math.max(...p.score), 7)
  assert.equal(p.outcome?.reason, 'first_to_7')
  assert.ok(p.frame().z.every(Number.isFinite))
})

test('ping pong: swipe speed controls depth smoothly from short to the end line; only a smash goes long', () => {
  const land = (speed: number) => {
    const p = new PongSim(() => 0.5)
    p.paddle(1, RACKET_MIN, 2.5, true)
    p.paddle(2, 0.5, -0.5); p.step(3000)
    let y = -0.5
    while (p.hits === 0 && y < 0.6) { y += speed / 60; p.step(1000 / 60); p.paddle(2, 0.5, y) }
    run(p, () => p.bounces > 0 || p.score[0] + p.score[1] > 0)
    return p.bounces ? p.y : Infinity
  }
  const depths = [1, 3, 6, 10].map(land)
  for (let i = 1; i < depths.length; i++) assert.ok(depths[i] > depths[i - 1] + 0.05, `deeper with speed: ${depths}`)
  assert.ok(depths[0] < 1.35, 'a soft touch lands short')
  assert.ok(depths[3] > 1.7 && depths[3] < COURT_H, 'a strong swipe reaches the end line')
  assert.equal(land(14), Infinity, 'a smash sails long')
})

test('ping pong: even a short hard-spin shot turns at most ~20 degrees at the bounce', () => {
  for (const side of [-1, 1]) {
    const p = new PongSim(() => 0.5)
    p.paddle(1, RACKET_MIN, 2.5, true)
    // A short ball brushed hard sideways: the old exploit.
    p.paddle(2, 0.5 - side * 0.3, 0.22); p.step(3000)
    p.paddle(2, 0.5 - side * 0.3, 0.22); p.step(16)
    p.paddle(2, 0.5, 0.24); p.step(8)
    assert.ok(Math.abs(p.frame().spin) > 0.3, 'hard brush spins')
    let before = 0
    for (let i = 0; i < 400 && !p.bounces; i++) { before = Math.atan2(p.vx, p.vy); p.step(8) }
    assert.equal(p.bounces, 1)
    p.step(24)
    const after = Math.atan2(p.vx, p.vy)
    const turned = Math.abs(after - before) * 180 / Math.PI
    assert.ok(turned > 3 && turned < 22, `turned ${turned.toFixed(1)} deg`)
  }
})

test('ping pong: razor spin is rare, needs a maximal brush, breaks sharply and loses pace', () => {
  const shot = (random: number, dx: number) => {
    const rolls = [0.5, random] // first roll picks seat 2 to serve, the next is the razor roll
    const p = new PongSim(() => rolls.shift() ?? random)
    p.paddle(1, RACKET_MIN, 2.5, true)
    p.paddle(2, 0.5 - dx, 0.22); p.step(3000)
    p.paddle(2, 0.5 - dx, 0.22); p.step(16)
    p.paddle(2, 0.5, 0.24); p.step(8)
    return p.frame().spin
  }
  assert.ok(Math.abs(shot(0.5, 0.3)) <= 0.4, 'no razor without luck') // random .5 > chance
  assert.ok(Math.abs(shot(0.1, 0.3)) > 0.55, 'a maximal brush can razor')
  assert.ok(Math.abs(shot(0.1, 0.05)) < 0.3, 'a gentle brush never razors, even with luck')
})

test('ping pong: network jitter in paddle updates barely changes stroke power', () => {
  const power = (gaps: number[]) => {
    const p = new PongSim(() => 0.5)
    p.paddle(1, RACKET_MIN, 2.5, true)
    p.paddle(2, 0.5, -0.5); p.step(3000)
    let y = -0.5, t = 0
    for (const gap of gaps) {
      p.step(gap); t += gap
      y = Math.min(0.24, -0.5 + 6 * (t / 1000)) // a steady 6 table widths/s swipe; clients stop the bat at the ball
      p.paddle(2, 0.5, y)
      if (p.hits) break
    }
    return p.frame().a![10]
  }
  const even = power(Array(40).fill(33))
  const bunched = power(Array.from({ length: 40 }, (_, i) => i % 2 ? 61 : 5))
  assert.ok(Math.abs(even - bunched) < 0.05, `even ${even} vs bunched ${bunched}`)
})
