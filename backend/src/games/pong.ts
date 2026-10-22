import type { Outcome, Seat } from './rules.js'

// Ping Pong: server-owned strokes and cubic flights over an open table.
// Coordinates are table widths: x across, y along, z above the surface.
export const COURT_H = 1.8
export const HEAD_R = 0.137
export const BALL_R = 0.033
export const HEAD_OUTLINE = 0.025
export const RACKET_MIN = -0.26
export const RACKET_MAX = 1.26
export const RACKET_NEAR = 1.3
export const RACKET_FAR = 2.5
export const ARC_H = 6 / 12.16
export const FLOOR_H = -ARC_H
// Reference: endpoint moves .3 world units per 20 ms tick; expressed in table widths/second.
export const SPIN_DRIFT = 0.3 / 12.16 / 0.02
export const AIM_GAIN = 8 / 12.16
// Convert network velocity into the reference's per-frame world delta at 60 Hz.
const STROKE_GAIN = 12.16 / 60
const STROKE_WINDOW_MS = 50
export const WIN_SCORE = 7
export const FIRST_SERVE_MS = 3000
export const NEXT_SERVE_MS = 1000

type Point = [number, number, number]
type Stroke = { side: number; forward: number; direction: number }
type Flight = { points: [Point, Point, Point, Point]; elapsed: number; duration: number }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r4 = (v: number) => Math.round(v * 10_000) / 10_000
const other = (seat: Seat): Seat => seat === 1 ? 2 : 1
const forward = (seat: Seat) => seat === 1 ? -1 : 1
const serveY = (seat: Seat) => seat === 1 ? COURT_H - 0.24 : 0.24
export const contactRadius = (height: number) => HEAD_R + HEAD_OUTLINE / 2 + BALL_R * 1.35 * (1 + 0.7 * clamp(height / ARC_H, 0, 1))

export const flightPosition = (points: readonly Point[], time: number): Point => {
  const t = clamp(time, 0, 1)
  const u = (t * t * t - 2 * t * t + t) * 1.363 + (-2 * t * t * t + 3 * t * t) + (t * t * t - t * t) * 0.3368
  const a = 1 - u
  return [0, 1, 2].map(i => a ** 3 * points[0][i] + 3 * a * a * u * points[1][i] + 3 * a * u * u * points[2][i] + u ** 3 * points[3][i]) as Point
}

export interface PongFrame {
  b: [number, number, number, number]
  p: [number, number]
  s: [number, number]
  c: number
  h: number
  w: number
  z: [number, number]
  r: [number, number]
  a: number[] | null
  spin: number
  drift: number
  serve: number
  j: number
  l: boolean
}

export class PongSim {
  x = 0.5
  y = COURT_H - 0.24
  z = 2 / 12.16
  vx = 0
  vy = 0
  vz = 0
  paddles: [number, number] = [0.5, 0.5]
  paddleY: [number, number] = [COURT_H + 0.08, -0.08]
  score: [number, number] = [0, 0]
  countdownMs = FIRST_SERVE_MS
  hits = 0
  bounces = 0
  outcome: Outcome | null = null
  private clock = 0
  private moved: [number, number] = [-1, -1]
  private samples: [[number, number, number][], [number, number, number][]] = [[], []]
  private modern: [boolean, boolean] = [false, false]
  private strokes: [Stroke, Stroke] = [this.emptyStroke(), this.emptyStroke()]
  private flight: Flight | null = null
  private lastHit: Seat | null = null
  private landed = false
  private server: Seat

  readonly target: number

  constructor(random: () => number = Math.random, target = WIN_SCORE) {
    this.target = target
    this.server = random() < 0.5 ? 1 : 2
    this.y = serveY(this.server)
  }

  private emptyStroke(): Stroke { return { side: 0, forward: 0, direction: 0 } }
  private get spin(): number { return this.lastHit ? this.strokes[this.lastHit - 1].side : 0 }

  paddle(seat: Seat, x: number, y?: number, released = false, touch?: [number, number]): void {
    const i = seat - 1
    const nextX = clamp(x, RACKET_MIN, RACKET_MAX)
    let nextY = y === undefined ? this.paddleY[i] : seat === 1
      ? clamp(y, RACKET_NEAR, RACKET_FAR)
      : COURT_H - clamp(COURT_H - y, RACKET_NEAR, RACKET_FAR)
    const inputY = nextY
    const ready = this.flight ? this.landed && this.lastHit === other(seat) : this.server === seat && this.countdownMs === 0
    const radius = contactRadius(this.z)
    const across = nextX - this.x
    if (ready && this.z >= -BALL_R && Math.abs(across) < radius) {
      const front = this.y - forward(seat) * Math.sqrt(radius * radius - across * across)
      if ((this.paddleY[i] - front) * forward(seat) <= 0 && (nextY - front) * forward(seat) > 0) nextY = front
    }
    if (y !== undefined) this.modern[i] = true
    const sampleX = touch ? clamp(touch[0], RACKET_MIN, RACKET_MAX) : nextX
    const sampleY = touch ? (seat === 1 ? clamp(touch[1], RACKET_NEAR, RACKET_FAR)
      : COURT_H - clamp(COURT_H - touch[1], RACKET_NEAR, RACKET_FAR)) : inputY
    // Stroke velocity over a ~50 ms window, not packet to packet: network jitter bunches paddle updates,
    // and a per-packet speed would turn the same swipe into a random smash or a dead ball.
    const samples = this.samples[i]
    const previous = samples.at(-1)
    const still = Math.hypot(sampleX - (previous?.[1] ?? this.paddles[i]), sampleY - (previous?.[2] ?? this.paddleY[i])) < 1e-5
    if (released) samples.length = 0
    else {
      samples.push([this.clock, sampleX, sampleY])
      while (samples.length > 2 && samples[1][0] <= this.clock - STROKE_WINDOW_MS) samples.shift()
      // A bat resting before the swipe: measure from its last rest, not from long ago.
      while (samples.length > 2 && samples[0][0] < this.clock - 2 * STROKE_WINDOW_MS) samples.shift()
    }
    const ref = samples[0]
    const dx = ref ? sampleX - ref[1] : 0, dy = ref ? sampleY - ref[2] : 0
    const dt = ref ? (this.clock - ref[0]) / 1000 : 0
    if (released || still || Math.hypot(dx, dy) < 1e-5) this.strokes[i] = this.emptyStroke()
    else if (dt > 0) {
      const speedX = dx / Math.max(dt, 1 / 60)
      const speedY = dy / Math.max(dt, 1 / 60)
      this.strokes[i] = {
        side: clamp(speedX * STROKE_GAIN, -1, 1),
        forward: clamp(speedY * forward(seat) * STROKE_GAIN, -0.5, 1),
        direction: y === undefined ? clamp(speedX * STROKE_GAIN, -1, 1) : dx / Math.hypot(dx, dy),
      }
    }
    this.paddles[i] = nextX
    this.paddleY[i] = nextY
    this.moved[i] = released ? -1 : this.clock
  }

  holdServe(ms: number): void {
    if (this.outcome) return
    this.resetBall()
    this.countdownMs = Math.max(this.countdownMs, ms)
  }

  step(ms: number): void {
    if (this.outcome || ms <= 0) return
    this.clock += ms
    for (const i of [0, 1]) if (this.clock - this.moved[i] > 120) this.strokes[i] = this.emptyStroke()
    if (this.countdownMs > 0) {
      this.countdownMs = Math.max(0, this.countdownMs - ms)
      if (this.countdownMs === 0 && !this.modern[this.server - 1]) this.strike(this.server)
      return
    }
    if (!this.flight) {
      if (this.touches(this.server)) this.strike(this.server)
      return
    }
    if (this.landed && this.lastHit && this.touches(other(this.lastHit))) this.strike(other(this.lastHit))
    for (let left = ms / 1000; left > 1e-8 && this.flight && !this.outcome; left -= 0.008) this.advance(Math.min(left, 0.008))
  }

  private touches(seat: Seat): boolean {
    return this.z >= -BALL_R && (this.y - this.paddleY[seat - 1]) * forward(seat) >= -0.001
      && Math.hypot(this.x - this.paddles[seat - 1], this.y - this.paddleY[seat - 1]) <= contactRadius(this.z) + 1e-6
  }

  private curve(target: Point, duration: number): void {
    const start: Point = [this.x, this.y, this.z]
    this.flight = {
      points: [start, [start[0] + (target[0] - start[0]) * 0.2, start[1] + (target[1] - start[1]) * 0.2, ARC_H], [target[0], target[1], ARC_H], target],
      elapsed: 0, duration,
    }
  }

  private strike(seat: Seat): void {
    const stroke = this.strokes[seat - 1]
    const target: Point = [0.5 + stroke.direction * AIM_GAIN * (0.7 + 0.3 * stroke.forward),
      COURT_H / 2 + forward(seat) * (5 + 7 * stroke.forward) / 12.16, FLOOR_H]
    this.curve(target, 0.9 - 0.2 * stroke.forward)
    this.lastHit = seat
    this.landed = false
    this.hits++
  }

  private advance(dt: number): void {
    const flight = this.flight!
    const [oldX, oldY, oldZ] = [this.x, this.y, this.z]
    flight.points[3][0] += this.spin * SPIN_DRIFT * dt
    flight.elapsed += dt
    const position = flightPosition(flight.points, flight.elapsed / flight.duration)
    this.x = position[0]; this.y = position[1]; this.z = position[2]
    this.vx = (this.x - oldX) / dt
    this.vy = (this.y - oldY) / dt
    this.vz = (this.z - oldZ) / dt
    if (oldZ > BALL_R && this.z <= BALL_R && this.vz < 0) {
      const t = (oldZ - BALL_R) / (oldZ - this.z)
      const x = oldX + (this.x - oldX) * t, y = oldY + (this.y - oldY) * t
      if (x >= 0 && x <= 1 && y >= 0 && y <= COURT_H) {
        if (this.landed) { this.point(this.lastHit!); return }
        this.x = x; this.y = y; this.z = BALL_R
        this.landed = true
        this.bounces++
        const length = Math.hypot(this.vx, this.vy, this.vz) || 1
        const reach = 30 / 12.16
        this.curve([x + this.vx / length * reach, y + this.vy / length * reach, BALL_R + FLOOR_H], flight.duration)
      }
    }
    if (this.landed && this.lastHit && this.touches(other(this.lastHit))) {
      // Resolve against the painted front surface, rather than accepting an already overlapping ball.
      const seat = other(this.lastHit), across = this.x - this.paddles[seat - 1]
      const radius = contactRadius(this.z)
      this.y = this.paddleY[seat - 1] + forward(seat) * Math.sqrt(Math.max(0, radius * radius - across * across))
      this.strike(other(this.lastHit))
    } else if (this.z <= FLOOR_H || (this.flight === flight && flight.elapsed >= flight.duration)) {
      this.point(this.landed ? this.lastHit! : other(this.lastHit!))
    }
  }

  private resetBall(): void {
    this.flight = null; this.lastHit = null; this.landed = false
    this.x = 0.5; this.y = serveY(this.server); this.z = 2 / 12.16
    this.vx = 0; this.vy = 0; this.vz = 0
    this.strokes = [this.emptyStroke(), this.emptyStroke()]
    this.moved = [-1, -1]
    this.samples = [[], []]
  }

  private point(seat: Seat): void {
    this.score[seat - 1]++
    if ((this.score[0] + this.score[1]) % 2 === 0) this.server = other(this.server)
    this.resetBall()
    // 'first_to_7' keeps the classic reason for older apps; other targets are 'first_to_points'.
    if (this.score[seat - 1] >= this.target) this.outcome = { winner: seat, reason: this.target === WIN_SCORE ? 'first_to_7' : 'first_to_points' }
    else this.countdownMs = NEXT_SERVE_MS
  }

  frame(): PongFrame {
    return {
      b: [r4(this.x), r4(this.y), r4(this.vx), r4(this.vy)],
      p: this.paddles.map(r4) as [number, number], s: [...this.score],
      c: Math.ceil(this.countdownMs), h: this.hits, w: 0,
      z: [r4(this.z), r4(this.vz)], r: this.paddleY.map(r4) as [number, number],
      a: this.flight ? [...this.flight.points.flat(), this.flight.elapsed, this.flight.duration].map(r4) : null,
      spin: r4(this.spin),
      drift: r4(this.spin * SPIN_DRIFT),
      serve: this.flight || this.outcome ? 0 : this.server, j: this.bounces, l: this.landed,
    }
  }
}
