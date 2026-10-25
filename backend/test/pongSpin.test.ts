import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BALL_R, COURT_H, PongSim, contactRadius } from '../src/games/pong.js'
import { bounce, emptyStroke, launch, strokeSpin, type Stroke } from '../src/games/pongPhysics.js'
import { BAT_SPEED, DT, REACTION_S, reachable } from './pongReach.js'
import { spinGolden, strokeAt } from './pongSpinGolden.js'

type Flight = { points: number[][]; duration: number }
type Sim = { x: number; y: number; z: number; countdownMs: number; landed: boolean; paddles: [number, number]
  contactStrokes: [Stroke | null, Stroke | null]; flight: Flight | null; ballSpin: [number, number]; strike(seat: 1 | 2): void }

/** Seat 2 strikes `stroke` at (hx, hy, hz) against a ball carrying spin [inS, inT]; seat 1 never contacts. */
function spinShot(stroke: Stroke, hx: number, hy: number, hz: number, inS = 0, inT = 0, fullWindow = false,
  afterStrike?: (s: Sim) => void) {
  const p = new PongSim(() => .75), s = p as unknown as Sim
  s.countdownMs = 0; s.x = hx; s.y = hy; s.z = hz; s.paddles[0] = 100; s.ballSpin = [inS, inT]
  s.contactStrokes[1] = { ...stroke }; s.strike(2)
  afterStrike?.(s)
  const shotFlight = { points: s.flight!.points.map(q => [...q]), duration: s.flight!.duration }
  let finite = shotFlight.points.flat().every(Number.isFinite) && Number.isFinite(shotFlight.duration) && p.frame().drift !== undefined
  let t = 0, window = 0, landX = NaN, landY = NaN, bounceFlight: Flight | null = null, spinAfter: number[] = []
  while (s.flight && t < 5000 && (fullWindow || window < 250)) {
    const was = s.landed
    p.step(DT); t += DT
    if (!s.flight) break
    finite &&= [p.x, p.y, p.z, p.vx, p.vy, p.vz].every(Number.isFinite)
    if (!was && s.landed) {
      landX = p.x; landY = p.y; spinAfter = p.frame().sp
      bounceFlight = { points: s.flight.points.map(q => [...q]), duration: s.flight.duration }
    }
    if (s.landed && p.z >= -BALL_R && reachable(p.x, p.y, contactRadius(p.z), BAT_SPEED * (t / 1000 - REACTION_S))) window += DT
  }
  return { p, shotFlight, bounceFlight, finite, landX, landY, window, spinAfter }
}

export function spinFuzz() {
  const failures: string[] = []
  let shots = 0, minWindow = Infinity, worst = '' // windows stop counting at 256 ms
  for (let angle = 0; angle < 360; angle += 15) for (const speed of [0, .5, 2, 4, 6, 8, 10, 14, 20]) {
    const stroke = strokeAt(angle, speed)
    for (const hx of [-.2, .1, .5, .9, 1.2]) for (const hy of [-.05, -.3]) for (const hz of [-.03, .05, .2, .45])
      for (const inS of [-1, 0, 1]) for (const inT of [-1, 0, 1]) {
        const r = spinShot(stroke, hx, hy, hz, inS, inT), name = JSON.stringify({ angle, speed, hx, hy, hz, inS, inT })
        shots++
        if (!r.finite) failures.push(`finite: ${name}`)
        if (!(r.shotFlight.duration >= .1 && r.shotFlight.duration <= 2)) failures.push(`shot duration: ${name}`)
        if (!(r.landX >= 0 && r.landX <= 1 && r.landY >= COURT_H / 2 && r.landY <= COURT_H))
          failures.push(`lands on the far half: ${name} at ${r.landX.toFixed(3)},${r.landY.toFixed(3)}`)
        else if (!(r.bounceFlight!.duration >= .1 && r.bounceFlight!.duration <= 2)) failures.push(`bounce duration: ${name}`)
        else if (r.window < minWindow) { minWindow = r.window; worst = name }
        if (r.landX >= 0 && r.window < 250) failures.push(`window ${r.window} ms: ${name}`)
      }
  }
  return { shots, minCappedWindowMs: minWindow, worst, failures }
}

test('ping pong spin fuzz: every stroke, contact and incoming spin lands on the far half and stays returnable', () => {
  const { failures, ...summary } = spinFuzz()
  console.log(JSON.stringify({ ...summary, failures: failures.length }))
  assert.equal(summary.shots, 24 * 9 * 5 * 2 * 4 * 9)
  assert.deepEqual(failures.slice(0, 20), [])
})

test('ping pong spin: a max-speed sideways swipe lands inside the table', () => {
  for (const angle of [90, 270]) for (const hx of [-.2, .5, 1.2]) {
    const r = spinShot(strokeAt(angle, 20), hx, -.05, .05, angle === 90 ? 1 : -1, 0)
    assert.ok(r.landX >= .07 && r.landX <= .93, `${angle} ${hx}: ${r.landX}`)
    assert.ok(angle === 90 ? r.landX > .85 : r.landX < .15, 'still goes hard toward its side')
  }
})

const bounceOf = (spin: [number, number]) => {
  const r = spinShot(strokeAt(0, 5), .5, -.05, .05, 0, 0, false, s => { s.ballSpin = spin })
  const [p0, p1, , p3] = r.bounceFlight!.points, reach = Math.hypot(p3[0] - p0[0], p3[1] - p0[1])
  return { reach, pace: reach / r.bounceFlight!.duration, height: p1[2], dx: p3[0] - p0[0], r }
}

test('ping pong spin: topspin skids longer, faster and lower after the bounce; backspin checks up short and slow', () => {
  const neutral = bounceOf([0, 0]), top = bounceOf([0, 1]), back = bounceOf([0, -1])
  assert.ok(top.reach > neutral.reach * 1.3 && top.pace > neutral.pace * 1.05 && top.height < neutral.height)
  assert.ok(back.reach < neutral.reach * .6 && back.pace < neutral.pace * .7 && back.height === neutral.height)
})

test('ping pong spin: sidespin curves in flight and kicks sideways at the bounce', () => {
  const right = launch(.5, -.05, .05, strokeAt(30, 10), 1), straight = launch(.5, -.05, .05, strokeAt(0, 10), 1)
  assert.ok(right[15] > .6 && right[14] > 0 && Math.abs(straight[14]) < 1e-9 && straight[15] === 0)
  const plain = bounceOf([0, 0]), kicked = bounceOf([1, 0]), left = bounceOf([-1, 0])
  assert.ok(Math.abs(plain.dx) < 1e-9 && kicked.dx > .1 && left.dx < -.1)
  near(kicked.dx, -left.dx)
})

test('ping pong spin: a passive block returns incoming spin; an active stroke overrides it', () => {
  const still = emptyStroke()
  const landing = (inS: number, inT: number, stroke = still) => { const a = launch(.5, -.05, .05, stroke, 1, inS, inT); return [a[9], a[10]] }
  const [neutralX, neutralY] = landing(0, 0)
  assert.ok(landing(1, 0)[0] > neutralX + .1 && landing(-1, 0)[0] < neutralX - .1, 'sidespin deflects a still bat')
  assert.ok(landing(0, 1)[1] > neutralY + .1 && landing(0, -1)[1] < neutralY - .1, 'topspin goes long, backspin short')
  const drive = strokeAt(0, 8)
  assert.deepEqual(landing(1, -1, drive), landing(0, 0, drive), 'a full-speed stroke is unaffected')
  const r = spinShot(still, .5, -.05, .05, 1, 0)
  assert.ok(r.landX > .6 && r.landX <= .92)
})

test('ping pong spin: frame sp carries the ball spin, decays at the bounce and clears on the point', () => {
  const stroke = strokeAt(45, 10), [S, T] = strokeSpin(stroke)
  const r = spinShot(stroke, .5, -.05, .05, 0, 0, true)
  assert.ok(S > .8 && T > .1)
  near(r.spinAfter[0], S * .6, 1e-4); near(r.spinAfter[1], T * .5, 1e-4)
  for (let i = 0; i < 1000 && r.p.score[0] + r.p.score[1] === 0; i++) r.p.step(DT)
  assert.deepEqual(r.p.score, [0, 1])
  assert.deepEqual(r.p.frame().sp, [0, 0])
  const fresh = new PongSim(() => .5)
  assert.deepEqual(fresh.frame().sp, [0, 0])
})

test('ping pong spin: golden fixture matches the shared launch and bounce math (Kotlin asserts the same file)', () => {
  const golden = JSON.parse(readFileSync(new URL('./fixtures/pong-spin-golden.json', import.meta.url), 'utf8'))
  assert.deepEqual(golden, JSON.parse(JSON.stringify(spinGolden())), 'regenerate with: npx tsx test/pongSpinGolden.ts')
  for (const c of golden.launch) launch(c.x, c.y, c.z, c.stroke, c.forwardSign, c.inS, c.inT).forEach((v, i) => near(v, c.expected[i], 1e-9))
  for (const c of golden.bounce) bounce(c.vx, c.vy, c.vz, c.pace, c.m, c.q).forEach((v, i) => near(v, c.expected[i], 1e-9))
  assert.ok(golden.launch.length >= 60 && golden.bounce.length >= 20)
})

function near(a: number, b: number, tolerance = 1e-9) { assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`) }
