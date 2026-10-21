import type { Outcome, Seat } from './rules.js'

// Ping Pong: server-owned strokes and cubic flights over an open table.
// Coordinates are table widths: x across, y along, z above the surface.
export const COURT_H = 1.8
export const HEAD_R = 0.137
export const BALL_R = 0.033
export const HIT_SLACK = 0.025
export const RACKET_MIN = -0.26
export const RACKET_MAX = 1.26
export const RACKET_NEAR = 1.3
export const RACKET_FAR = 2.5
export const ARC_H = 6 / 12.16
export const FLOOR_H = -ARC_H
export const SPIN_DRIFT = 0.8
export const SPIN_TAU = 1.8
export const SPIN_LIGHT = 0.25 // A light brush; a hard brush doubles it.
export const BOUNCE_TURN = 1.1 // radians of heading change per unit spin: light ~16 deg, hard ~29 deg
export const BOUNCE_TURN_MAX = 0.5 // never more than ~29 deg
export const BOUNCE_CHECK = 0.4 // hard spin keeps ~84% of its pace after the bounce
// Razor spin: a rare, sharp break. Only a near-maximal brush qualifies, and then only by chance, so it
// cannot be repeated on demand; it also loses pace so a quick opponent can still reach it.
export const RAZOR_BRUSH = 0.85
export const RAZOR_CHANCE = 0.15
export const RAZOR_SPIN = 0.7
export const RAZOR_TURN = 0.8 // ~46 deg
// Forward racket speed (table widths/s) -> power. Saturates softly so a committed swipe is deep, not out;
// pulling back gives a short, soft touch.
export const strokePower = (speed: number) => speed >= 0 ? 1 - Math.exp(-speed / 5) : clamp(speed * STROKE_GAIN, -0.5, 0)
// Target depth past the half centre. Power 0 lands just over the net, ~.85 on the end line; a smash beyond sails long.
export const shotDepth = (power: number) => -0.03 + power * 0.706 + Math.max(0, power - 0.85) * 4
export const AIM_GAIN = 0.5 // full sideways stroke reaches the corners
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
  private spin = 0
  private razor = false
  private server: Seat
  private random: () => number

  readonly target: number

  constructor(random: () => number = Math.random, target = WIN_SCORE) {
    this.random = random
    this.target = target
    this.server = random() < 0.5 ? 1 : 2
    this.y = serveY(this.server)
  }

  private emptyStroke(): Stroke { return { side: 0, forward: 0, direction: 0 } }

  paddle(seat: Seat, x: number, y?: number, released = false): void {
    const i = seat - 1
    const nextX = clamp(x, RACKET_MIN, RACKET_MAX)
    const nextY = y === undefined ? this.paddleY[i] : seat === 1
      ? clamp(y, RACKET_NEAR, RACKET_FAR)
      : COURT_H - clamp(COURT_H - y, RACKET_NEAR, RACKET_FAR)
    if (y !== undefined) this.modern[i] = true
    // Stroke velocity over a ~50 ms window, not packet to packet: network jitter bunches paddle updates,
    // and a per-packet speed would turn the same swipe into a random smash or a dead ball.
    const samples = this.samples[i]
    if (released) samples.length = 0
    else {
      samples.push([this.clock, nextX, nextY])
      while (samples.length > 2 && samples[1][0] <= this.clock - STROKE_WINDOW_MS) samples.shift()
      // A bat resting before the swipe: measure from its last rest, not from long ago.
      while (samples.length > 2 && samples[0][0] < this.clock - 2 * STROKE_WINDOW_MS) samples.shift()
    }
    const still = Math.hypot(nextX - this.paddles[i], nextY - this.paddleY[i]) < 1e-5
    const ref = samples[0]
    const dx = ref ? nextX - ref[1] : 0, dy = ref ? nextY - ref[2] : 0
    const dt = ref ? (this.clock - ref[0]) / 1000 : 0
    if (released || still || Math.hypot(dx, dy) < 1e-5) this.strokes[i] = this.emptyStroke()
    else if (dt > 0) {
      const speedX = dx / Math.max(dt, 1 / 60)
      const speedY = dy / Math.max(dt, 1 / 60)
      this.strokes[i] = {
        side: clamp(speedX * STROKE_GAIN, -1, 1),
        forward: strokePower(speedY * forward(seat)),
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
    for (let left = ms / 1000; left > 1e-8 && this.flight && !this.outcome; left -= 0.008) this.advance(Math.min(left, 0.008))
  }

  private touches(seat: Seat): boolean {
    return this.z >= -BALL_R && (this.y - this.paddleY[seat - 1]) * forward(seat) >= -0.001
      && Math.hypot(this.x - this.paddles[seat - 1], this.y - this.paddleY[seat - 1]) <= HEAD_R + BALL_R + HIT_SLACK
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
    // A ball still carrying sidespin deflects off the bat in its spin direction.
    const target: Point = [0.5 + stroke.direction * AIM_GAIN * (0.85 + 0.15 * stroke.forward) + (this.lastHit === other(seat) ? this.spin * 0.3 : 0),
      (seat === 1 ? 0.49 : COURT_H - 0.49) + forward(seat) * shotDepth(stroke.forward), FLOOR_H]
    const px = this.paddles[seat - 1], py = this.paddleY[seat - 1]
    const dx = target[0] - px, dy = target[1] - py, length = Math.hypot(dx, dy)
    // Launch out of the head along the shot, so a brushing return cannot cut through the racket.
    const clearance = HEAD_R + BALL_R + 0.035 // Includes the drawn outlines and height-scaled ball.
    this.x = px + dx / length * clearance
    this.y = py + dy / length * clearance
    this.curve(target, 1 - 0.22 * stroke.forward)
    this.lastHit = seat
    this.landed = false
    const brush = Math.abs(stroke.direction) > 0.3 ? stroke.side : 0
    // Sidespin hooks against the brush (Magnus): a stroke across the ball to the right curves it back left,
    // so a wide brushed shot bends in toward the table instead of further out.
    this.spin = Math.abs(brush) <= 0.08 ? 0 : -Math.sign(brush) * (SPIN_LIGHT + SPIN_LIGHT * Math.min(1, (Math.abs(brush) - 0.08) / 0.6))
    this.razor = Math.abs(brush) >= RAZOR_BRUSH && this.random() < RAZOR_CHANCE
    if (this.razor) this.spin = -Math.sign(brush) * RAZOR_SPIN
    this.hits++
  }

  private advance(dt: number): void {
    const flight = this.flight!
    const [oldX, oldY, oldZ] = [this.x, this.y, this.z]
    const decay = Math.exp(-dt / SPIN_TAU)
    flight.points[3][0] += this.spin * SPIN_DRIFT * SPIN_TAU * (1 - decay)
    this.spin *= decay
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
        // Sidespin turns the ball's heading by a capped angle and checks it slightly. An angle, not a sideways
        // velocity, so a slow short ball cannot shoot off sideways where nobody could reach it.
        const turn = this.razor ? Math.sign(this.spin) * RAZOR_TURN : clamp(this.spin * BOUNCE_TURN, -BOUNCE_TURN_MAX, BOUNCE_TURN_MAX)
        const heading = Math.atan2(this.vx, this.vy) + turn
        const across = Math.hypot(this.vx, this.vy)
        const kickX = across * Math.sin(heading), kickY = across * Math.cos(heading)
        const length = Math.hypot(kickX, kickY, this.vz) || 1
        const reach = (30 / 12.16) * (1 - BOUNCE_CHECK * Math.min(0.7, Math.abs(this.spin)))
        this.curve([x + kickX / length * reach, y + kickY / length * reach, FLOOR_H], flight.duration)
      }
    }
    if (this.landed && this.lastHit && this.touches(other(this.lastHit))) {
      this.strike(other(this.lastHit))
    } else if (this.z <= FLOOR_H || (this.flight === flight && flight.elapsed >= flight.duration)) {
      this.point(this.landed ? this.lastHit! : other(this.lastHit!))
    }
  }

  private resetBall(): void {
    this.flight = null; this.lastHit = null; this.landed = false
    this.spin = 0; this.razor = false
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
      serve: this.flight || this.outcome ? 0 : this.server, j: this.bounces, l: this.landed,
    }
  }
}
