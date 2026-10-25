import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { source, physicsUrl, pongUrl, PongClient, flightPosition } from './pongDisplay.mjs'
const { sweepContact, rimPosition, StrokeWindow, launch } = await import(physicsUrl)
const matchUrl = await source('../src/services/transport/MatchTransport.ts')
const { GameSession } = await import(await source('../src/features/games/session.ts', {
  '../../services/transport/MatchTransport': matchUrl, './pong': pongUrl,
  'chess.js': pathToFileURL(createRequire(import.meta.url).resolve('chess.js')).href,
}))
const frame = (extra = {}) => ({ id: 'm', t: 1000, b: [.5, 1.6, 0, 1], p: [.5, .5], r: [2.4, -.08], s: [0, 0], c: 0, h: 1, z: [.033, 0], l: true, drift: 0, ack: [0, 0], ...extra })
const snapshot = (extra = {}) => ({ id: 'm', game: 'pong', status: 'playing', inviter: 'me', players: ['me', 'other'], turn: null, seq: 0, version: 1,
  board: { score: [0, 0] }, outcome: null, drawOffer: null, rematch: [], series: {}, away: [], paused: false, expiresAt: null, points: 13, ...extra })
const close = (actual, expected, tolerance = 1e-9) => actual.forEach((x, i) => assert(Math.abs(x - expected[i]) <= tolerance, `${i}: ${x} vs ${expected[i]}`))

test('web contact, stroke and launch use the exact backend/Android golden vectors', async () => {
  assert.equal(await readFile(new URL('../src/features/games/pongPhysics.ts', import.meta.url), 'utf8'), await readFile(new URL('../../backend/src/games/pongPhysics.ts', import.meta.url), 'utf8'))
  const golden = JSON.parse(await readFile(new URL('../../backend/test/fixtures/pong-contact-golden.json', import.meta.url), 'utf8'))
  for (const v of golden.contacts) {
    const c = sweepContact(v.ball0, v.ball1, v.bat0, v.bat1, v.radius, v.forward)
    if (v.expected === null) assert.equal(c, null, v.name)
    else {
      close([c.time, c.nx, c.ny], v.expected)
      const bat = v.bat0.map((x, i) => x + (v.bat1[i] - x) * c.time), rim = rimPosition(c, bat, v.radius)
      assert(Math.abs(Math.hypot(rim[0] - bat[0], rim[1] - bat[1]) - v.radius) < 1e-9)
    }
  }
  for (const v of golden.strokes) {
    const w = new StrokeWindow()
    for (const sample of v.samples) w.sample(...sample)
    close(Object.values(w.stroke), v.expected)
    const arc = launch(.5, 1.6, .033, w.stroke)
    close(arc.slice(9, 12), v.target); assert(Math.abs(arc[13] - v.duration) < 1e-9)
  }
})
test('all 28 Kotlin-verified display traces execute on the shipped web client, in both seats', async () => {
  const traces = JSON.parse(await readFile(new URL('./fixtures/pong-display-traces.json', import.meta.url), 'utf8'))
  assert.equal(traces.length, 28)
  for (const seat of [1, 2]) for (const trace of traces) {
    const p = new PongClient(seat)
    for (const [index, a] of trace.actions.entries()) {
      if (a.type === 'receive') {
        let f = { ...a.frame, id: 'm' }
        if (seat === 2) {
          const arc = f.a && [...f.a]
          if (arc) for (let i = 0; i < 4; i++) { arc[i * 3] = 1 - arc[i * 3]; arc[i * 3 + 1] = 1.8 - arc[i * 3 + 1] }
          f = { ...f, a: arc, b: [1 - f.b[0], 1.8 - f.b[1], -f.b[2], -f.b[3]], p: [1 - f.p[1], 1 - f.p[0]],
            r: [1.8 - f.r[1], 1.8 - f.r[0]], s: [...f.s].reverse(), ack: [...f.ack].reverse(), spin: -f.spin, drift: -f.drift, serve: f.serve ? 3 - f.serve : 0 }
        }
        assert(p.receive(f, 'm', a.at), `seat ${seat} frame ${index}`)
      } else if (a.type === 'advance') p.advance(a.at)
      else p.paddle(a.x, a.y, a.released, a.at)
      close([p.x, p.y, p.height], a.expected.slice(0, 3), .0001)
      assert(Math.abs(p.displayTimeMs - a.expected[3]) <= .001)
    }
  }
})
test('a fast swipe launches immediately from either half of the drawn head without awarding a hit', () => {
  for (const y of [1.3, 2.4]) {
    const p = new PongClient(1)
    p.receive(frame({ t: 950, r: [y, -.08] }), 'm', 950); p.advance(950)
    p.receive(frame({ r: [y, -.08] }), 'm', 1000); p.advance(1050); p.paddle(.5, 1.6, false, 1050)
    assert(p.hasPrediction)
    const impact = p.y; p.advance(1070)
    assert(p.y < impact); assert.equal(p.hits, 1); assert.equal(p.myScore, 0)
    p.paddle(.8, 2.5, true, 1071); assert(p.hasPrediction)
  }
})
test('acknowledged rejection blends at the current draw time and allows retry after 60 ms', () => {
  const p = new PongClient(1)
  p.receive(frame(), 'm', 1000); p.advance(1000); p.paddle(.5, 1.6, false, 1000); p.advance(1020)
  const before = [p.x, p.y, p.height]
  p.receive(frame({ t: 1020, ack: [p.sampleN, 0] }), 'm', 1020); close([p.x, p.y, p.height], before)
  p.advance(1020); close([p.x, p.y, p.height], before)
  p.advance(1080); assert(p.contactEligible)
  p.paddle(.5, 2.4, false, 1080); p.paddle(.5, 1.6, false, 1081)
  assert(p.hasPrediction); assert.equal(p.hits, 1)
})
test('eligibility follows the displayed bounce and the impact height, never an undrawn frame', () => {
  const p = new PongClient(1)
  p.receive(frame({ l: false }), 'm', 1000); p.advance(1000)
  p.receive(frame({ t: 1033, l: true }), 'm', 1033); p.paddle(.5, 1.6, false, 1033); assert(!p.hasPrediction)
  p.advance(1100); assert(p.contactEligible)
  const low = new PongClient(1)
  low.receive(frame({ z: [-.1, 0] }), 'm', 1000); low.advance(1000); low.paddle(.5, 1.6, false, 1000); assert(!low.hasPrediction)
})
test('drift and ack are validated before mutation; legacy frames remain supported', () => {
  const p = new PongClient(1)
  for (const value of [{ drift: NaN }, { ack: [0] }, { ack: [0, -1] }, { ack: [0, .5] }, { ack: [0, Infinity] }]) assert(!p.receive(frame(value), 'm'))
  assert(p.receive(frame({ ack: undefined, drift: undefined }), 'm', 1000)); p.advance(1020); assert(Number.isFinite(p.y))
  const a = launch(.5, 1.6, 0, { side: 0, forward: 0, direction: 0, power: 0 })
  assert(flightPosition(a, .1, 1, 0)[0] < flightPosition(a, .1, 1)[0])
})
test('offset changes are bounded and authoritative extrapolation stops at 50 ms', () => {
  const p = new PongClient(1)
  p.receive(frame(), 'm', 1040); p.advance(1070); assert.equal(p.displayTimeMs, 1000)
  p.receive(frame({ t: 1033, b: [.5, 1.633, 0, 1] }), 'm', 1073); p.advance(1113)
  assert.equal(p.displayTimeMs, 1023); assert(Math.abs(p.y - 1.623) < 1e-9)
  const before = p.offset
  p.receive(frame({ t: 1066 }), 'm', 1700); assert(Math.abs(p.offset - before) <= 1)
  p.advance(5000); assert.equal(p.displayTimeMs, 1116)
  p.receive(frame({ t: 1100, c: 0 }), 'm', 1100); p.advance(1100)
  assert.equal(p.countdown, 0, 'a lower-latency frame cannot restart a completed countdown')
})
test('session sends 16/33 ms samples, flushes held stroke on release, and clears pending input on pause/dispose', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent = [], s = new GameSession('me', async () => ({ ok: true }), (...p) => sent.push(p), () => {}, () => {})
  s.connected = true; s.receive(snapshot()); s.pong.receive(frame(), 'm', 1000); s.pong.advance(1000)
  s.paddle(.5, 2.4, false, 1000); s.paddle(.5, 2.3, false, 1005)
  assert.equal(sent.length, 1); t.mock.timers.tick(33); assert.equal(sent.length, 2)
  s.paddle(.5, 1.9, false, 1040); assert.equal(sent.length, 3)
  s.paddle(.5, 1.85, false, 1048); t.mock.timers.tick(16); assert.equal(sent.length, 4)
  s.paddle(.4, 1.8, false, 1056, [.3, 1.7]); s.paddle(.4, 1.8, true, 1060)
  assert.equal(sent.at(-2)[3], false); assert.equal(sent.at(-1)[3], true)
  assert(sent.at(-1)[6].some((row) => row[5] === .3 && row[6] === 1.7))
  for (const [, , , , , timing, samples] of sent) {
    assert(Number.isSafeInteger(timing.ct)); assert(timing.v > 0); assert(samples.length <= 32)
    assert(samples.every((row) => row.length === 8 && row[0] < timing.n && row[1] < timing.ct && row[2] <= timing.v))
  }
  s.paddle(.2, 1.8, false, 1061); s.receive(snapshot({ version: 2, paused: true }))
  const count = sent.length; t.mock.timers.tick(100); assert.equal(sent.length, count)
  s.dispose(); t.mock.timers.tick(100); assert.equal(sent.length, count)
})
test('reconnect seeds per-seat n from ack and keeps ct increasing across matches', () => {
  const sent = [], s = new GameSession('me', async () => ({ ok: true }), (...p) => sent.push(p), () => {}, () => {})
  s.connected = true; s.receive(snapshot({ players: ['other', 'me'], inviter: 'me' }))
  s.pong.receive(frame({ ack: [9, 40] }), 'm', 1000); s.pong.advance(1000); s.paddle(.2, 2, true, 1010, [.3, 2.1])
  assert.equal(sent[0][5].n, 41); close(sent[0][4], [.7, -.3])
  const ct = sent[0][5].ct
  s.receive(snapshot({ id: 'next' })); s.pong.receive(frame({ id: 'next' }), 'next', 1000); s.pong.advance(1000)
  s.paddle(.2, 2, true, 1000); assert(sent.at(-1)[5].ct > ct); s.dispose()
})

test('a rejected serve prediction cannot snap on a stationary authoritative frame', () => {
  const p = new PongClient(1), serve = frame({ b: [.5, 1.56, 0, 0], l: false, serve: 1 })
  p.receive({ ...serve, t: 950 }, 'm', 950); p.receive(serve, 'm', 1000); p.advance(1050)
  p.paddle(.5, 1.56, false, 1050); p.advance(1070); assert(p.hasPrediction)
  const before = [p.x, p.y, p.height]
  p.receive({ ...serve, t: 1020, ack: [p.sampleN, 0] }, 'm', 1070)
  close([p.x, p.y, p.height], before)
  p.advance(1070); close([p.x, p.y, p.height], before)
  p.advance(1130); assert(p.contactEligible)
})
test('sample redundancy stays bounded and InternetTransport emits the exact additive wire payload', async () => {
  const sent = [], s = new GameSession('me', async () => ({ ok: true }), (...p) => sent.push(p), () => {}, () => {})
  s.connected = true; s.receive(snapshot()); s.pong.receive(frame(), 'm', 1000); s.pong.advance(1000)
  for (let n = 0; n < 100; n++) s.paddle(.2 + n / 1000, 2.4, true, 1000 + n)
  assert.equal(sent.at(-1)[6].length, 31)
  const { InternetTransport } = await import(await source('../src/services/transport/InternetTransport.ts', {
    'socket.io-client': 'data:text/javascript,export const io=()=>{}',
    '../supabaseClient': 'data:text/javascript,export const supabase={}',
    '../apiClient': 'data:text/javascript,export const authedFetch=()=>{}',
    './InternetCallTransport': 'data:text/javascript,export class InternetCallTransport{}',
    './MatchTransport': matchUrl,
  }))
  const transport = new InternetTransport(), emitted = [], delivery = []
  transport.socket = { connected: true, emit: (...v) => { delivery.push('reliable'); emitted.push(v) }, volatile: { emit: (...v) => { delivery.push('volatile'); emitted.push(v) } } }
  transport.sendPaddle(...sent.at(-1))
  const [id, x, y, released, touch, timing, samples] = sent.at(-1)
  assert.deepEqual(emitted[0], ['match:paddle', { matchId: id, x, y, released, ...timing, samples }])
  assert.equal(touch, undefined)
  transport.sendPaddle('legacy', .5)
  assert.deepEqual(emitted[1], ['match:paddle', { matchId: 'legacy', x: .5 }])
  assert.deepEqual(delivery, ['reliable', 'volatile'])
  s.dispose()
})
