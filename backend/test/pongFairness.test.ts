import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BALL_R, COURT_H, PongSim, RACKET_FAR, RACKET_MAX, RACKET_MIN, RACKET_NEAR, contactRadius } from '../src/games/pong.js'
import { StrokeWindow, type Stroke } from '../src/games/pongPhysics.js'

// Deterministic sweep: seat 2 hits toward seat 1, who starts at the neutral baseline (.5, COURT_H + .08).
// The receiver's bat may move at BAT_SPEED (a fast finger through racketFollow) after REACTION_S.
// Before the 2026-10-24 tuning (2430 shots, 1950 on table): hit-to-bounce 456..744 ms, receiver-half
// speed 5.33 w/s, post-bounce 5.29 w/s (5.28x incoming), 158 landings under 250 ms reachable, 14 never.
const BAT_SPEED = 6, REACTION_S = .2, DT = 8
type Sim = { x: number; y: number; z: number; clock: number; countdownMs: number; landed: boolean; hits: number
  score: [number, number]; paddles: [number, number]; strokes: [Stroke, Stroke]; contactStrokes: [Stroke | null, Stroke | null]
  moved: [number, number]; flight: unknown; strike(seat: 1 | 2): void }

const start: [number, number] = [.5, COURT_H + .08]
const reachable = (bx: number, by: number, r: number, budget: number) => {
  if (budget < 0) return false
  // Candidate bat centres inside the legal region and within the contact radius of the ball.
  for (let k = 0; k <= 48; k++) {
    const angle = k * Math.PI / 8, d = k === 0 ? 0 : r * (1 + ((k - 1) >> 4)) / 3
    const qx = bx + Math.cos(angle) * d, qy = by + Math.sin(angle) * d
    if (qx < RACKET_MIN || qx > RACKET_MAX || qy < RACKET_NEAR || qy > RACKET_FAR) continue
    if (Math.hypot(qx - start[0], qy - start[1]) <= budget) return true
  }
  return false
}

export function shot(sx: number, sy: number, hx: number, hy: number, steer: number, steerAfterBounce: boolean) {
  const window = new StrokeWindow()
  window.sample(1000, 0, 0, 1); const stroke = window.sample(1050, sx * .05, sy * .05, 1)
  const p = new PongSim(() => .75)
  const s = p as unknown as Sim
  s.countdownMs = 0; s.x = hx; s.y = hy; s.z = .1
  s.paddles[0] = 100 // receiver never contacts; reachability is measured analytically
  s.contactStrokes[1] = { ...stroke }; s.strike(2)
  let t = 0, bounceAt = -1, vIn = 0, maxPre = 0, maxHalf = 0, maxPost = 0, window_ = 0, firstReach = -1, landX = 0, landY = 0
  let px = p.x, py = p.y
  while (s.flight && t < 5000) {
    s.strokes[1] = { ...emptyLike(), side: steerAfterBounce && !s.landed ? 0 : steer }; s.moved[1] = s.clock
    const wasLanded = s.landed
    p.step(DT); t += DT
    if (!s.flight) break
    const v = Math.hypot(p.x - px, p.y - py) / (DT / 1000)
    if (!wasLanded && s.landed) { bounceAt = t; vIn = Math.hypot(p.vx, p.vy); landX = p.x; landY = p.y }
    else if (wasLanded) maxPost = Math.max(maxPost, v)
    else maxPre = Math.max(maxPre, v)
    if (p.y > COURT_H / 2 && !(!wasLanded && s.landed)) maxHalf = Math.max(maxHalf, v)
    if (s.landed && p.z >= -BALL_R && reachable(p.x, p.y, contactRadius(p.z), BAT_SPEED * (t / 1000 - REACTION_S))) {
      window_ += DT; if (firstReach < 0) firstReach = t
    }
    px = p.x; py = p.y
  }
  return { landed: bounceAt >= 0, bounceAt, vIn, maxPre, maxHalf, maxPost, window: window_, firstReach, landX, landY, stroke }
}
const emptyLike = (): Stroke => ({ side: 0, forward: 0, direction: 0, power: 0 })

export function sweep() {
  const results = []
  for (const sx of [-12, -8, -4, -2, 0, 2, 4, 8, 12]) for (const sy of [-4, -1, .5, 2, 4, 6, 8, 10, 14])
    for (const hx of [.1, .5, .9]) for (const hy of [-.2, .3])
      for (const [steer, after] of [[0, false], [1, false], [-1, false], [1, true], [-1, true]] as const)
        results.push({ sx, sy, hx, hy, steer, after, ...shot(sx, sy, hx, hy, steer, after) })
  const on = results.filter(r => r.landed)
  const worst = on.reduce((a, b) => b.window < a.window ? b : a)
  const summary = {
    shots: results.length, onTable: on.length,
    fastestBounceMs: Math.min(...on.map(r => r.bounceAt)), slowestBounceMs: Math.max(...on.map(r => r.bounceAt)),
    maxReceiverHalfSpeed: +Math.max(...on.map(r => r.maxHalf)).toFixed(3),
    maxPostBounceSpeed: +Math.max(...on.map(r => r.maxPost)).toFixed(3),
    slowestPostBouncePeak: +Math.min(...on.map(r => r.maxPost)).toFixed(3),
    maxPostOverShotPeak: +Math.max(...on.map(r => r.maxPost / r.maxPre)).toFixed(3),
    minWindowMs: worst.window, under250: on.filter(r => r.window < 250).length, unreachable: on.filter(r => r.window === 0).length,
    worst: { sx: worst.sx, sy: worst.sy, hx: worst.hx, hy: worst.hy, steer: worst.steer, after: worst.after,
      land: [+worst.landX.toFixed(3), +worst.landY.toFixed(3)] },
  }
  return { results, summary }
}

test('ping pong fairness: every on-table shot is slower and leaves a reachable return window', () => {
  const { summary } = sweep()
  console.log(JSON.stringify(summary))
  assert.ok(summary.onTable > 500)
  assert.ok(summary.fastestBounceMs >= 600, 'hard hits reach the table noticeably later than the old .46 s')
  assert.ok(summary.maxPostOverShotPeak <= 1.02, 'the bounce never outruns the shot peak pace')
  assert.ok(summary.minWindowMs >= 250, 'every legal landing leaves at least 250 ms of reachable contact')
})

test('ping pong fairness: bat movement after contact never steers the ball', () => {
  const rally = (move: boolean) => {
    const p = new PongSim(() => .75)
    p.paddle(1, 1.26, 2.5, true); p.paddle(2, .4, -.2); p.step(3000)
    p.paddle(2, .4, -.2); p.step(16); p.paddle(2, .5, .24); p.step(8)
    assert.equal(p.hits, 1)
    const path: number[][] = []
    for (let i = 0, x = .5; i < 200 && p.score[0] + p.score[1] === 0; i++) {
      if (move) { x += i % 60 < 30 ? .03 : -.03; p.paddle(2, x, .24) }
      p.step(16); path.push([...p.frame().b, ...p.frame().z, p.frame().spin, p.frame().drift])
    }
    return path
  }
  const still = rally(false)
  assert.ok(still.some(f => f[6] !== 0), 'the contact stroke carries its own curve')
  assert.deepEqual(rally(true), still)
})
