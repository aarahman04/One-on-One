import type { PongFrame } from '../../services/transport/MatchTransport'
import { contactRadius, launch, rimPosition, StrokeWindow, sweepContact } from './pongPhysics'

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
export function flightPosition(arc: number[], age: number, spin: number, drift?: number): number[] {
  const t = clamp((arc[12] + age) / arc[13], 0, 1)
  const u = (t ** 3 - 2 * t * t + t) * 1.363 + (-2 * t ** 3 + 3 * t * t) + (t ** 3 - t * t) * .3368
  const a = 1 - u
  return [0, 1, 2].map((i) => {
    const end = arc[9 + i] + (i === 0 ? drift === undefined ? spin * .8 * 1.8 * (1 - Math.exp(-age / 1.8)) : drift * age : 0)
    return a ** 3 * arc[i] + 3 * a * a * u * arc[3 + i] + 3 * a * u * u * arc[6 + i] + u ** 3 * end
  })
}
const angle = (dx: number, dy: number) => Math.hypot(dx, dy) < .001 ? 0 : clamp(Math.atan2(dx, Math.abs(dy) + .005) * 180 / Math.PI, -55, 55)
type Prediction = { arc: number[]; viewAt: number; driftAt: number; hits: number; n: number }

// Display-only port of Android PongClient; only authoritative h/s/j trigger game feedback.
export class PongClient {
  x = .5; y = .9; height = 0
  myX = .5; myY = 1.88; theirX = .5; theirY = -.08
  myAngle = 0; theirAngle = 0
  myScore = 0; theirScore = 0; target = 7; countdown = 0; hits = 0
  waitingServe = false; myServe = false; spin = 0; spinAngle = 0
  bounceX = 0; bounceY = 0; bounceAt = 0; live = false; round = 0
  trail: { x: number; y: number; height: number; at: number }[] = []
  sampleCt = 0; sampleN = 0; displayTimeMs = 0
  private frame: PongFrame | null = null
  private frames: PongFrame[] = []
  private drawn: PongFrame | null = null
  private offsets: number[] = []
  private offset: number | null = null
  private frameAt = 0; private advancedAt = 0
  private theirTarget = [.5, -.08]
  private localAngle = 0; private remoteAngle = 0; private lastTrail = 0
  private paddleMoved = false; private acknowledged = 0
  private stroke = new StrokeWindow()
  private inputAt = 0; private released = true
  private previous = [.5, .9, 0]; private previousTime = 0
  private prediction: Prediction | null = null
  private reconcile: { source: Prediction; side: number; idleAt: number; accepted: boolean } | null = null
  private blend: { at: number; delta: number[] } | null = null
  readonly seat: number
  constructor(seat: number) { this.seat = seat }
  private viewX(x: number) { return this.seat === 1 ? x : 1 - x }
  private viewY(y: number) { return this.seat === 1 ? y : 1.8 - y }
  private get compensated() { return this.frame?.ack !== undefined }
  private ready(f: PongFrame | null, height: number, countdown = this.countdown) {
    return !!f && height >= -.033 && (f.l && f.b[3] > 0 || f.serve === this.seat && countdown === 0)
  }
  get contactEligible() {
    return this.ready(this.drawn ?? this.frame, this.height) && !this.prediction && !this.blend && !this.reconcile
  }
  get contactPossible() { return !!this.prediction || this.contactEligible && Math.hypot(this.x - this.myX, this.y - this.myY) <= 2 * contactRadius(this.height) }
  get hasPrediction() { return !!this.prediction }

  receive(f: PongFrame, id: string, now = performance.now()): boolean {
    const numbers = (a: unknown, n: number): a is number[] => Array.isArray(a) && a.length === n && a.every(Number.isFinite)
    if (!f || f.id !== id || !Number.isFinite(f.t) || f.t <= (this.frame?.t ?? -Infinity) || !numbers(f.b, 4) || !numbers(f.p, 2) ||
      !numbers(f.s, 2) || !f.s.every((s) => Number.isInteger(s) && s >= 0 && s <= 99) ||
      ![f.c, f.h, f.j ?? 0, f.serve ?? 0].every((n) => Number.isSafeInteger(n) && n >= 0) || (f.serve ?? 0) > 2 ||
      (f.r !== undefined && !numbers(f.r, 2)) || (f.z !== undefined && !numbers(f.z, 2)) ||
      (f.a != null && (!numbers(f.a, 14) || f.a[12] < 0 || f.a[13] < .1 || f.a[13] > 2)) ||
      !Number.isFinite(f.spin ?? 0) || (f.drift !== undefined && !Number.isFinite(f.drift)) ||
      (f.ack !== undefined && (!numbers(f.ack, 2) || !f.ack.every((n) => Number.isSafeInteger(n) && n >= 0))) ||
      (f.l !== undefined && typeof f.l !== 'boolean')) return false
    const old = this.frame, hit = !!old && f.h !== old.h
    const reset = !old || f.s.some((s, i) => s !== old.s[i]) || !!f.serve && (!old.serve || f.c > old.c + 100)
    const flip = this.seat === 1 ? 1 : -1, arc = f.a ? [...f.a] : null
    if (arc) for (let i = 0; i < 4; i++) { arc[i * 3] = this.viewX(arc[i * 3]); arc[i * 3 + 1] = this.viewY(arc[i * 3 + 1]) }
    const next: PongFrame = { ...f, b: [this.viewX(f.b[0]), this.viewY(f.b[1]), f.b[2] * flip, f.b[3] * flip], a: arc,
      spin: (f.spin ?? 0) * flip, drift: f.drift === undefined ? undefined : f.drift * flip }
    const ack = f.ack?.[this.seat - 1]
    if (reset || hit || this.prediction && ack !== undefined && ack >= this.prediction.n && f.h <= this.prediction.hits) {
      if (this.prediction && !reset) this.reconcile = { source: this.prediction, side: this.stroke.stroke.side, idleAt: this.inputAt + 120, accepted: hit }
      this.prediction = null
      if (reset) {
        this.frames.length = 0; this.drawn = next; this.stroke.clear(); this.blend = null; this.reconcile = null; this.round++
        this.trail = []; this.lastTrail = 0
        if (old || !this.paddleMoved) { this.myX = this.viewX(f.p[this.seat - 1]); this.myY = this.viewY((f.r ?? [1.88, -.08])[this.seat - 1]) }
      }
    }
    this.frame = next
    const remote = [this.viewX(f.p[2 - this.seat]), this.viewY((f.r ?? [1.8, 0])[2 - this.seat])]
    this.remoteAngle = angle(remote[0] - this.theirTarget[0], remote[1] - this.theirTarget[1]); this.theirTarget = remote
    this.myScore = f.s[this.seat - 1]; this.theirScore = f.s[2 - this.seat]; this.hits = f.h; this.spin = next.spin!
    this.waitingServe = !!f.serve; this.myServe = f.serve === this.seat; this.countdown = f.c
    if ((f.j ?? 0) > (old?.j ?? 0)) { this.bounceX = next.b[0]; this.bounceY = next.b[1]; this.bounceAt = now }
    this.acknowledged = ack ?? this.acknowledged; this.sampleN = Math.max(this.sampleN, this.acknowledged)
    this.offsets.push(now - f.t); if (this.offsets.length > 32) this.offsets.shift()
    const sorted = [...this.offsets].sort((a, b) => a - b), estimate = sorted[Math.floor((sorted.length - 1) / 8)]
    this.offset = this.offset === null ? estimate : this.compensated ? this.offset + clamp(estimate - this.offset, -1, 1) : Math.min(this.offset, estimate)
    this.frameAt = this.compensated ? f.t + this.offset : now
    if (this.compensated) {
      this.frames.push(next)
      while (this.frames.length > 32 || this.frames.length > 1 && f.t - this.frames[0].t > 800) this.frames.shift()
    }
    if (!this.live || reset || !f.a && !f.b[2] && !f.b[3] && !this.prediction && !this.reconcile && !this.blend) {
      this.x = next.b[0]; this.y = next.b[1]; this.height = next.z?.[0] ?? 0; this.previous = [this.x, this.y, this.height]
      if (!this.live) { this.theirX = remote[0]; this.theirY = remote[1] }
    }
    this.live = true
    return true
  }
  private select(at: number): PongFrame {
    let selected = this.frames.at(-1)!
    for (const f of this.frames) { if (f.t <= at) selected = f; else break }
    const start = selected.a ? selected.t - Math.round(selected.a[12] * 10000) / 10 : -Infinity
    for (const f of this.frames) {
      if (!f.a) continue
      const begins = f.t - Math.round(f.a[12] * 10000) / 10
      if (f.t > selected.t && begins > start + 1 && begins <= at) { selected = f; break }
    }
    return selected
  }
  private position(f: PongFrame, age: number) {
    return f.a ? flightPosition(f.a, age, f.spin ?? 0, f.drift) : [f.b[0] + f.b[2] * age, f.b[1] + f.b[3] * age, f.z?.[0] ?? 0]
  }
  private drift(now: number) {
    const p = this.prediction
    if (!p) return
    p.arc[9] += this.stroke.stroke.side * (.3 / 12.16 / .02) * Math.max(0, Math.min(now, this.inputAt + 120) - p.driftAt) / 1000
    p.driftAt = Math.max(p.driftAt, now)
    if (now - this.inputAt > 120) this.stroke.clear()
  }
  advance(now: number) {
    const f = this.frame
    if (!f) return
    const dt = this.advancedAt ? clamp((now - this.advancedAt) / 1000, 0, .1) : 0
    this.advancedAt = now
    const priorTime = this.displayTimeMs
    let shown = f, age = clamp((now - this.frameAt) / 1000, 0, .15)
    if (this.compensated) {
      this.displayTimeMs = clamp(Math.max(this.displayTimeMs, now - this.offset! - 50), this.frames[0].t, this.prediction ? Infinity : f.t + 50)
      shown = this.select(this.displayTimeMs); this.drawn = shown
      age = (this.displayTimeMs - shown.t) / 1000
    } else { this.displayTimeMs = f.t + age * 1000; this.drawn = f }
    this.countdown = Math.max(0, f.c - Math.max(0, now - this.frameAt))
    let target = this.position(shown, age)
    this.previous = [this.x, this.y, this.height]; this.previousTime = priorTime
    if (this.released || now - this.inputAt > 120) this.predict(this.previous, target, [this.myX, this.myY], [this.myX, this.myY], now, true)
    if (this.prediction) { this.drift(now); target = flightPosition(this.prediction.arc, (this.displayTimeMs - this.prediction.viewAt) / 1000, this.stroke.stroke.side, 0) }
    if (this.reconcile) {
      const { source, side, idleAt, accepted } = this.reconcile
      source.arc[9] += side * (.3 / 12.16 / .02) * Math.max(0, Math.min(now, idleAt) - source.driftAt) / 1000; source.driftAt = now
      const anchor = flightPosition(source.arc, (this.displayTimeMs - source.viewAt) / 1000, side, 0)
      // A lost pre-bounce confirmation must not blend back to the old incoming curve.
      if (accepted && shown.h < f.h) target = anchor
      else { this.blend = { at: now, delta: anchor.map((v, i) => v - target[i]) }; this.reconcile = null }
    }
    if (this.blend) {
      const remaining = clamp(1 - (now - this.blend.at) / 60, 0, 1)
      target = target.map((v, i) => v + this.blend!.delta[i] * remaining)
      if (!remaining) this.blend = null
    }
    const k = this.compensated || shown.drift !== undefined || Math.abs(target[0] - this.x) + Math.abs(target[1] - this.y) > .35 ? 1 : 1 - Math.exp(-45 * dt)
    this.x += (target[0] - this.x) * k; this.y += (target[1] - this.y) * k; this.height += (target[2] - this.height) * k
    const follow = 1 - Math.exp(-35 * dt), turn = 1 - Math.exp(-18 * dt)
    this.theirX += (this.theirTarget[0] - this.theirX) * follow; this.theirY += (this.theirTarget[1] - this.theirY) * follow
    this.myAngle += (this.localAngle - this.myAngle) * turn; this.theirAngle += (this.remoteAngle - this.theirAngle) * turn
    this.spinAngle = (this.spinAngle + this.spin * dt * 900) % 360
    while (this.trail.length && now - this.trail[0].at >= 300) this.trail.shift()
    if (shown.a && age < .15 && now - this.lastTrail >= 12) { this.trail.push({ x: this.x, y: this.y, height: this.height, at: now }); this.lastTrail = now }
  }
  paddle(x: number, y = this.myY, released = false, now = performance.now(), touch?: [number, number], ctFloor = 0): [number, number] {
    if (!Number.isFinite(x) || !Number.isFinite(y) || touch?.some((n) => !Number.isFinite(n))) return [this.viewX(this.myX), this.viewY(this.myY)]
    this.paddleMoved = true
    const nx = clamp(x, -.26, 1.26), ny = clamp(y, 1.3, 2.5)
    this.drift(now)
    this.sampleCt = Math.max(this.sampleCt + 1, Math.floor(now), ctFloor + 1); this.sampleN++
    this.stroke.sample(this.sampleCt, clamp(touch?.[0] ?? nx, -.26, 1.26), clamp(touch?.[1] ?? ny, 1.3, 2.5)); this.inputAt = now
    this.predict(this.previous, [this.x, this.y, this.height], [this.myX, this.myY], [nx, ny], now)
    if (released) this.stroke.clear()
    this.released = released
    this.localAngle = released ? 0 : angle(nx - this.myX, ny - this.myY)
    this.myX = nx; this.myY = ny; this.previous = [this.x, this.y, this.height]; this.previousTime = this.displayTimeMs
    return [this.viewX(nx), this.viewY(ny)]
  }
  private predict(a: number[], b: number[], p0: [number, number], p1: [number, number], now: number, nextSample = false) {
    if (!this.compensated || this.prediction || this.blend || this.reconcile) return
    const r = contactRadius(Math.max(a[2], b[2])), c = sweepContact([a[0], a[1]], [b[0], b[1]], p0, p1, r, -1)
    if (!c) return
    const h = a[2] + (b[2] - a[2]) * c.time
    const viewAt = this.previousTime > 0 ? this.previousTime + (this.displayTimeMs - this.previousTime) * c.time : this.displayTimeMs
    const impact = this.select(viewAt)
    if (!this.ready(impact, h, Math.max(0, impact.c - (viewAt - impact.t)))) return
    const bat: [number, number] = [p0[0] + (p1[0] - p0[0]) * c.time, p0[1] + (p1[1] - p0[1]) * c.time], rim = rimPosition(c, bat, r)
    const at = now - Math.max(0, this.displayTimeMs - viewAt)
    this.prediction = { arc: launch(rim[0], rim[1], h, this.stroke.stroke), viewAt, driftAt: at,
      hits: this.hits, n: Math.max(this.sampleN + (nextSample ? 1 : 0), this.acknowledged + 1) }
    this.x = rim[0]; this.y = rim[1]; this.height = h
  }
}
