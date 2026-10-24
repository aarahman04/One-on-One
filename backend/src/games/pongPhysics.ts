export type Vec2 = readonly [number, number]
export type Contact = { time: number; nx: number; ny: number }
export type Stroke = { side: number; forward: number; direction: number; power: number }
export const BALL_EDGE = .35 // The existing painted black ball edge, not hit forgiveness.
export const CONTACT_FORGIVENESS = 0
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
export const ballRadius = (height: number) => .033 * (1 + .7 * clamp(height / (6 / 12.16), 0, 1))
export const contactRadius = (height: number) => .137 + .025 / 2 + ballRadius(height) * (1 + BALL_EDGE) + CONTACT_FORGIVENESS
export const emptyStroke = (): Stroke => ({ side: 0, forward: 0, direction: 0, power: 0 })

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
        direction: legacy ? clamp(sx * 12.16 / 60, -1, 1) : dx / Math.hypot(dx, dy), power: clamp(sy * forward / 10, 0, 1) }
    }
    return this.stroke
  }
}

// Owner fairness tuning: a full-power stroke crosses in ~1 s instead of .7 s; neutral/soft in 1.35 s.
export const flightDuration = (power: number) => 1.35 - .35 * power
// Peak of the eased cubic's normalized ground speed (t = .276).
export const PEAK_SPEED = 1.7063
/** Bounce reach multiplier and duration: the bounce keeps the shot's average ground pace (distance / duration),
 *  so it peaks at the shot's own peak pace; the 2 s cap (client validation) shortens the reach instead. */
// The table takes a little pace off so a hard deep corner ball still leaves a 250 ms+ return window.
export const BOUNCE_PACE = .9
export function bounce(vx: number, vy: number, vz: number, pace: number): [number, number] {
  const ground = Math.hypot(vx, vy), scale = 30 / 12.16 / (Math.hypot(ground, vz) || 1)
  const duration = ground * scale / Math.max(pace * BOUNCE_PACE, 1e-6)
  return duration > 2 ? [scale * 2 / duration, 2] : [scale, Math.max(.1, duration)]
}

export function launch(x: number, y: number, z: number, stroke: Stroke, forward = -1): number[] {
  const tx = .5 + stroke.direction * (8 / 12.16) * (.7 + .3 * stroke.forward)
  const ty = .9 + forward * (5 + 7 * stroke.forward) / 12.16, h = 6 / 12.16
  return [x, y, z, x + (tx - x) * .2, y + (ty - y) * .2, h, tx, ty, h, tx, ty, -h, 0, flightDuration(stroke.power)]
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
