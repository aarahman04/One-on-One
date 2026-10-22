export type Vec2 = readonly [number, number]
export type Contact = { time: number; nx: number; ny: number }
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
  } else if (c >= -1e-9 && b >= 0) return null
  const nx = ox + dx * time, ny = oy + dy * time, length = Math.hypot(nx, ny)
  return { time, nx: length > 1e-9 ? nx / length : 0, ny: length > 1e-9 ? ny / length : forward }
}
