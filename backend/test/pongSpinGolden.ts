import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bounce, emptyStroke, launch, type Stroke } from '../src/games/pongPhysics.js'

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
/** The StrokeWindow result for a steady swipe of `speed` widths/s at `angle` degrees from straight toward the opponent. */
export function strokeAt(angle: number, speed: number): Stroke {
  if (speed === 0) return emptyStroke()
  const rad = angle * Math.PI / 180, vx = speed * Math.sin(rad), vy = speed * Math.cos(rad)
  return { side: clamp(vx * 12.16 / 60, -1, 1), forward: clamp(vy * 12.16 / 60, -.5, 1), direction: vx / speed,
    power: clamp(vy / 10, 0, 1), vx, vy }
}

/** Shared Kotlin/TypeScript vectors: 60 launches and 24 bounces from a fixed deterministic grid. */
export function spinGolden() {
  const speeds = [0, .5, 2, 4, 6, 8, 10, 14, 20], xs = [-.2, .1, .5, .9, 1.2], zs = [-.03, .05, .2, .45], spins = [-1, 0, 1]
  const launches = Array.from({ length: 60 }, (_, i) => {
    const forwardSign = i % 2 ? -1 : 1, depth = i % 4 < 2 ? .05 : .3
    const x = xs[i % 5], y = forwardSign > 0 ? -depth : 1.8 + depth, z = zs[(i >> 1) % 4]
    const stroke = strokeAt((i * 7 % 24) * 15, speeds[i % 9]), inS = spins[i % 3], inT = spins[Math.floor(i / 3) % 3]
    const expected = launch(x, y, z, stroke, forwardSign, inS, inT)
    return { x, y, z, stroke, forwardSign, inS, inT, expected, S: expected[15], T: expected[16] }
  })
  const bounces = Array.from({ length: 24 }, (_, i) => {
    const T = [-1, -.5, 0, .5, 1, .25][i % 6], top = Math.max(T, 0), back = Math.max(-T, 0)
    const m = 1 + .35 * top - .45 * back, q = 1 + .25 * top - .35 * back
    const vx = [0, .4, -1.2, 2][i % 4], vy = [1.5, 2.5, -3.5, -1][(i >> 2) % 4], vz = [-.6, -1.4, -.2][i % 3]
    const pace = [.3, 1.1, 1.8, 2.6][(i >> 1) % 4]
    const expected = bounce(vx, vy, vz, pace, m, q)
    return { vx, vy, vz, pace, T, m, q, expected, reach: expected[0] * Math.hypot(vx, vy) }
  })
  return { launch: launches, bounce: bounces }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  writeFileSync(new URL('./fixtures/pong-spin-golden.json', import.meta.url), JSON.stringify(spinGolden(), null, 1) + '\n')
