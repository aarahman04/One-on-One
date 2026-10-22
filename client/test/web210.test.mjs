import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const source = async (path, replacements = {}) => {
  let code = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  for (const [from, to] of Object.entries(replacements)) code = code.replaceAll(`'${from}'`, JSON.stringify(to))
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const { isSingleEmoji } = await import(await source('../src/utils/emoji.ts'))
const { photoFitSize } = await import(await source('../src/utils/photo.ts'))
const { letterFromDefault } = await import(await source('../src/features/letterDefaults.ts'))
const { clockPresets, defaultClock, validClock, clockFace, limitReaction, reactionLength } = await import(await source('../src/features/games/options.ts'))
const { appendBrushPoint } = await import(await source('../src/utils/stickerBrush.ts'))
const matchUrl = await source('../src/services/transport/MatchTransport.ts')
const pongUrl = await source('../src/features/games/pong.ts')
const { decodeMatch } = await import(matchUrl)
const { PongClient, flightPosition } = await import(pongUrl)
const { GameSession } = await import(await source('../src/features/games/session.ts', {
  '../../services/transport/MatchTransport': matchUrl, './pong': pongUrl,
  'chess.js': pathToFileURL(createRequire(import.meta.url).resolve('chess.js')).href,
}))

test('big emoji is exactly one emoji grapheme: family, skin tone, flags and keycaps', () => {
  for (const s of ['👨‍👩‍👧‍👦', '👍🏽', '🇮🇳', '1️⃣', '#️⃣', '❤', '❤️', ' 🥰 ']) assert.equal(isSingleEmoji(s), true, s)
  for (const s of ['', 'hello', 'hi 😊', '😊😊', '1', '#', '🏽', '🇮', '😊 👏']) assert.equal(isSingleEmoji(s), false, s)
})
test('photos fit the long side once, never upscale or produce zero pixels', () => {
  assert.deepEqual(photoFitSize(4000, 3000), { width: 2048, height: 1536 })
  assert.deepEqual(photoFitSize(3000, 4000), { width: 1536, height: 2048 })
  assert.deepEqual(photoFitSize(320, 200), { width: 320, height: 200 })
  assert.deepEqual(photoFitSize(1, 20000), { width: 1, height: 2048 })
  for (const n of [0, -1, NaN, Infinity]) assert.throws(() => photoFitSize(n, 20))
})
test('From prioritizes myNickname, then a saved signature, then me', () => {
  assert.equal(letterFromDefault(' Alex ', 'Saved'), 'Alex')
  assert.equal(letterFromDefault(null, ' Saved '), 'Saved')
  assert.equal(letterFromDefault(' ', ''), 'me')
  assert.equal(letterFromDefault(), 'me')
})
test('reaction counter uses code points and truncates without splitting surrogate pairs', () => {
  assert.equal(reactionLength('👍'), 1)
  assert.equal(reactionLength('👨‍👩‍👧‍👦'), 7)
  const value = limitReaction('👍'.repeat(61))
  assert.equal(reactionLength(value), 60)
  assert.equal(value, '👍'.repeat(60))
  assert.equal(limitReaction('Hi\n\t there'), 'Hi there')
})
test('clock presets/defaults and custom bounds match the contract', () => {
  assert.deepEqual(clockPresets, [null, 60000, 120000, 300000, 600000, 3600000])
  assert.deepEqual(['chess', 'reversi', 'connect4', 'tictactoe', 'dots', 'pong'].map(defaultClock), [600000, 300000, 120000, 60000, null, null])
  for (const [b, i] of [[10000, 0], [10800000, 60000], [180000, 2000]]) assert(validClock(b, i))
  for (const [b, i] of [[9999, 0], [10800001, 0], [10000, -1], [10000, 60001], [10000.5, 0], [NaN, 0], [10000, Infinity]]) assert(!validClock(b, i))
  assert.equal(clockFace(3900000), '1:05:00'); assert.equal(clockFace(9400), '0:09.4'); assert.equal(clockFace(-1), '0:00.0')
})
const snapshot = (extra = {}) => ({ id: 'm', game: 'tictactoe', status: 'playing', inviter: 'me', players: ['me', 'other'], turn: 'me', seq: 0, version: 1,
  board: { cells: Array(9).fill(0), last: -1, line: [] }, outcome: null, drawOffer: null, rematch: [], series: {}, away: [], paused: false, expiresAt: null, clock: null, points: null, ...extra })
test('game hub allows inviting an offline partner while the sender is connected', async () => {
  const calls = [], notices = []
  const s = new GameSession('me', async (event, payload) => { calls.push([event, payload]); return { ok: true } }, () => {}, () => {}, (text) => notices.push(text))
  s.connected = true; s.online = false
  s.hub(); assert.equal(s.stage, 'hub'); assert.equal(notices.length, 0)
  await s.invite('chess', { clock: { base: 60000, inc: 0 } })
  assert.equal(calls[0][0], 'match:invite')
  s.connected = false; s.hub()
  assert.equal(notices.length, 1)
  s.dispose()
})
test('Reversi consumes server legal moves/flips and rejects malformed board/clock/score data', () => {
  const cells = Array(64).fill(0); cells[27] = cells[36] = 1; cells[28] = cells[35] = 2
  const m = snapshot({ game: 'reversi', board: { cells, last: -1, flipped: [], passed: false, legal: [20, 29, 34, 43] } })
  assert(decodeMatch(m))
  assert.equal(decodeMatch({ ...m, board: { ...m.board, flipped: [64] } }), null)
  assert.equal(decodeMatch({ ...m, board: { ...m.board, passed: 'false' } }), null)
  assert.equal(decodeMatch({ ...m, clock: { base: 10000, inc: 60001, left: [10000, 10000] } }), null)
  assert.equal(decodeMatch({ ...m, points: 100 }), null)
})
test('optimistic grid moves appear before the acknowledgement and revert on rejection', async () => {
  let resolve
  const s = new GameSession('me', (event) => event === 'match:move' ? new Promise((r) => { resolve = r }) : Promise.resolve({ ok: true }), () => {}, () => {}, () => {})
  s.connected = true; s.receive(snapshot())
  const move = s.move({ cell: 4 })
  assert.equal(s.predictedGrid.cells[4], 1); assert.equal(s.match.board.cells[4], 0)
  resolve({ ok: false, error: 'invalid_move' }); await move
  assert.equal(s.predictedGrid, null); assert.equal(s.match.board.cells[4], 0)
  s.receive(snapshot({ id: 'connect', game: 'connect4', board: { cells: Array(42).fill(0), last: -1, line: [] } }))
  const drop = s.move({ col: 2 }); assert.equal(s.predictedGrid.last, 37)
  resolve({ ok: false }); await drop; s.dispose()
})
test('closing results always sends leave; reactions are silent when throttled', async () => {
  const calls = [], notices = []
  const s = new GameSession('me', async (e, p) => { calls.push([e, p]); return { ok: false, error: 'rate_limited' } }, () => {}, () => {}, (n) => notices.push(n))
  s.receive(snapshot({ status: 'over', outcome: { winner: null, reason: 'agreement' } }))
  await s.action('match:react', { text: 'Hi' }); assert.deepEqual(notices, [])
  s.done(); assert.equal(calls.at(-1)[0], 'match:leave'); s.dispose()
})
test('Pong rotates 2D rackets, accepts custom scores, bounds prediction and never reflects open edges', () => {
  const p = new PongClient(2), arc = [.5, .9, .1, .6, .5, .5, .8, .2, .5, .9, 0, -.5, .1, 1]
  const frame = { id: 'm', t: 1, b: [.5, .9, 1, -1], p: [.4, .6], r: [1.9, -.1], s: [11, 21], c: 0, h: 1, z: [.2, -.1], a: arc, spin: .7, serve: 2, j: 1, l: true }
  assert(p.receive(frame, 'm', 100)); assert.equal(p.myScore, 21); assert(p.myServe)
  assert.deepEqual(p.paddle(.2, 2.2, true).map((n) => Math.round(n * 100)), [80, -40])
  assert(!p.receive({ ...frame, t: 2, a: [...arc.slice(0, 13), 0] }, 'm', 100))
  const q = new PongClient(1)
  q.receive({ ...frame, a: null, b: [1.2, .5, 1, 0] }, 'm', 100)
  q.advance(100); q.advance(250); const x = q.x
  q.advance(10000); assert(q.x >= x && q.x <= 1.35); assert(q.x > 1)
  assert.deepEqual(flightPosition([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0, 1], 0, 0), [0, 0, 0])
  assert(flightPosition(arc, .15, .7)[0] > flightPosition(arc, .15, 0)[0])
})
test('brush points stay bounded while preserving the first and latest endpoints', () => {
  let points = []
  for (let i = 0; i < 5000; i++) points = appendBrushPoint(points, { x: i, y: i })
  assert(points.length <= 1024); assert.equal(points[0].x, 0); assert.equal(points.at(-1).x, 4999)
  assert.throws(() => appendBrushPoint([], { x: NaN, y: 0 }))
})
test('hang-up waits for the shared socket before call:end', async () => {
  const { InternetCallTransport } = await import(await source('../src/services/transport/InternetCallTransport.ts'))
  const events = [], handlers = new Map()
  const socket = { connected: false, on: (e, f) => handlers.set(e, f), off: (e) => handlers.delete(e), connect() {}, emit(e, p, ack) { events.push([e, p]); ack({ ok: true }) } }
  const end = new InternetCallTransport(socket).end('call')
  assert.equal(events.length, 0)
  socket.connected = true; handlers.get('connect')(); await end
  assert.deepEqual(events, [['call:end', { callId: 'call' }]])
  assert.equal(handlers.size, 0)
})
test('an invite acknowledgement arriving after timeout resolves the abandoned server call', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { InternetCallTransport } = await import(await source('../src/services/transport/InternetCallTransport.ts'))
  const events = []
  let acknowledge
  const socket = { connected: true, emit(event, payload, ack) { events.push([event, payload]); if (event === 'call:invite') acknowledge = ack; else ack({ ok: true }) } }
  const transport = new InternetCallTransport(socket), invitation = transport.invite('video')
  const rejected = assert.rejects(invitation, /timed out/)
  t.mock.timers.tick(10_000); await rejected
  acknowledge({ callId: 'late', iceServers: [] })
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(events, [['call:invite', { kind: 'video' }], ['call:end', { callId: 'late' }]])
})
test('the 118-second dictation cap transcribes and appends punctuation exactly once', async (t) => {
  const keys = ['navigator', 'document', 'MediaRecorder', 'localStorage', '__stopCount']
  const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  t.after(() => { for (const [key, value] of descriptors) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] } })
  const controls = { span: { textContent: '' }, '[data-stop]': { addEventListener() {}, disabled: false }, '[data-cancel]': { addEventListener() {} } }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia() {} } } })
  globalThis.document = { createElement: () => ({ querySelector: (key) => controls[key], remove() {} }), addEventListener() {}, removeEventListener() {} }
  globalThis.MediaRecorder = class {}
  globalThis.localStorage = { getItem: () => '1' }
  globalThis.__stopCount = 0
  const { startVoiceTyping } = await import(await source('../src/features/voiceTyping.ts', {
    './voiceRecorder': 'data:text/javascript,export const startRecording=async()=>({stop:async()=>{globalThis.__stopCount++;return {blob:new Blob(["audio"]) }},cancel(){}})',
    '../services/speechService': 'data:text/javascript,export const transcribe=async()=>"Hello, world! How are you?";export const canUseDeviceSpeech=()=>false;export const speechNotice=()=>"failed"',
  }))
  t.mock.timers.enable({ apis: ['setInterval'] })
  let changes = 0
  const input = { value: 'Draft', maxLength: 4000, focus() {}, dispatchEvent() { changes++ } }
  const composer = { dataset: {}, before() {} }
  startVoiceTyping(composer, input, () => assert.fail('unexpected notice'))
  await new Promise((r) => setImmediate(r))
  t.mock.timers.tick(117_000)
  assert.equal(globalThis.__stopCount, 0); assert.equal(input.value, 'Draft')
  t.mock.timers.tick(1000)
  await new Promise((r) => setImmediate(r))
  assert.equal(globalThis.__stopCount, 1); assert.equal(input.value, 'Draft Hello, world! How are you?'); assert.equal(changes, 1)
  t.mock.timers.tick(10000); assert.equal(globalThis.__stopCount, 1)
})
