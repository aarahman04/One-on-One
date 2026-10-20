import type { Outcome, Seat } from './rules.js'

// Authoritative table tennis (2.0.7). The server owns the ball and the score;
// clients only send their racket position and render the frames.
//
// Top-down table, x 0..1 across, y 0..COURT_H along. Each racket head is a
// circle centred on its own end line (seat 1: y = COURT_H, the bottom; seat 2:
// y = 0, the top) and slides along it. Clients rotate the table so their own
// racket is at the bottom of the screen.
//
// Arcade rules (no reference video was available; these are the documented
// choices): the ball travels in a straight line, bounces off the side edges,
// is returned when it touches a racket head, and scores for the opponent once
// it passes an end line untouched. The return direction comes from where the
// ball meets the round head (centre: straight back, edge: angled) plus a
// share of the racket's sideways swing. Every return is a little faster.
// First to 7; the player who lost the point receives the next serve.

export const COURT_H = 1.8
export const HEAD_R = 0.13
export const BALL_R = 0.03
// Extra reach on the server's hit test: a racket position is up to one
// round-trip old when it arrives, so a ball the player saw touch the racket
// still counts.
export const HIT_SLACK = 0.025
export const START_SPEED = 0.95
export const MAX_SPEED = 2.6
export const SPEEDUP = 1.06
// The steepest return, measured from straight down the table.
export const MAX_ANGLE = (62 * Math.PI) / 180
// Share of the racket's sideways speed passed to the ball.
export const SWING = 0.3
export const WIN_SCORE = 7
export const FIRST_SERVE_MS = 3000
export const NEXT_SERVE_MS = 1200
// Rackets move along the end line, never past the table's side edges.
export const RACKET_MIN = HEAD_R * 0.6
export const RACKET_MAX = 1 - HEAD_R * 0.6

const r4 = (n: number): number => Math.round(n * 10_000) / 10_000
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

export interface PongFrame {
  b: [number, number, number, number]
  p: [number, number]
  s: [number, number]
  c: number
  h: number
}

export class PongSim {
  x = 0.5
  y = COURT_H / 2
  vx = 0
  vy = 0
  paddles: [number, number] = [0.5, 0.5]
  score: [number, number] = [0, 0]
  countdownMs = FIRST_SERVE_MS
  hits = 0
  outcome: Outcome | null = null
  // Simulation clock and each racket's last position, for its swing speed.
  private clock = 0
  private swing: [number, number] = [0, 0]
  private moved: [number, number] = [-1, -1]
  private serveTo: Seat
  private random: () => number

  constructor(random: () => number = Math.random) {
    this.random = random
    this.serveTo = random() < 0.5 ? 1 : 2
  }

  paddle(seat: Seat, x: number): void {
    const i = seat - 1
    const next = clamp(x, RACKET_MIN, RACKET_MAX)
    const dt = this.moved[i] < 0 ? 0 : (this.clock - this.moved[i]) / 1000
    // Units per second, smoothed; updates arrive at most ~30 per second.
    if (dt > 0) this.swing[i] = 0.5 * this.swing[i] + 0.5 * clamp((next - this.paddles[i]) / Math.max(dt, 1 / 60), -6, 6)
    this.paddles[i] = next
    this.moved[i] = this.clock
  }

  // Restart the serve countdown (after a pause) without touching the score.
  holdServe(ms: number): void {
    if (this.outcome) return
    if (this.vx !== 0 || this.vy !== 0) {
      this.x = 0.5
      this.y = COURT_H / 2
      this.vx = 0
      this.vy = 0
    }
    this.countdownMs = Math.max(this.countdownMs, ms)
  }

  step(ms: number): void {
    if (this.outcome || ms <= 0) return
    this.clock += ms
    // A racket that stopped sending updates has stopped moving.
    for (const i of [0, 1]) if (this.clock - this.moved[i] > 120) this.swing[i] = 0
    if (this.countdownMs > 0) {
      this.countdownMs -= ms
      if (this.countdownMs <= 0) {
        this.countdownMs = 0
        this.serve()
      }
      return
    }
    const dt = ms / 1000
    const speed = Math.hypot(this.vx, this.vy)
    // Each substep moves the ball less than its radius, and a hit is an
    // overlap test, so no speed or frame time lets it pass through a racket.
    const n = Math.min(32, Math.max(1, Math.ceil((speed * dt) / (BALL_R * 0.8))))
    for (let i = 0; i < n && !this.outcome && this.countdownMs === 0; i++) {
      this.x += (this.vx * dt) / n
      this.y += (this.vy * dt) / n
      if (this.x < BALL_R) {
        this.x = 2 * BALL_R - this.x
        this.vx = Math.abs(this.vx)
      } else if (this.x > 1 - BALL_R) {
        this.x = 2 * (1 - BALL_R) - this.x
        this.vx = -Math.abs(this.vx)
      }
      if (this.vy > 0 && this.y <= COURT_H && this.touches(1)) this.hit(1)
      else if (this.vy < 0 && this.y >= 0 && this.touches(2)) this.hit(2)
      else if (this.y - BALL_R > COURT_H) this.point(2)
      else if (this.y + BALL_R < 0) this.point(1)
    }
  }

  private head(seat: Seat): [number, number] {
    return [this.paddles[seat - 1], seat === 1 ? COURT_H : 0]
  }

  private touches(seat: Seat): boolean {
    const [hx, hy] = this.head(seat)
    return Math.hypot(this.x - hx, this.y - hy) <= HEAD_R + BALL_R + HIT_SLACK
  }

  private serve(): void {
    const angle = (this.random() * 2 - 1) * (Math.PI / 8)
    this.vx = START_SPEED * Math.sin(angle)
    this.vy = START_SPEED * Math.cos(angle) * (this.serveTo === 1 ? 1 : -1)
  }

  private hit(seat: Seat): void {
    const [hx, hy] = this.head(seat)
    const away = seat === 1 ? -1 : 1 // direction of travel back up the table
    // Contact normal from the head's centre; behind the line it can't point
    // backwards, so its forward part is at least a little positive.
    let nx = this.x - hx
    let ny = (this.y - hy) * away
    const len = Math.hypot(nx, ny) || 1
    nx /= len
    ny = Math.max(ny / len, 0.05)
    let angle = Math.atan2(nx, ny) // 0 = straight up the table
    const speed = Math.min(MAX_SPEED, Math.max(START_SPEED, Math.hypot(this.vx, this.vy) * SPEEDUP))
    // Angles and swing are both in table x for either side: a racket moving
    // towards +x pushes the ball towards +x.
    angle += Math.atan2(SWING * this.swing[seat - 1], speed)
    angle = clamp(angle, -MAX_ANGLE, MAX_ANGLE)
    this.vx = speed * Math.sin(angle)
    this.vy = speed * Math.cos(angle) * away
    // Sit the ball on the head's surface along the outgoing direction's side.
    const reach = HEAD_R + BALL_R
    this.x = clamp(hx + Math.sin(angle) * reach, BALL_R, 1 - BALL_R)
    this.y = hy + Math.cos(angle) * reach * away
    this.hits++
  }

  private point(scorer: Seat): void {
    this.score[scorer - 1]++
    this.x = 0.5
    this.y = COURT_H / 2
    this.vx = 0
    this.vy = 0
    if (this.score[scorer - 1] >= WIN_SCORE) {
      this.outcome = { winner: scorer, reason: 'first_to_7' }
      return
    }
    this.serveTo = scorer === 1 ? 2 : 1
    this.countdownMs = NEXT_SERVE_MS
  }

  frame(): PongFrame {
    return {
      b: [r4(this.x), r4(this.y), r4(this.vx), r4(this.vy)],
      p: [r4(this.paddles[0]), r4(this.paddles[1])],
      s: [this.score[0], this.score[1]],
      c: Math.ceil(this.countdownMs),
      h: this.hits,
    }
  }
}
