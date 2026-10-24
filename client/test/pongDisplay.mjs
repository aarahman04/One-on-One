import { readFile } from 'node:fs/promises'
import ts from 'typescript'

export async function source(path, replacements = {}) {
  let code = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  code = code.replaceAll('import.meta.env.VITE_API_URL', JSON.stringify('http://fixture'))
  for (const [from, to] of Object.entries(replacements)) code = code.replaceAll(`'${from}'`, JSON.stringify(to))
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
export const physicsUrl = await source('../src/features/games/pongPhysics.ts')
export const pongUrl = await source('../src/features/games/pong.ts', { './pongPhysics': physicsUrl })
export const { PongClient, flightPosition } = await import(pongUrl)
const { sweepContact, contactRadius } = await import(physicsUrl)

// Instrument the shipped client, never a second implementation of prediction/rendering.
export class CompensatedDisplay {
  game = new PongClient(1)
  firstPredictedAt = -1; firstLaunchGap = 0; firstTarget = null
  predictionCount = 0; rejections = 0; confirmations = 0; confirmationSnap = 0
  blendSteps = []; lastBlend = null; remaining = 1
  get frame() { return this.game.frame }
  get x() { return this.game.x }
  get y() { return this.game.y }
  get z() { return this.game.height }
  get px() { return this.game.myX }
  get py() { return this.game.myY }
  get v() { return this.game.displayTimeMs }
  get possible() { return this.game.contactPossible }
  receive(f, now) {
    const p = this.game.prediction, before = [this.x, this.y]
    this.game.receive({ ...f, id: 'm' }, 'm', now)
    if (p && !this.game.prediction && this.game.reconcile) {
      if (f.h > p.hits) this.confirmations++
      else this.rejections++
      this.confirmationSnap = Math.max(this.confirmationSnap, Math.hypot(this.x - before[0], this.y - before[1]))
    }
  }
  observe(action, now, p1) {
    const g = this.game, a = g.previous, b = [this.x, this.y, this.z], p0 = [this.px, this.py], old = g.prediction
    action()
    if (g.prediction && !old) {
      this.predictionCount++
      if (this.firstPredictedAt < 0) {
        this.firstPredictedAt = now
        const end = p1 ?? p0, ball = p1 ? b : g.position(g.drawn ?? g.frame, (g.displayTimeMs - (g.drawn ?? g.frame).t) / 1000)
        const start = p1 ? a : b, r = contactRadius(Math.max(start[2], ball[2]))
        const c = sweepContact(start, ball, p0, end, r, -1)
        // Measure the drawn segment independently of the predicted launch's rim.
        this.firstLaunchGap = c ? Math.hypot(start[0] + (ball[0] - start[0]) * c.time - p0[0] - (end[0] - p0[0]) * c.time,
          start[1] + (ball[1] - start[1]) * c.time - p0[1] - (end[1] - p0[1]) * c.time) - r : Infinity
        this.firstTarget = g.prediction.arc.slice(9, 12).concat(g.prediction.arc[13])
      }
    }
  }
  advance(now) {
    this.observe(() => this.game.advance(now), now)
    const blend = this.game.blend
    if (blend) {
      if (blend !== this.lastBlend) { this.lastBlend = blend; this.remaining = 1 }
      const remaining = Math.max(0, 1 - (now - blend.at) / 60)
      this.blendSteps.push(Math.hypot(blend.delta[0], blend.delta[1]) * (this.remaining - remaining)); this.remaining = remaining
    } else if (this.lastBlend && this.remaining) {
      this.blendSteps.push(Math.hypot(this.lastBlend.delta[0], this.lastBlend.delta[1]) * this.remaining); this.remaining = 0
    }
  }
  paddle(x, y, now, released = false) {
    this.observe(() => this.game.paddle(x, y, released, now), now, [x, y])
    return { x: this.px, y: this.py, ct: this.game.sampleCt, v: this.v, n: this.game.sampleN, released }
  }
}
