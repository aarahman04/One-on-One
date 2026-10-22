import type { PongFrame } from '../../services/transport/MatchTransport'

export function flightPosition(arc: number[], age: number, spin: number): number[] {
  const t = Math.max(0, Math.min(1, (arc[12] + age) / arc[13]))
  const u = (t ** 3 - 2 * t * t + t) * 1.363 + (-2 * t ** 3 + 3 * t * t) + (t ** 3 - t * t) * .3368
  const a = 1 - u
  return [0, 1, 2].map((i) => {
    const end = arc[9 + i] + (i === 0 ? spin * .8 * 1.8 * (1 - Math.exp(-age / 1.8)) : 0)
    return a ** 3 * arc[i] + 3 * a * a * u * arc[3 + i] + 3 * a * u * u * arc[6 + i] + u ** 3 * end
  })
}
const angle = (dx: number, dy: number) => Math.hypot(dx, dy) < .001 ? 0 : Math.max(-55, Math.min(55, Math.atan2(dx, Math.abs(dy) + .005) * 180 / Math.PI))

// Render-only prediction of contract ?12; scoring, strokes and bounces stay on the server.
export class PongClient {
  x = .5; y = .9; height = 0
  myX = .5; myY = 1.88; theirX = .5; theirY = -.08
  myAngle = 0; theirAngle = 0
  myScore = 0; theirScore = 0; target = 7; countdown = 0; hits = 0
  waitingServe = false; myServe = false; spin = 0; spinAngle = 0
  bounceX = 0; bounceY = 0; bounceAt = 0; live = false
  trail: { x: number; y: number; height: number }[] = []
  private frame = [0, 0, 0, 0]
  private arc: number[] | null = null
  private frameHeight = 0; private theirTarget = [.5, -.08]
  private countdownAt = 0; private receivedAt = 0; private advancedAt = 0; private lastT = -Infinity
  private bounces = 0; private localAngle = 0; private remoteAngle = 0; private lastTrail = 0
  private returnReady = false; private paddleMoved = false
  readonly seat: number
  constructor(seat: number) { this.seat = seat }
  private viewX(x: number) { return this.seat === 1 ? x : 1 - x }
  private viewY(y: number) { return this.seat === 1 ? y : 1.8 - y }
  paddle(x: number, y = this.myY, released = false): [number, number] {
    this.paddleMoved = true
    const nx = Math.max(-.26, Math.min(1.26, x))
    let ny = Math.max(1.3, Math.min(2.5, y))
    const incoming = this.frame[3] > 0 && this.returnReady || this.waitingServe && this.myServe && this.countdown === 0
    const reach = .137 + .033 + .02
    if (incoming && ny < this.myY && this.myY >= this.y && Math.abs(nx - this.x) < reach) {
      const contact = this.y + Math.sqrt(reach * reach - (nx - this.x) ** 2)
      if (this.myY >= contact && ny < contact) ny = Math.max(1.3, Math.min(2.5, contact))
    }
    this.localAngle = released ? 0 : angle(nx - this.myX, ny - this.myY)
    this.myX = nx; this.myY = ny
    return [this.viewX(nx), this.viewY(ny)]
  }
  receive(f: PongFrame, id: string, now = performance.now()): boolean {
    const numbers = (a: unknown, n: number): a is number[] => Array.isArray(a) && a.length === n && a.every(Number.isFinite)
    if (!f || f.id !== id || !Number.isFinite(f.t) || f.t <= this.lastT || !numbers(f.b, 4) || !numbers(f.p, 2) ||
      !numbers(f.s, 2) || !f.s.every((s) => Number.isInteger(s) && s >= 0 && s <= 99) ||
      ![f.c, f.h, f.j ?? 0, f.serve ?? 0].every((n) => Number.isInteger(n) && n >= 0) || (f.serve ?? 0) > 2 ||
      (f.r !== undefined && !numbers(f.r, 2)) || (f.z !== undefined && !numbers(f.z, 2)) ||
      (f.a != null && (!numbers(f.a, 14) || f.a[12] < 0 || f.a[13] < .1 || f.a[13] > 2)) ||
      !Number.isFinite(f.spin ?? 0) || (f.l !== undefined && typeof f.l !== 'boolean')) return false
    this.lastT = f.t
    const newHit = this.hits !== f.h, flip = this.seat === 1 ? 1 : -1
    this.frame = [this.viewX(f.b[0]), this.viewY(f.b[1]), f.b[2] * flip, f.b[3] * flip]
    this.arc = f.a ? [...f.a] : null
    if (this.arc) for (let i = 0; i < 4; i++) { this.arc[i * 3] = this.viewX(this.arc[i * 3]); this.arc[i * 3 + 1] = this.viewY(this.arc[i * 3 + 1]) }
    this.frameHeight = f.z?.[0] ?? 0
    const next = [this.viewX(f.p[2 - this.seat]), this.viewY((f.r || [1.8, 0])[2 - this.seat])]
    this.remoteAngle = angle(next[0] - this.theirTarget[0], next[1] - this.theirTarget[1]); this.theirTarget = next
    if (!this.live && !this.paddleMoved) { this.myX = this.viewX(f.p[this.seat - 1]); this.myY = this.viewY((f.r || [1.88, -.08])[this.seat - 1]) }
    this.myScore = f.s[this.seat - 1]; this.theirScore = f.s[2 - this.seat]
    this.countdownAt = f.c; this.countdown = f.c; this.hits = f.h; this.spin = (f.spin ?? 0) * flip
    this.waitingServe = !!f.serve; this.myServe = f.serve === this.seat; this.returnReady = f.l ?? false
    if ((f.j ?? 0) > this.bounces) { this.bounceX = this.frame[0]; this.bounceY = this.frame[1]; this.bounceAt = now }
    this.bounces = f.j ?? 0; this.receivedAt = now
    if (!this.live || newHit || !f.a && !f.b[2] && !f.b[3]) {
      this.x = this.frame[0]; this.y = this.frame[1]; this.height = this.frameHeight
      this.theirX = next[0]; this.theirY = next[1]; this.trail = []
    }
    this.live = true
    return true
  }
  advance(now: number) {
    if (!this.live) return
    const dt = this.advancedAt ? Math.max(0, Math.min(.1, (now - this.advancedAt) / 1000)) : 0
    this.advancedAt = now
    const age = Math.max(0, Math.min(.15, (now - this.receivedAt) / 1000))
    this.countdown = Math.max(0, this.countdownAt - (now - this.receivedAt))
    const target = this.arc ? flightPosition(this.arc, age, this.spin) : [this.frame[0] + this.frame[2] * age, this.frame[1] + this.frame[3] * age, this.frameHeight]
    const k = Math.abs(target[0] - this.x) + Math.abs(target[1] - this.y) > .35 ? 1 : 1 - Math.exp(-45 * dt)
    this.x += (target[0] - this.x) * k; this.y += (target[1] - this.y) * k; this.height += (target[2] - this.height) * k
    const follow = 1 - Math.exp(-35 * dt), turn = 1 - Math.exp(-18 * dt)
    this.theirX += (this.theirTarget[0] - this.theirX) * follow; this.theirY += (this.theirTarget[1] - this.theirY) * follow
    this.myAngle += (this.localAngle - this.myAngle) * turn; this.theirAngle += (this.remoteAngle - this.theirAngle) * turn
    this.spinAngle = (this.spinAngle + this.spin * Math.exp(-age / 1.8) * dt * 900) % 360
    if (this.arc && now - this.lastTrail >= 12) {
      this.trail.push({ x: this.x, y: this.y, height: this.height }); if (this.trail.length > 8) this.trail.shift(); this.lastTrail = now
    }
  }
}
