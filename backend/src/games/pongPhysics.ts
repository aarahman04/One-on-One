export type Vec2 = readonly [number, number]
export type Contact = { time: number; nx: number; ny: number }
// vx/vy: raw finger velocity at contact (widths/s; vy is toward the opponent), unclamped.
export type Stroke = { side: number; forward: number; direction: number; power: number; vx: number; vy: number }
export const BALL_EDGE = .35 // The existing painted black ball edge, not hit forgiveness.
export const CONTACT_FORGIVENESS = 0
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
export const ballRadius = (height: number) => .033 * (1 + .7 * clamp(height / (6 / 12.16), 0, 1))
export const contactRadius = (height: number) => .137 + .025 / 2 + ballRadius(height) * (1 + BALL_EDGE) + CONTACT_FORGIVENESS
export const emptyStroke = (): Stroke => ({ side: 0, forward: 0, direction: 0, power: 0, vx: 0, vy: 0 })

/** Identical client-time window to Kotlin PongPhysics.StrokeWindow. */
export class StrokeWindow {
  private samples: [number, number, number][] = []
  stroke = emptyStroke()
  clear(): void { this.samples.length = 0; this.stroke = emptyStroke() }
  sample(ct: number, x: number, y: number, forward = -1, legacy = false): Stroke {
    const previous = this.samples.at(-1)
    const still = !!previous && Math.hypot(x - previous[1], y - previous[2]) < 1e-5
    if (this.samples.length === 32) this.samples.shift()
    this.samples.push([ct, x, y])
    while (this.samples.length > 2 && this.samples[1][0] <= ct - 50) this.samples.shift()
    while (this.samples.length > 2 && this.samples[0][0] < ct - 100) this.samples.shift()
    const first = this.samples[0], dx = x - first[1], dy = y - first[2], dt = (ct - first[0]) / 1000
    if (still || Math.hypot(dx, dy) < 1e-5) this.stroke = emptyStroke()
    else if (dt > 0) {
      const sx = dx / Math.max(dt, 1 / 60), sy = dy / Math.max(dt, 1 / 60)
      this.stroke = { side: clamp(sx * 12.16 / 60, -1, 1), forward: clamp(sy * forward * 12.16 / 60, -.5, 1),
        direction: legacy ? clamp(sx * 12.16 / 60, -1, 1) : dx / Math.hypot(dx, dy), power: clamp(sy * forward / 10, 0, 1),
        vx: sx, vy: sy * forward }
    }
    return this.stroke
  }
}

// Owner fairness tuning: a full-power stroke crosses in ~1 s instead of .7 s; neutral/soft in 1.35 s.
export const flightDuration = (power: number) => 1.35 - .35 * power
/** Bounce reach multiplier and duration: the bounce keeps BOUNCE_PACE of the shot's average ground pace
 *  (distance / duration); the 2 s cap (client validation) shortens the reach instead. The table takes a
 *  little pace off so a hard deep corner ball still leaves a 250 ms+ return window. Spin scales the reach
 *  by m and the pace by q (topspin skids long and quick, backspin checks up short and slow). The shot pace
 *  counts at most BOUNCE_PACE_MAX, reached only from contacts deeper than ~.3 behind the end line. */
export const BOUNCE_PACE = .9, BOUNCE_PACE_MAX = 2.2
export function bounce(vx: number, vy: number, vz: number, pace: number, m = 1, q = 1): [number, number] {
  const ground = Math.hypot(vx, vy), scale = m * 30 / 12.16 / (Math.hypot(ground, vz) || 1)
  const duration = ground * scale / Math.max(Math.min(pace, BOUNCE_PACE_MAX) * BOUNCE_PACE * q, 1e-6)
  return duration > 2 ? [scale * 2 / duration, 2] : [scale, Math.max(.1, duration)]
}

// Sideways landing: aim plus a deterministic bend, softly saturated inside the table (|x-.5| < LATERAL_MAX),
// so every stroke lands in-table; points are lost only by missing the ball. A passive block (still bat)
// returns part of the incoming sidespin inS. The in-flight curve share grows with the stroke's own sidespin.
export const LATERAL_MAX = .42, CURVE_GAIN = .15
const smooth = (v: number, a: number, b: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const passive = (s: Stroke) => 1 - clamp(Math.hypot(s.vx, s.vy) / 6, 0, 1)
/** Spin captured at contact: [S sidespin (+ curves toward +x), T topspin (+) / backspin (-)], both in [-1, 1]. */
export const strokeSpin = (s: Stroke): [number, number] =>
  [clamp(s.vx / 8, -1, 1), s.vy > 0 ? smooth(s.vy, 4, 10) : -smooth(-s.vy, .5, 4)]
export function lateral(stroke: Stroke, inS = 0): number {
  const raw = Math.abs(stroke.direction) * (8 / 12.16) * (.7 + .3 * stroke.forward) + CURVE_GAIN * Math.abs(stroke.vx) * 12.16 / 60
  return LATERAL_MAX * Math.tanh((Math.sign(stroke.direction) * raw + .15 * inS * passive(stroke)) / LATERAL_MAX)
}
const ease = (t: number) => (t * t * t - 2 * t * t + t) * 1.363 + (-2 * t * t * t + 3 * t * t) + (t * t * t - t * t) * .3368
/** Bernstein weights at the table crossing and its normalized time for a flight launched at height z,
 *  both handles at height k*6/12.16. */
export function landingWeights(z: number, k = 1): [number, number, number, number, number] {
  const h = 6 / 12.16, height = (u: number) => (1 - u) * (1 - u) * (1 - u) * z + 3 * (1 - u) * u * k * h - u * u * u * h
  let lo = .5, hi = 1
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (height(m) > .033) lo = m; else hi = m }
  const u = (lo + hi) / 2, a = 1 - u
  lo = 0; hi = 1
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (ease(m) < u) lo = m; else hi = m }
  return [a * a * a, 3 * a * a * u, 3 * a * u * u, u * u * u, (lo + hi) / 2]
}

/** Arc points, elapsed, duration, the endpoint drift (widths/s) that lands the bend exactly, then the
 *  stroke's spin S, T. inS/inT are the incoming ball's spin at contact (after its bounce decay). */
export function launch(x: number, y: number, z: number, stroke: Stroke, forward = -1, inS = 0, inT = 0): number[] {
  const [S, T] = strokeSpin(stroke), top = Math.max(T, 0), back = Math.max(-T, 0)
  const side = lateral(stroke, inS), tx = .5 + (.85 - .35 * Math.abs(S)) * side
  // Backspin floats longer; topspin's speed-up comes from its lower arc only (spec -.1*T+ tuned to 0 by the fuzz).
  const duration = flightDuration(stroke.power) * (1 + .15 * back)
  // Passive blocks: incoming topspin runs long, incoming backspin drops short. Floor -.35 (spec -.5, tuned
  // by the spin fuzz) so a full pull-back from the deepest legal contact (.7 behind) still lands past the net.
  const f = clamp(stroke.forward + passive(stroke) * (.2 * Math.max(inT, 0) - .35 * Math.max(-inT, 0)), -.35, 1)
  const ty = .9 + forward * (5 + 7 * f) / 12.16, h = 6 / 12.16, k = 1 - .3 * top + .1 * back
  const [c0, c1, c2, c3, t] = landingWeights(z, k), x1 = x + (tx - x) * .2
  const drift = (.5 + side - (c0 * x + c1 * x1 + (c2 + c3) * tx)) / (c3 * t * duration)
  return [x, y, z, x1, y + (ty - y) * .2, k * h, tx, ty, k * h, tx, ty, -h, 0, duration, drift, S, T]
}
export const rimPosition = (contact: Contact, bat: Vec2, radius: number): [number, number] =>
  [bat[0] + contact.nx * radius, bat[1] + contact.ny * radius]

/** Relative swept circles. Handles moving balls, moving bats and initial penetration. */
export function sweepContact(ball0: Vec2, ball1: Vec2, bat0: Vec2, bat1: Vec2, radius: number, forward: number): Contact | null {
  const ox = ball0[0] - bat0[0], oy = ball0[1] - bat0[1]
  const dx = ball1[0] - bat1[0] - ox, dy = ball1[1] - bat1[1] - oy
  const c = ox * ox + oy * oy - radius * radius
  const a = dx * dx + dy * dy, b = ox * dx + oy * dy
  let time = 0
  if (c > 1e-9) {
    const discriminant = b * b - a * c
    if (a < 1e-12 || b >= 0 || discriminant < 0) return null
    time = (-b - Math.sqrt(discriminant)) / a
    if (time < 0 || time > 1) return null
  } else if (c >= -1e-9 && (b > 1e-12 || a > 1e-12 && b >= 0)) return null
  const nx = ox + dx * time, ny = oy + dy * time, length = Math.hypot(nx, ny)
  return { time, nx: length > 1e-9 ? nx / length : 0, ny: length > 1e-9 ? ny / length : forward }
}
