import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PongSim } from '../src/games/pong.js'
import { StrokeWindow, launch, sweepContact } from '../src/games/pongPhysics.js'
import { paddleLimit } from '../src/games/paddleLimit.js'
import { EventEmitter } from 'node:events'
import { trackPongRtt } from '../src/games/pongRtt.js'
import { readFileSync } from 'node:fs'

test('timed back-half contact launches forward immediately at impact', () => {
  const p = new PongSim(() => .75)
  p.paddle(2, .5, .5); p.step(3000)
  p.paddle(2, .5, .24, false, undefined, { ct: 1000, v: 3000, n: 1 })
  assert.equal(p.hits, 1)
  assert.ok(p.frame().a![10] > .9)
  assert.equal(p.frame().ack[1], 1)
})

test('duplicated and reordered timed samples cannot move the bat or replay contact', () => {
  const p = new PongSim(() => .75)
  p.paddle(1, .2, 2.4, false, undefined, { ct: 1000, v: 0, n: 5 })
  const before = p.frame()
  p.paddle(1, .8, 1.3, false, undefined, { ct: 1001, v: 0, n: 5 })
  p.paddle(1, .9, 1.4, false, undefined, { ct: 1002, v: 0, n: 4 })
  assert.deepEqual(p.frame().p, before.p)
  assert.equal(p.frame().ack[0], 5)
})

test('a delayed bat segment is judged against the displayed ball, then fast-forwarded', () => {
  const p = new PongSim(() => .75)
  p.paddle(1, .5, 2.5, true); p.paddle(2, .5, -.4); p.step(3000)
  p.paddle(2, .5, .44, true); p.step(8)
  for (let i = 0; i < 500 && !(p.frame().l && p.y > 1.5); i++) p.step(8)
  assert.equal(p.hits, 1)
  const v = (p as unknown as { clock: number }).clock
  const x = p.x, y = p.y
  p.paddle(1, x, 2.4, false, undefined, { ct: 1000, v, n: 1 })
  p.step(120)
  p.paddle(1, x, y, false, undefined, { ct: 1033, v, n: 3 })
  assert.equal(p.hits, 2)
  assert.ok(p.frame().a![12] >= .119, 'return flight includes time since historical impact')
  assert.equal(p.frame().ack[0], 3, 'a missing sequence does not discard the covering segment')
})

test('Kotlin and TypeScript share identical contact, stroke and launch golden vectors', () => {
  const golden = JSON.parse(readFileSync(new URL('./fixtures/pong-contact-golden.json', import.meta.url), 'utf8'))
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)
  for (const c of golden.contacts) {
    const hit = sweepContact(c.ball0, c.ball1, c.bat0, c.bat1, c.radius, c.forward)
    if (c.expected === null) assert.equal(hit, null, c.name)
    else {
      assert.ok(hit, c.name)
      ;[hit.time, hit.nx, hit.ny].forEach((x, i) => near(x, c.expected[i]))
    }
  }
  for (const c of golden.strokes) {
    const window = new StrokeWindow()
    for (const [ct, x, y] of c.samples) window.sample(ct, x, y)
    const stroke = window.stroke
    ;[stroke.side, stroke.forward, stroke.direction, stroke.power].forEach((x, i) => near(x, c.expected[i]))
    const a = launch(.5, 1.6, .033, stroke)
    a.slice(9, 12).forEach((x, i) => near(x, c.target[i])); near(a[13], c.duration)
  }
})

test('past/future v is clamped and a pre-countdown claim cannot become an eligible hit', () => {
  const p = new PongSim(() => .75)
  p.paddle(2, .5, .5); p.step(3000)
  p.paddle(2, .5, .24, false, undefined, { ct: 1000, v: -1e12, n: 1 })
  assert.equal(p.hits, 0)
  const state = p as unknown as { previous: { v: number }[] }
  assert.equal(state.previous[1].v, 2750)
  p.paddle(2, .5, .24, false, undefined, { ct: 1016, v: 1e12, n: 2 })
  assert.equal(state.previous[1].v, 3000)
})

test('client-time strokes are unchanged by arrival jitter and release retains their launch strength', () => {
  const shot = (gaps: number[], released: boolean) => {
    const p = new PongSim(() => .75)
    p.paddle(2, .5, -.4); p.step(3000)
    for (const [i, y] of [-.4, -.3, .3].entries()) {
      p.step(gaps[i])
      p.paddle(2, .5, y, released && i === 2, undefined, { ct: 1000 + i * 25, v: 3000, n: i + 1 })
    }
    assert.equal(p.hits, 1)
    return p.frame().a!.slice(9, 12).concat(p.frame().a![13])
  }
  // Release controls subsequent drift, so compare the initial targets with zero sideways input.
  assert.deepEqual(shot([8, 8, 8], false), shot([40, 1, 35], false))
  assert.deepEqual(shot([8, 8, 8], false), shot([40, 1, 35], true))
})

test('a reconnect can use its own monotonic clock while retaining the per-match sequence', () => {
  const p = new PongSim(() => .75)
  assert.equal(p.paddle(1, .2, 2.4, false, undefined, { ct: 90000, v: 0, n: 1, source: 'old' }), true)
  assert.equal(p.paddle(1, .3, 2.4, false, undefined, { ct: 5, v: 0, n: 2, source: 'new' }), true)
  assert.equal(p.paddle(1, .9, 1.3, false, undefined, { ct: 4, v: 0, n: 3, source: 'new' }), false)
  assert.equal(p.frame().p[0], .3)
})

test('a late sample cannot replay a struck flight or undo a scored point', () => {
  const p = new PongSim(() => .75)
  p.paddle(2, .5, .5); p.paddle(1, -.26, 2.5); p.step(3000)
  p.paddle(2, .5, .24, false, undefined, { ct: 1000, v: 3000, n: 1 })
  assert.equal(p.hits, 1)
  p.paddle(2, .5, .24, false, undefined, { ct: 1016, v: 3000, n: 2 })
  assert.equal(p.hits, 1)
  for (let i = 0; i < 500 && !p.score.some(Boolean); i++) p.step(8)
  const before = p.frame()
  p.paddle(2, .5, .24, false, undefined, { ct: 1032, v: 3000, n: 3 })
  assert.equal(p.hits, before.h); assert.deepEqual(p.score, before.s)
})

test('64 Hz samples and coalesced release pairs fit the bounded rate bucket; floods do not', () => {
  let now = 0
  const allowed = paddleLimit(() => now)
  for (let i = 0; i < 640; i++) {
    now += 16
    assert.equal(allowed(), true)
    if (i % 64 === 0) { assert.equal(allowed(), true); assert.equal(allowed(), true) }
  }
  let burst = 0
  while (allowed()) burst++
  assert.ok(burst < 96)
  assert.equal(allowed(), false)
  now += 16; assert.equal(allowed(), true)
})


test('a redundant window restores an out-and-back stroke whose entire contact packet was lost', () => {
  const shot = (lost: boolean) => {
    const p = new PongSim(() => .75)
    p.paddle(2, .5, -.4); p.step(3000)
    const samples = [-.4, -.3, .3, -.4].map((y, i) => ({
      x: .5, y, ct: 1000 + i * 16, v: 3000, n: i + 1, released: i === 3, touch: [.5, y] as [number, number],
    }))
    p.paddleBatch(2, samples.slice(0, 1))
    if (!lost) p.paddleBatch(2, samples.slice(0, 3))
    p.paddleBatch(2, samples)
    assert.equal(p.hits, 1)
    assert.equal(p.frame().ack[1], 4)
    assert.equal(p.frame().spin, 0, 'the recovered release clears ongoing drift')
    p.paddleBatch(2, samples)
    assert.equal(p.hits, 1, 'redundant copies cannot strike again')
    return p.frame().a
  }
  assert.deepEqual(shot(true), shot(false))
})

test('a lost release is finalized by the existing 120 ms idle rule', () => {
  const p = new PongSim(() => .75)
  p.paddle(2, .2, -.4); p.step(3000)
  p.paddle(2, .2, -.4, false, undefined, { ct: 1000, v: 3000, n: 1 })
  p.paddle(2, .8, .3, false, undefined, { ct: 1016, v: 3000, n: 2 })
  assert.equal(p.hits, 1)
  assert.notEqual(p.frame().spin, 0)
  p.step(121)
  assert.equal(p.frame().spin, 0)
  assert.equal(p.hits, 1)
})


test('rewind cap is derived per seat from server-measured RTT and has a hard 500 ms ceiling', () => {
  const p = new PongSim(() => .75)
  p.step(3000)
  p.paddle(1, .2, 2.5, false, undefined, { ct: 1, v: -1e9, n: 1, rtt: 300 })
  p.paddle(2, .2, -.5, false, undefined, { ct: 1, v: -1e9, n: 1, rtt: 0 })
  const state = p as unknown as { previous: { v: number }[] }
  assert.equal(state.previous[0].v, 2600)
  assert.equal(state.previous[1].v, 2750)
  p.paddle(1, .2, 2.5, false, undefined, { ct: 2, v: -1e9, n: 2, rtt: 1e9 })
  // v cannot decrease, even when the measured cap increases.
  assert.equal(state.previous[0].v, 2600)
  const fresh = new PongSim(() => .75); fresh.step(3000)
  fresh.paddle(1, .2, 2.5, false, undefined, { ct: 1, v: -1e9, n: 1, rtt: 1e9 })
  assert.equal((fresh as unknown as typeof state).previous[0].v, 2500)
})

test('RTT uses server-observed handshake/heartbeat elapsed time and a bounded recent maximum', () => {
  let now = 100
  const engine = new EventEmitter()
  const measured = trackPongRtt(engine, () => now)
  assert.equal(measured(), undefined)
  now = 400; engine.emit('packet', { type: 'message', data: '0{"rtt":999999}' })
  assert.equal(measured(), 300, 'payload content does not supply RTT')
  now = 500; engine.emit('packet', { type: 'pong' }); assert.equal(measured(), 300, 'unsolicited pong ignored')
  for (let i = 0; i < 8; i++) {
    engine.emit('packetCreate', { type: 'ping' }); now += 40; engine.emit('packet', { type: 'pong' })
  }
  assert.equal(measured(), 40, 'old high sample expires after eight probes')
})
