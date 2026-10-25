import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BALL_R, COURT_H, PongSim, contactRadius } from '../src/games/pong.js'
import { StrokeWindow, type Stroke } from '../src/games/pongPhysics.js'
import { BAT_SPEED, DT, REACTION_S, reachable } from './pongReach.js'

// Deterministic sweep: seat 2 hits toward seat 1 (receiver model: pongReach.ts).
// Before the 2026-10-24 tuning (2430 shots, 1950 on table): hit-to-bounce 456..744 ms, receiver-half
// speed 5.33 w/s, post-bounce 5.29 w/s (5.28x incoming), 158 landings under 250 ms reachable, 14 never.
type Sim = { x: number; y: number; z: number; clock: number; countdownMs: number; landed: boolean; hits: number
  score: [number, number]; paddles: [number, number]; strokes: [Stroke, Stroke]; contactStrokes: [Stroke | null, Stroke | null]
  moved: [number, number]; flight: unknown; strike(seat: 1 | 2): void }

export function shot(sx: number, sy: number, hx: number, hy: number, steer: number, steerAfterBounce: boolean, hz = .1) {
  const window = new StrokeWindow()
  window.sample(1000, 0, 0, 1); const stroke = window.sample(1050, sx * .05, sy * .05, 1)
  const p = new PongSim(() => .75)
  const s = p as unknown as Sim
  s.countdownMs = 0; s.x = hx; s.y = hy; s.z = hz
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
const emptyLike = (): Stroke => ({ side: 0, forward: 0, direction: 0, power: 0, vx: 0, vy: 0 })

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
  // Topspin's lower arc (2026-10-25) lands the hardest drive at ~.59 s, still well after the old .46 s.
  assert.ok(summary.fastestBounceMs >= 580, 'hard hits reach the table noticeably later than the old .46 s')
  assert.ok(summary.maxPostOverShotPeak <= 1.02, 'the bounce never outruns the shot peak pace (topspin q=1.1 included)')
  assert.ok(summary.minWindowMs >= 250, 'every legal landing leaves at least 250 ms of reachable contact')
})

test('ping pong fairness: bat movement after contact never steers the ball', () => {
  const rally = (move: boolean) => {
    const p = new PongSim(() => .75)
    p.paddle(1, 1.26, 2.5, true); p.paddle(2, .4, -.2); p.step(3000)
    p.paddle(2, .4, -.2); p.step(16); p.paddle(2, .5, .24); p.step(8)
    assert.equal(p.hits, 1)
    const path: number[][] = []
    // Stop at the receiver's return: the hitter's later bat may legitimately play that next ball.
    for (let i = 0, x = .5; i < 200 && p.score[0] + p.score[1] === 0 && p.hits === 1; i++) {
      if (move) { x += i % 60 < 30 ? .03 : -.03; p.paddle(2, x, .24) }
      p.step(16); path.push([...p.frame().b, ...p.frame().z, p.frame().spin, p.frame().drift])
    }
    return path
  }
  const still = rally(false)
  assert.ok(still.some(f => f[6] !== 0), 'the contact stroke carries its own curve')
  assert.deepEqual(rally(true), still)
})

// Realistic swipes: total finger speed 2..14 widths/s at angle theta from straight forward, both sides,
// three contact x positions and three contact heights.
export function landingTable() {
  const rows: { theta: number; speed: number; sideways: number; landed: boolean; offset: number }[] = []
  for (let theta = 0; theta <= 90; theta += 5) for (let speed = 2; speed <= 14; speed++)
    for (const sign of [-1, 1]) for (const hx of [.1, .5, .9]) for (const hz of [.05, .2, .35]) {
      const rad = theta * Math.PI / 180, sx = sign * speed * Math.sin(rad), sy = speed * Math.cos(rad)
      const r = shot(sx, sy, hx, .24, 0, false, hz)
      rows.push({ theta, speed, sideways: Math.abs(sx), landed: r.landed, offset: r.landed ? Math.abs(r.landX - .5) : NaN })
    }
  return rows
}

test('ping pong fairness: every swipe lands in the table and hard swipes still go toward their side', () => {
  const rows = landingTable()
  const bucket = (t: number) => t <= 30 ? '0-30' : t <= 60 ? '31-60' : t <= 75 ? '61-75' : '76-90'
  const speed = (v: number) => v <= 6 ? '<=6' : v <= 9 ? '6-9' : '>9'
  const table: Record<string, string> = {}
  for (const b of ['0-30', '31-60', '61-75', '76-90']) for (const v of ['<=6', '6-9', '>9']) {
    const group = rows.filter(r => bucket(r.theta) === b && speed(r.sideways) === v)
    if (group.length) table[`${b} sideways ${v}`] = `${group.filter(r => r.landed).length}/${group.length} land`
  }
  console.log(JSON.stringify(table))
  for (const r of rows) {
    const name = JSON.stringify(r)
    // OVERHIT was removed on 2026-10-25: the landing is always within LATERAL_MAX (.42) of the centre line.
    assert.ok(r.landed && r.offset <= .421, `lands inside the table: ${name}`)
  }
  const visible = rows.filter(r => r.theta === 45 && r.speed === 14)
  assert.ok(visible.every(r => r.landed && r.offset > .3), 'a hard diagonal still goes well toward its side')
})
