import type { Outcome, Seat } from './rules.js'

// Authoritative table tennis (2.0.7). The server owns the ball and the score;
// clients only send their paddle position and render the frames.
//
// Court units: x 0..1 across, y 0..COURT_H along. Seat 1 defends the bottom
// edge (y = COURT_H), seat 2 the top (y = 0). Each client flips the court so
// its own paddle is at the bottom of the screen.

export const COURT_H = 1.6
export const PADDLE_HALF = 0.12
export const PADDLE_INSET = 0.08
export const BALL_R = 0.022
// Extra reach on the server's hit test: a paddle position is up to one
// round-trip old when it arrives, so a ball the player saw touch the paddle
// still counts.
export const HIT_SLACK = 0.03
export const START_SPEED = 0.85
export const MAX_SPEED = 2.1
export const SPEEDUP = 1.06
export const WIN_SCORE = 7
export const FIRST_SERVE_MS = 3000
export const NEXT_SERVE_MS = 1500

const r4 = (n: number): number => Math.round(n * 10_000) / 10_000

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
  private serveTo: Seat
  private random: () => number

  constructor(random: () => number = Math.random) {
    this.random = random
    this.serveTo = random() < 0.5 ? 1 : 2
  }

  paddle(seat: Seat, x: number): void {
    this.paddles[seat - 1] = Math.min(1 - PADDLE_HALF, Math.max(PADDLE_HALF, x))
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
    // Substeps keep each move shorter than the ball radius; the plane-crossing
    // tests below never let a fast ball tunnel through a paddle anyway.
    const n = Math.min(16, Math.max(1, Math.ceil((speed * dt) / BALL_R)))
    const bottom = COURT_H - PADDLE_INSET
    const top = PADDLE_INSET
    for (let i = 0; i < n && !this.outcome && this.countdownMs === 0; i++) {
      const oldY = this.y
      this.x += (this.vx * dt) / n
      this.y += (this.vy * dt) / n
      if (this.x < BALL_R) {
        this.x = 2 * BALL_R - this.x
        this.vx = Math.abs(this.vx)
      } else if (this.x > 1 - BALL_R) {
        this.x = 2 * (1 - BALL_R) - this.x
        this.vx = -Math.abs(this.vx)
      }
      const reach = PADDLE_HALF + BALL_R + HIT_SLACK
      if (this.vy > 0 && oldY + BALL_R <= bottom && this.y + BALL_R > bottom && Math.abs(this.x - this.paddles[0]) <= reach) {
        this.y = bottom - BALL_R
        this.bounce(this.paddles[0], -1)
      } else if (this.vy < 0 && oldY - BALL_R >= top && this.y - BALL_R < top && Math.abs(this.x - this.paddles[1]) <= reach) {
        this.y = top + BALL_R
        this.bounce(this.paddles[1], 1)
      } else if (this.y > COURT_H + BALL_R) this.point(2)
      else if (this.y < -BALL_R) this.point(1)
    }
  }

  private serve(): void {
    const angle = (this.random() * 2 - 1) * (Math.PI / 7)
    this.vx = START_SPEED * Math.sin(angle)
    this.vy = START_SPEED * Math.cos(angle) * (this.serveTo === 1 ? 1 : -1)
  }

  private bounce(paddleX: number, direction: 1 | -1): void {
    const speed = Math.min(MAX_SPEED, Math.hypot(this.vx, this.vy) * SPEEDUP)
    const offset = Math.min(1, Math.max(-1, (this.x - paddleX) / PADDLE_HALF))
    this.vx = offset * speed * 0.7
    this.vy = direction * Math.sqrt(speed * speed - this.vx * this.vx)
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
    // The player who lost the point receives the next serve.
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
