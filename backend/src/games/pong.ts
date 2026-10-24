import type { Outcome, Seat } from './rules.js'
import { sweepContact, rimPosition, contactRadius, emptyStroke, StrokeWindow, flightDuration, bounce, type Stroke } from './pongPhysics.js'
export { contactRadius } from './pongPhysics.js'

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
export const MAX_COMP_MS = 500 // Hard limit; each seat gets clamp(server-measured RTT + 100, 250, 500).
const HISTORY_MS = 800
export const WIN_SCORE = 7
export const FIRST_SERVE_MS = 3000
export const NEXT_SERVE_MS = 1000

type Point = [number, number, number]
type Flight = { points: [Point, Point, Point, Point]; elapsed: number; duration: number }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r4 = (v: number) => Math.round(v * 10_000) / 10_000
const other = (seat: Seat): Seat => seat === 1 ? 2 : 1
const forward = (seat: Seat) => seat === 1 ? -1 : 1
const serveY = (seat: Seat) => seat === 1 ? COURT_H - 0.24 : 0.24
export type PaddleTiming = { ct: number; v: number; n: number; source?: string; rtt?: number }
export type PaddleSample = PaddleTiming & { x: number; y: number; released: boolean; touch: [number, number] }
type BatSample = PaddleTiming & { x: number; y: number; released: boolean }
type BallSample = { t: number; x: number; y: number; z: number; landed: boolean; lastHit: Seat | null;
  hits: number; flightId: number; serving: Seat | null }

export const flightPosition = (points: readonly Point[], time: number): Point => {
  const t = clamp(time, 0, 1)
  const u = (t * t * t - 2 * t * t + t) * 1.363 + (-2 * t * t * t + 3 * t * t) + (t * t * t - t * t) * 0.3368
  const a = 1 - u
  return [0, 1, 2].map(i => a ** 3 * points[0][i] + 3 * a * a * u * points[1][i] + 3 * a * u * u * points[2][i] + u ** 3 * points[3][i]) as Point
}

export interface PongFrame {
  t: number
  ack: [number, number]
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
  private samples = [new StrokeWindow(), new StrokeWindow()]
  private modern: [boolean, boolean] = [false, false]
  private strokes: [Stroke, Stroke] = [emptyStroke(), emptyStroke()]
  private contactStrokes: [Stroke | null, Stroke | null] = [null, null]
  private flight: Flight | null = null
  private lastHit: Seat | null = null
  private shotSide = 0
  private landed = false
  private server: Seat
  private previous: [BatSample | null, BatSample | null] = [null, null]
  private ack: [number, number] = [0, 0]
  private compensation: [number, number] = [250, 250]
  private viewLag: [number, number] = [0, 0]
  private autoV: [number, number] = [0, 0]
  private lastPaddleAt: [number, number] = [-Infinity, -Infinity]
  private replaying = false
  private flightId = 0
  private history: (BallSample | undefined)[] = new Array(160)
  private historyStart = 0
  private historySize = 0

  readonly target: number

  constructor(random: () => number = Math.random, target = WIN_SCORE, startTime = 0) {
    this.clock = startTime
    this.target = target
    this.server = random() < 0.5 ? 1 : 2
    this.y = serveY(this.server)
    this.remember()
  }

  // Curve is fixed by the stroke captured at contact and ends at the landing; later bat movement never steers.
  private get spin(): number { return this.lastHit && !this.landed ? this.shotSide : 0 }

  paddle(seat: Seat, x: number, y?: number, released = false, touch?: [number, number], timing?: PaddleTiming, now = this.clock): boolean {
    if (this.outcome || !Number.isFinite(x) || y !== undefined && !Number.isFinite(y)) return false
    const i = seat - 1
    const previous = this.previous[i]
    if (timing && (!Number.isSafeInteger(timing.ct) || timing.ct < 0 || !Number.isFinite(timing.v) ||
        !Number.isSafeInteger(timing.n) || timing.n <= this.ack[i] || previous && timing.source === previous.source && timing.ct <= previous.ct)) return false
    if (timing && (!previous || timing.source !== previous.source) || !timing && previous) this.samples[i].clear()
    const arrival = Math.max(now, this.clock)
    if (timing?.rtt !== undefined && Number.isFinite(timing.rtt) && timing.rtt >= 0)
      this.compensation[i] = clamp(timing.rtt + 100, 250, MAX_COMP_MS)
    const oldX = this.paddles[i], oldY = this.paddleY[i]
    const nextX = clamp(x, RACKET_MIN, RACKET_MAX)
    const nextY = y === undefined ? this.paddleY[i] : seat === 1
      ? clamp(y, RACKET_NEAR, RACKET_FAR)
      : COURT_H - clamp(COURT_H - y, RACKET_NEAR, RACKET_FAR)
    const inputX = nextX, inputY = nextY
    const radius = contactRadius(this.z)
    const ready = this.flight ? this.landed && this.lastHit === other(seat) : this.server === seat && this.countdownMs === 0
    let contacted = false
    if (!timing && ready && !this.contactStrokes[i] && this.z >= -BALL_R) {
      const contact = sweepContact([this.x, this.y], [this.x, this.y], [oldX, oldY], [nextX, nextY], radius, forward(seat))
      if (contact) {
        ;[this.x, this.y] = rimPosition(contact,
          [oldX + (nextX - oldX) * contact.time, oldY + (nextY - oldY) * contact.time], radius)
        contacted = ready
      }
    }
    if (y !== undefined) this.modern[i] = true
    const sampleX = touch ? clamp(touch[0], RACKET_MIN, RACKET_MAX) : inputX
    const sampleY = touch ? (seat === 1 ? clamp(touch[1], RACKET_NEAR, RACKET_FAR)
      : COURT_H - clamp(COURT_H - touch[1], RACKET_NEAR, RACKET_FAR)) : inputY
    const samples = this.samples[i]
    this.strokes[i] = samples.sample(timing?.ct ?? this.clock, sampleX, sampleY, forward(seat), y === undefined)
    const impactStroke = { ...this.strokes[i] }
    // Release clears live spin, but must not erase the strength already measured at impact.
    if (contacted && !this.contactStrokes[i]) this.contactStrokes[i] = { ...this.strokes[i] }
    if (released) { samples.clear(); this.strokes[i] = emptyStroke() }
    this.paddles[i] = nextX
    this.paddleY[i] = nextY
    this.moved[i] = released ? -1 : arrival
    if (timing) {
      const packet: BatSample = { ...timing, v: Math.max(previous?.v ?? -Infinity, clamp(timing.v, arrival - this.compensation[i], arrival)),
        x: nextX, y: nextY, released }
      this.previous[i] = packet; this.ack[i] = timing.n
      this.viewLag[i] = arrival - packet.v; this.autoV[i] = packet.v
      this.lastPaddleAt[i] = arrival
      this.judge(seat, previous ?? { ...packet, x: oldX, y: oldY }, packet, impactStroke, arrival)
    } else this.previous[i] = null
    return true
  }

  /** Replay unseen inputs, then catch up once so past release/steering changes retain their time. */
  paddleBatch(seat: Seat, samples: PaddleSample[], now = this.clock): boolean {
    const hits = this.hits
    let accepted = false
    this.replaying = true
    try {
      for (const sample of samples) {
        if (sample.n <= this.ack[seat - 1]) continue
        if (this.hits > hits) this.catchUp(Math.max(this.clock, clamp(sample.v, now - this.compensation[seat - 1], now)))
        accepted = this.paddle(seat, sample.x, sample.y, sample.released, sample.touch, sample, now) || accepted
        if (this.hits > hits) this.catchUp(Math.max(this.clock, clamp(sample.v, now - this.compensation[seat - 1], now)))
      }
      if (this.hits > hits) this.catchUp(now)
    } finally { this.replaying = false }
    return accepted
  }

  holdServe(ms: number): void {
    if (this.outcome) return
    this.resetBall()
    this.countdownMs = Math.max(this.countdownMs, ms)
  }

  step(ms: number, at = this.clock + ms): void {
    if (this.outcome || !Number.isFinite(ms) || ms <= 0 || !Number.isFinite(at) || at < this.clock) return
    const end = at
    // Preserve the existing capped simulation delta during a long event-loop stall.
    if (end - this.clock > ms) {
      const start = Math.max(this.clock, end - ms)
      this.clock = Math.max(this.clock, start - HISTORY_MS)
      while (this.clock < start) { this.clock = Math.min(start, this.clock + 8); this.remember() }
    }
    ms = end - this.clock
    for (const i of [0, 1]) if (end - this.moved[i] > 120) this.strokes[i] = emptyStroke()
    if (this.countdownMs > 0) {
      const before = this.countdownMs, start = this.clock
      while (this.clock < end) {
        this.clock = Math.min(end, this.clock + 8)
        this.countdownMs = Math.max(0, before - (this.clock - start)); this.remember()
      }
      if (this.countdownMs === 0 && !this.modern[this.server - 1]) this.strike(this.server)
      this.remember()
      this.stationaryContacts()
      return
    }
    if (!this.flight) {
      this.clock = end
      if (this.contactStrokes[this.server - 1] || this.touches(this.server)) this.strike(this.server)
      this.remember(); this.stationaryContacts(); return
    }
    if (this.landed && this.lastHit && (this.contactStrokes[other(this.lastHit) - 1] || this.touches(other(this.lastHit)))) this.strike(other(this.lastHit))
    while (this.clock < end - 1e-6 && this.flight && !this.outcome) {
      const dt = Math.min(end - this.clock, 8)
      this.clock += dt; this.advance(dt / 1000); this.remember(); this.stationaryContacts()
    }
    this.clock = end; this.remember()
  }

  private touches(seat: Seat): boolean {
    if (this.z < -BALL_R || this.previous[seat - 1]) return false
    const bat: [number, number] = [this.paddles[seat - 1], this.paddleY[seat - 1]], radius = contactRadius(this.z)
    const c = sweepContact([this.x, this.y], [this.x, this.y], bat, bat, radius, forward(seat))
    if (!c) return false
    ;[this.x, this.y] = rimPosition(c, bat, radius)
    return true
  }

  private stationaryContacts(): void {
    for (const seat of [1, 2] as const) {
      const i = seat - 1, packet = this.previous[i]
      // Active timed input is judged by its next segment; only the existing lost-input rule can finalize an idle bat.
      if (!packet || this.outcome || this.clock - this.lastPaddleAt[i] <= 120) continue
      const v = Math.max(this.autoV[i], this.clock - this.viewLag[i])
      this.judge(seat, { ...packet, v: this.autoV[i] }, { ...packet, v }, this.strokes[i], this.clock)
      this.autoV[i] = v
    }
  }

  private remember(): void {
    const sample: BallSample = { t: this.clock, x: this.x, y: this.y, z: this.z, landed: this.landed,
      lastHit: this.lastHit, hits: this.hits, flightId: this.flightId,
      serving: !this.flight && this.countdownMs === 0 && !this.outcome ? this.server : null }
    const last = (this.historyStart + this.historySize - 1) % this.history.length
    if (this.historySize && this.history[last]!.t === this.clock) { this.history[last] = sample; return }
    if (this.historySize === this.history.length) { this.historyStart = (this.historyStart + 1) % this.history.length; this.historySize-- }
    this.history[(this.historyStart + this.historySize++) % this.history.length] = sample
    while (this.historySize > 2 && this.clock - this.history[this.historyStart]!.t > HISTORY_MS) {
      this.history[this.historyStart] = undefined
      this.historyStart = (this.historyStart + 1) % this.history.length; this.historySize--
    }
  }

  private ballAt(t: number): BallSample | null {
    let before = this.history[this.historyStart]
    if (!before || t < before.t) return null
    for (let i = 1; i < this.historySize; i++) {
      const after = this.history[(this.historyStart + i) % this.history.length]!
      if (after.t > t) {
        if (before.flightId !== after.flightId) return { ...before, t }
        const k = (t - before.t) / (after.t - before.t)
        return { ...before, t, x: before.x + (after.x - before.x) * k,
          y: before.y + (after.y - before.y) * k, z: before.z + (after.z - before.z) * k }
      }
      before = after
    }
    return { ...before, t }
  }

  private judge(seat: Seat, previous: BatSample, packet: BatSample, stroke: Stroke, now: number): void {
    const from = Math.max(previous.v, now - this.compensation[seat - 1])
    const k = packet.v > previous.v ? (from - previous.v) / (packet.v - previous.v) : 0
    const px = previous.x + (packet.x - previous.x) * k, py = previous.y + (packet.y - previous.y) * k
    const a = this.ballAt(from), b = this.ballAt(packet.v)
    if (!a || !b || this.contactStrokes[seat - 1]) return
    const radius = contactRadius(Math.max(a.z, b.z))
    const contact = sweepContact([a.x, a.y], [b.x, b.y], [px, py], [packet.x, packet.y], radius, forward(seat))
    if (!contact) return
    const t = from + (packet.v - from) * contact.time, impact = this.ballAt(t)
    if (!impact || impact.z < -BALL_R || impact.hits !== this.hits || impact.flightId !== this.flightId || this.outcome ||
        !(impact.landed && impact.lastHit === other(seat) || impact.serving === seat)) return
    while (this.historySize && this.history[(this.historyStart + this.historySize - 1) % this.history.length]!.t > t) this.historySize--
    this.clock = t
    ;[this.x, this.y] = rimPosition(contact, [px + (packet.x - px) * contact.time,
      py + (packet.y - py) * contact.time], radius)
    this.z = impact.z; this.contactStrokes[seat - 1] = stroke
    this.strike(seat); this.remember()
    if (!this.replaying) this.catchUp(now)
  }

  private catchUp(now: number): void {
    // The new curve starts at impact time and is caught up before the outer packet is acknowledged.
    while (this.clock < now - 1e-6 && this.flight && !this.outcome) {
      const ms = Math.min(now - this.clock, 8)
      this.clock += ms; this.advance(ms / 1000); this.remember()
    }
    this.clock = now; this.remember()
  }

  private curve(target: Point, duration: number): void {
    const start: Point = [this.x, this.y, this.z]
    this.flight = {
      points: [start, [start[0] + (target[0] - start[0]) * 0.2, start[1] + (target[1] - start[1]) * 0.2, ARC_H], [target[0], target[1], ARC_H], target],
      elapsed: 0, duration,
    }
  }

  private strike(seat: Seat): void {
    const stroke = this.contactStrokes[seat - 1] ?? this.strokes[seat - 1]
    this.contactStrokes[seat - 1] = null
    const target: Point = [0.5 + stroke.direction * AIM_GAIN * (0.7 + 0.3 * stroke.forward),
      COURT_H / 2 + forward(seat) * (5 + 7 * stroke.forward) / 12.16, FLOOR_H]
    this.curve(target, flightDuration(stroke.power))
    this.shotSide = stroke.side
    this.lastHit = seat
    this.landed = false
    this.hits++; this.flightId++
  }

  private advance(dt: number): void {
    const flight = this.flight!
    const [oldX, oldY, oldZ] = [this.x, this.y, this.z]
    const wasLanded = this.landed
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
        // Pre-bounce steering may not send the bounce more sideways than toward the receiver (45 degrees).
        const vx = clamp(this.vx, -Math.abs(this.vy), Math.abs(this.vy))
        const [p0, , p2] = flight.points // p2 is the undrifted aim: the shot's own pace
        const [scale, duration] = bounce(vx, this.vy, this.vz, Math.hypot(p2[0] - p0[0], p2[1] - p0[1]) / flight.duration)
        this.curve([x + vx * scale, y + this.vy * scale, BALL_R + FLOOR_H], duration)
      }
    }
    const seat = this.lastHit ? other(this.lastHit) : null
    const radius = contactRadius(Math.max(oldZ, this.z))
    const bat = seat ? [this.paddles[seat - 1], this.paddleY[seat - 1]] as const : null
    const contact = this.landed && seat && bat && !this.previous[seat - 1] ? sweepContact(wasLanded ? [oldX, oldY] : [this.x, this.y],
      [this.x, this.y], bat, bat, radius, forward(seat)) : null
    const impactHeight = wasLanded && contact ? oldZ + (this.z - oldZ) * contact.time : this.z
    if (contact && bat && seat && impactHeight >= -BALL_R) {
      const end = this.clock, impact = wasLanded ? end - dt * 1000 * (1 - contact.time) : end
      ;[this.x, this.y] = rimPosition(contact, bat, radius)
      this.z = impactHeight; this.clock = impact
      this.strike(seat); this.remember()
      this.clock = end
      if (end - impact > 1e-6) this.advance((end - impact) / 1000)
    } else if (this.z <= FLOOR_H || (this.flight === flight && flight.elapsed >= flight.duration)) {
      this.point(this.landed ? this.lastHit! : other(this.lastHit!))
    }
  }

  private resetBall(): void {
    this.flight = null; this.lastHit = null; this.landed = false
    this.x = 0.5; this.y = serveY(this.server); this.z = 2 / 12.16
    this.vx = 0; this.vy = 0; this.vz = 0
    this.strokes = [emptyStroke(), emptyStroke()]
    this.contactStrokes = [null, null]
    this.moved = [-1, -1]
    this.samples.forEach(samples => samples.clear())
    this.flightId++
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
      t: this.clock, ack: [...this.ack],
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
