// Adapted from Android 4ac64ac scripts/pong-contact-harness.ts; runs the actual shipped web client.
// From client: node --import ../backend/node_modules/tsx/dist/loader.mjs test/pong-contact-harness.ts [report.json]
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { PongSim, contactRadius } from '../../backend/src/games/pong.ts'
import { CompensatedDisplay } from './pongDisplay.mjs'
type Profile = { latency: number; jitter: number; hz: number; frameLoss: number; paddleLoss: number }
type Input = { x: number; y: number; ct: number; v: number; n: number; released: boolean }
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
function random(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
function trial(profile: Profile, seed: number, style: number) {
  const rng = random(seed), sim = new PongSim(() => .75), display = new CompensatedDisplay()
  // Eight server-observed handshake/heartbeat probes on the same simulated link.
  const probeRng = random(seed ^ 0x123456)
  const measuredRtt = Math.max(...Array.from({ length: 8 }, () =>
    Math.max(0, profile.latency + (probeRng() * 2 - 1) * profile.jitter) +
    Math.max(0, profile.latency + (probeRng() * 2 - 1) * profile.jitter)))
  // A real neutral serve and table bounce. The receiver starts safely outside its path.
  sim.paddle(1, .5, 2.5, true); sim.paddle(2, .5, -.4); sim.step(3000)
  sim.paddle(2, .5, .44, true); sim.step(8)
  assert.equal(sim.hits, 1)
  let actualTarget: number[] | null = null
  const probe = sim as unknown as { strike: (seat: number) => void; flight: { points: number[][]; duration: number } }
  const strike = probe.strike.bind(sim)
  probe.strike = (seat) => {
    strike(seat)
    if (seat === 1 && actualTarget === null) actualTarget = probe.flight.points[3].concat(probe.flight.duration)
  }
  const epoch = sim.frame().t
  const queue: { at: number; run: () => void }[] = []
  let lastDown = 0, lastUp = 0, nextTick = 0, tickAt = 0, nextFrame = 0, nextRender = 0, nextSend = 0
  let started = -1, overlap = -1, overlapFrames = 0, launch = -1, confirmed = -1, startY = 2.5, startX = .5
  let lastHits = sim.hits
  let input: Input | null = null
  let releasedStroke = false
  const recent: Input[] = []
  const move = (x: number, y: number, now: number, released = false) => {
    const result = display.paddle(x, y, now, released)
    if (result) { input = result; recent.push(result); if (recent.length > 32) recent.shift() }
  }
  const packet = (released: boolean, now: number) => {
    if (released) move(display.px, display.py, now, true)
    assert(input)
    const p: Input = { ...input, released }
    const samples = recent.filter(sample => sample.n < p.n).concat(p).map(sample => ({ ...sample, touch: [sample.x, sample.y] as [number, number], rtt: measuredRtt }))
    if (rng() < profile.paddleLoss) return
    const at = lastUp = Math.ceil(Math.max(lastUp, now + Math.max(0, profile.latency + (rng() * 2 - 1) * profile.jitter)))
    queue.push({ at, run: () => {
      sim.paddleBatch(1, samples, epoch + at)
    } })
  }
  for (let now = 0; now <= 2400; now++) {
    if (launch >= 0 && now > launch + 180) break
    queue.sort((a, b) => a.at - b.at)
    while (queue[0]?.at <= now) queue.shift()!.run()
    if (now >= nextTick) {
      sim.step(now - tickAt || 1, epoch + now); tickAt = now; nextTick = now + 12 + Math.floor(rng() * 10)
      if (sim.hits > lastHits && confirmed < 0) {
        lastHits = sim.hits
        confirmed = now
      }
    }
    if (now >= nextFrame) {
      nextFrame += 1000 / 30
      if (rng() >= profile.frameLoss) {
        const f = { ...sim.frame(), t: sim.frame().t }
        const at = lastDown = Math.ceil(Math.max(lastDown, now + Math.max(0, profile.latency + (rng() * 2 - 1) * profile.jitter)))
        queue.push({ at, run: () => {
          display.receive(f, at)
          if (f.h === 2 && launch < 0) {
            launch = at
          }
        } })
      }
    }
    if (now >= nextRender) {
      nextRender += 1000 / profile.hz
      display.advance(now)
      if (started < 0 && display.frame?.l && display.y > 1.35 && display.z >= -.033) {
        started = now; startX = display.x + (style === 3 ? -.35 : style === 4 ? .35 : 0)
        startY = style === 5 ? display.y - .25 : Math.max(1.3, display.y + .35)
        move(clamp(startX, -.26, 1.26), clamp(startY, 1.3, 2.5), now)
      }
      if (started >= 0 && !releasedStroke) {
        const duration = [500, 240, 60, 100, 100, 120][style]
        const t = clamp((now - started) / duration, 0, 1)
        if (style === 0) { move(display.x, 1.8, now) }
        else {
          move(clamp(startX + (display.x - startX) * t, -.26, 1.26),
            clamp(startY + (style === 5 ? .5 : -.6) * t, 1.3, 2.5), now)
        }
        const gap = Math.hypot(display.x - display.px, display.y - display.py) - contactRadius(display.z)
        if (gap <= 0 && display.z >= -.033 && display.frame?.l) {
          if (overlap < 0) overlap = now
          overlapFrames++
        }
        if (now >= nextSend) { packet(false, now); nextSend = now + (display.possible ? 16 : 33) }
        if (now - started >= duration) { packet(true, now); releasedStroke = true }
      }
    }
  }
  const d = display
  const visibleLaunch = d.firstPredictedAt >= 0 ? d.firstPredictedAt : launch
  const visibleContact = d.firstPredictedAt >= 0 ? Math.min(overlap < 0 ? Infinity : overlap, d.firstPredictedAt) : overlap
  const mismatch = actualTarget && d.firstTarget ? Math.max(...(actualTarget as number[]).map((x, i) => Math.abs(x - d.firstTarget![i]))) : null
  return { overlapMiss: overlapFrames >= 2 && (confirmed < 0 || visibleLaunch < 0 || visibleLaunch - visibleContact > 150), ghost: d.firstLaunchGap > .033,
    overlap: visibleContact >= 0, snap: Math.max(d.confirmationSnap, ...d.blendSteps),
    delay: visibleContact >= 0 && visibleLaunch >= 0 ? visibleLaunch - visibleContact : null,
    early: visibleContact >= 0 && visibleLaunch >= 0 && visibleLaunch < visibleContact,
    launchGap: Math.max(0, d.firstLaunchGap),
    predictions: display.predictionCount,
    rejections: d.rejections, mismatch, unconfirmed: confirmed < 0 }
}

const profiles: Profile[] = []
for (const latency of [0, 40, 80, 150]) for (const jitter of [0, 20, 40]) for (const hz of [60, 90, 120])
  for (const loss of [false, true]) profiles.push({ latency, jitter, hz, frameLoss: loss ? .1 : 0, paddleLoss: loss ? .05 : 0 })
const percentile = (a: number[], q: number) => a.sort((a, b) => a - b)[Math.max(0, Math.ceil(a.length * q) - 1)] ?? 0
const trialsPerProfile = 240
const rows = profiles.map((p, index) => {
  const results = Array.from({ length: trialsPerProfile }, (_, i) => trial(p, 10000 + index * 1000 + i, i % 6))
  return { ...p, trials: results.length, visibleOverlaps: results.filter(x => x.overlap).length,
    visibleOverlapMissRate: results.filter(x => x.overlapMiss).length / Math.max(1, results.filter(x => x.overlap).length),
    ghostHitRate: results.filter(x => x.ghost).length / results.length,
    launchSnapP99: percentile(results.map(x => x.snap), .99), launchSnapMax: Math.max(...results.map(x => x.snap)),
    contactToLaunchP95: percentile(results.flatMap(x => x.delay === null ? [] : [x.delay]), .95),
    drawnGapMax: Math.max(...results.map(x => x.launchGap)),
    earlyLaunches: results.filter(x => x.early).length,
    predictions: results.reduce((n, x) => n + x.predictions, 0), rejectedPredictions: results.reduce((n, x) => n + x.rejections, 0),
      strokeMismatch: Math.max(...results.flatMap(x => x.mismatch === null ? [] : [x.mismatch])),
      unconfirmed: results.filter(x => x.unconfirmed).length }
})
const report = { revision: 'web-2.0.12-actual-client', trials: rows.length * trialsPerProfile, profiles: rows }
const output = process.argv[2]
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.table([0, 40, 80, 150].map(latency => {
  const group = rows.filter(x => x.latency === latency)
  return { latency, trials: group.length * trialsPerProfile,
    missPct: (100 * group.reduce((s, x) => s + x.visibleOverlapMissRate, 0) / group.length).toFixed(2),
    ghostPct: (100 * group.reduce((s, x) => s + x.ghostHitRate, 0) / group.length).toFixed(2),
    snapMax: Math.max(...group.map(x => x.launchSnapMax)).toFixed(4), launchP95: Math.max(...group.map(x => x.contactToLaunchP95)).toFixed(1) }
}))

for (const row of rows) {
  const name = JSON.stringify(row)
  assert.ok(row.visibleOverlaps >= row.trials * .95, `coverage: ${name}`)
  assert.ok(row.visibleOverlapMissRate <= (row.latency === 150 && row.paddleLoss ? .02 : .005), `miss: ${name}`)
  assert.ok(row.ghostHitRate <= .005 && row.drawnGapMax <= 1.5 * .033, `ghost: ${name}`)
  assert.ok(row.launchSnapP99 <= .02 && row.launchSnapMax <= .05, `correction: ${name}`)
  assert.equal(row.earlyLaunches, 0, `early launch: ${name}`)
  if (row.latency <= 80) assert.ok(row.contactToLaunchP95 <= 1000 / row.hz, `launch delay: ${name}`)
  assert.ok(row.strokeMismatch <= .0001, `stroke: ${name}`)
  assert.equal(row.unconfirmed, 0, `unconfirmed: ${name}`)
}
