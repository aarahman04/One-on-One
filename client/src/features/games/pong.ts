import type { PongFrame } from '../../services/transport/MatchTransport'

// Render-only smoothing of §12 frames; no client scoring or collision decisions.
export class PongClient {
  x = 0.5
  y = 0.9
  myX = 0.5
  theirX = 0.5
  myScore = 0
  theirScore = 0
  countdown = 0
  height = 0
  bounceX = 0
  bounceY = 0
  bounceAt = 0
  hits = 0
  live = false
  private frame: number[] = [0, 0, 0, 0]
  private theirTarget = 0.5
  private countdownAt = 0
  private receivedAt = 0
  private advancedAt = 0
  private lastT = -Infinity
  private progress = 0
  private paddleMoved = false
  readonly seat: number
  constructor(seat: number) {
    this.seat = seat
  }
  private viewX(x: number) {
    return this.seat === 1 ? x : 1 - x
  }
  paddle(x: number) {
    this.paddleMoved = true
    this.myX = Math.max(0.078, Math.min(0.922, x))
    return this.viewX(this.myX)
  }
  receive(f: PongFrame, id: string, now = performance.now()): boolean {
    if (
      !f ||
      f.id !== id ||
      !Number.isFinite(f.t) ||
      f.t <= this.lastT ||
      !Array.isArray(f.b) ||
      f.b.length !== 4 ||
      !Array.isArray(f.p) ||
      f.p.length !== 2 ||
      !Array.isArray(f.s) ||
      f.s.length !== 2 ||
      ![...f.b, ...f.p, f.c, f.h].every(Number.isFinite) ||
      !f.s.every((s) => Number.isInteger(s) && s >= 0 && s <= 7)
    )
      return false
    this.lastT = f.t
    const flip = this.seat === 1 ? 1 : -1
    this.frame = [this.viewX(f.b[0]), this.seat === 1 ? f.b[1] : 1.8 - f.b[1], f.b[2] * flip, f.b[3] * flip]
    this.theirTarget = this.viewX(f.p[2 - this.seat])
    if (!this.live && !this.paddleMoved) this.myX = this.viewX(f.p[this.seat - 1])
    this.myScore = f.s[this.seat - 1]
    this.theirScore = f.s[2 - this.seat]
    this.countdownAt = f.c
    this.hits = f.h
    this.receivedAt = now
    if (!this.live || (!f.b[2] && !f.b[3])) {
      this.x = this.frame[0]
      this.y = this.frame[1]
      this.theirX = this.theirTarget
    }
    this.live = true
    return true
  }
  advance(now: number) {
    if (!this.live) return
    const dt = this.advancedAt ? Math.max(0, Math.min(0.1, (now - this.advancedAt) / 1000)) : 0
    this.advancedAt = now
    const age = Math.max(0, Math.min(0.15, (now - this.receivedAt) / 1000)),
      [bx, by, vx, vy] = this.frame
    this.countdown = Math.max(0, this.countdownAt - (now - this.receivedAt))
    let x = bx + vx * age,
      y = by + vy * age
    // Fold arbitrary x into the side walls without a loop on untrusted velocity.
    const period = 1.88,
      phase = (((x - 0.03) % period) + period) % period
    x = 0.03 + (phase <= 0.94 ? phase : period - phase)
    const headX = vy > 0 ? this.myX : this.theirX,
      headY = vy > 0 ? 1.8 : 0,
      dx = x - headX
    const reach = 0.16
    if (Math.abs(dx) < reach) {
      const edge = Math.sqrt(reach * reach - dx * dx)
      if (vy > 0 && by <= headY && y > headY - edge) y = headY - edge
      if (vy < 0 && by >= headY && y < headY + edge) y = headY + edge
    }
    const k = 1 - Math.exp(-28 * dt)
    if (Math.abs(x - this.x) + Math.abs(y - this.y) > 0.3) {
      this.x = x
      this.y = y
    } else {
      this.x += (x - this.x) * k
      this.y += (y - this.y) * k
    }
    this.theirX += (this.theirTarget - this.theirX) * k
    const p = Math.max(0, Math.min(1, vy < 0 ? (1.8 - this.y) / 1.8 : this.y / 1.8))
    this.height = !vy ? 0 : p < 0.72 ? Math.sin((Math.PI * p) / 0.72) : 0.45 * Math.sin((Math.PI * (p - 0.72)) / 0.56)
    if (vy && this.progress < 0.72 && p >= 0.72) {
      this.bounceX = this.x
      this.bounceY = this.y
      this.bounceAt = now
    }
    this.progress = vy ? p : 0
  }
}
