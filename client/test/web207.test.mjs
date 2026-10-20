import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = async (path, replacements = {}) => {
  let code = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  }).outputText
  for (const [from, to] of Object.entries(replacements)) code = code.replaceAll(`'${from}'`, JSON.stringify(to))
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const matchUrl = await source('../src/services/transport/MatchTransport.ts')
const pongUrl = await source('../src/features/games/pong.ts')
const { decodeMatch } = await import(matchUrl)
const { PongClient } = await import(pongUrl)
const { GameSession } = await import(
  await source('../src/features/games/session.ts', {
    '../../services/transport/MatchTransport': matchUrl,
    './pong': pongUrl,
    'chess.js': pathToFileURL(require.resolve('chess.js')).href,
  })
)
const { Chess } = require('chess.js')
const snapshot = (overrides = {}) => ({
  id: 'match-a',
  game: 'chess',
  status: 'playing',
  inviter: 'me',
  players: ['me', 'other'],
  turn: 'me',
  seq: 0,
  version: 1,
  board: { fen: new Chess().fen(), last: null, check: false, claim: null, history: [] },
  outcome: null,
  drawOffer: null,
  rematch: [],
  series: { me: 0, other: 0 },
  away: [],
  paused: false,
  expiresAt: null,
  ...overrides,
})
const makeSession = (call = async () => ({ ok: true }), changed = () => {}, notice = () => {}) =>
  new GameSession('me', call, () => {}, changed, notice)
const tick = () => new Promise((r) => setImmediate(r))

test('match codec rejects foreign shapes and malformed per-game boards', () => {
  assert(decodeMatch(snapshot()))
  for (const value of [
    null,
    {},
    snapshot({ players: ['me', 'me'] }),
    snapshot({ seq: -1 }),
    snapshot({ version: NaN }),
    snapshot({ away: ['stranger'] }),
    snapshot({ board: { fen: 'fen' } }),
    snapshot({ game: 'tictactoe', board: { cells: [0], line: [], last: -1 } }),
    snapshot({
      game: 'dots',
      board: { h: Array(30).fill(0), v: Array(30).fill(0), boxes: Array(25).fill(3), last: null },
    }),
  ])
    assert.equal(decodeMatch(value), null)
})
test('session dedupes seq/version, accepts same-seq presence and ignores retired matches', () => {
  let updates = 0
  const s = makeSession(undefined, () => updates++)
  s.receive(snapshot())
  s.receive(snapshot())
  s.receive(snapshot({ version: 0 }))
  assert.equal(updates, 1)
  s.receive(snapshot({ version: 2, away: ['other'] }))
  assert.deepEqual(s.match.away, ['other'])
  s.receive(snapshot({ version: 3, seq: 1, turn: 'other' }))
  s.receive(snapshot({ version: 4, seq: 0 }))
  assert.equal(s.match.seq, 1)
  s.receive(snapshot({ players: ['stranger', 'other'], inviter: 'stranger', turn: 'stranger' }))
  assert.equal(s.player, 1)
  s.receive(
    snapshot({
      status: 'over',
      version: 4,
      outcome: { winner: 'me', reason: 'checkmate' },
      series: { me: 1, other: 0 },
    }),
  )
  s.receive(snapshot({ id: 'match-b', players: ['other', 'me'], turn: 'other' }))
  assert.equal(s.player, 2)
  s.receive(snapshot({ version: 99 }))
  assert.equal(s.match.id, 'match-b')
  s.dispose()
})
test('initial connect and reconnect sync without waiting for history or presence', async () => {
  const calls = []
  const s = makeSession(async (e) => {
    calls.push(e)
    return { ok: true, match: snapshot() }
  })
  s.availability(true, false)
  await tick()
  assert.equal(s.stage, 'playing')
  s.availability(true, true)
  assert.equal(calls.length, 1)
  s.availability(false, false)
  s.availability(true, false)
  await tick()
  assert.deepEqual(calls, ['match:sync', 'match:sync'])
  s.dispose()
})
test('sync null removes a live match, keeps a result, and cannot erase a newer pushed snapshot', async () => {
  let resolve
  const s = makeSession(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  s.receive(snapshot())
  const sync = s.sync()
  s.receive(snapshot({ version: 2 }))
  resolve({ ok: true, match: null })
  await sync
  assert(s.match)
  const missing = s.sync()
  resolve({ ok: true, match: null })
  await missing
  assert.equal(s.match, null)
  s.receive(snapshot({ status: 'over', outcome: { winner: null, reason: 'agreement' } }))
  const ended = s.sync()
  resolve({ ok: true, match: null })
  await ended
  assert.equal(s.stage, 'result')
  s.dispose()
})
test('optimistic chess is immediate and rejection restores authoritative position', async () => {
  let resolve
  const calls = [],
    s = makeSession((e, p) => {
      calls.push([e, p])
      return e === 'match:move'
        ? new Promise((r) => {
            resolve = r
          })
        : Promise.resolve({ ok: true, match: snapshot() })
    })
  s.connected = true
  s.receive(snapshot())
  const before = s.match.board.fen,
    move = s.move({ uci: 'e2e4' })
  assert(s.predicted.fen !== before)
  assert.equal(s.match.board.fen, before)
  assert.equal(s.busy, true)
  await s.move({ uci: 'd2d4' })
  assert.equal(calls.length, 1)
  resolve({ ok: false, error: 'illegal_move', match: snapshot() })
  await move
  assert.equal(s.predicted, null)
  assert.equal(s.busy, false)
  assert.equal(s.match.board.fen, before)
  s.dispose()
})
test('lost move ack retries the identical envelope once, confirmed moves render only server state', async () => {
  const chess = new Chess()
  chess.move('e4')
  const calls = []
  const s = makeSession(async (e, p) => {
    calls.push([e, p])
    if (calls.length === 1) throw new TypeError('network')
    return {
      ok: true,
      match: snapshot({
        version: 2,
        seq: 1,
        turn: 'other',
        board: { fen: chess.fen(), last: { from: 'e2', to: 'e4' }, history: ['e4'], check: false, claim: null },
      }),
    }
  })
  s.connected = true
  s.receive(snapshot())
  await s.move({ uci: 'e2e4' })
  assert.deepEqual(calls[0], calls[1])
  assert.deepEqual(calls[0], ['match:move', { matchId: 'match-a', seq: 0, move: { uci: 'e2e4' } }])
  assert.equal(s.match.seq, 1)
  assert.equal(s.predicted, null)
  s.dispose()
})
test('paddle sends the latest rotated x at no more than 30/s and stops after dispose', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent = [],
    s = new GameSession(
      'me',
      async () => ({ ok: true }),
      (id, x) => sent.push([id, x]),
      () => {},
      () => {},
    )
  s.connected = true
  s.receive(snapshot({ game: 'pong', players: ['other', 'me'], turn: null, board: { score: [0, 0] } }))
  s.paddle(0.2)
  for (let i = 0; i < 100; i++) s.paddle(0.8)
  assert.equal(sent.length, 1)
  assert.equal(sent[0][1], 0.8)
  t.mock.timers.tick(34)
  assert.equal(sent.length, 2)
  assert(Math.abs(sent[1][1] - 0.2) < 0.00001)
  s.paddle(0.4)
  s.dispose()
  t.mock.timers.tick(1000)
  assert.equal(sent.length, 2)
})
test('pong rotates seat 2, rejects old/foreign frames and holds the extrapolated ball on a racket', () => {
  const f = { id: 'm', t: 1, b: [0.5, 1.6, 0, 2], p: [0.5, 0.5], s: [2, 3], c: 0, h: 4 },
    p = new PongClient(1),
    q = new PongClient(2)
  assert(p.receive(f, 'm', 100))
  assert(q.receive(f, 'm', 100))
  assert.equal(q.myScore, 3)
  const restored = new PongClient(2)
  restored.receive({ ...f, p: [0.2, 0.8] }, 'm', 100)
  assert(Math.abs(restored.myX - 0.2) < 0.0001)
  const dragged = new PongClient(2)
  dragged.paddle(0.7)
  dragged.receive({ ...f, p: [0.2, 0.8] }, 'm', 100)
  assert.equal(dragged.myX, 0.7)
  assert.equal(q.theirScore, 2)
  assert(Math.abs(q.y - 0.2) < 0.0001)
  assert(!p.receive(f, 'm', 120))
  assert(!p.receive({ ...f, t: 2 }, 'foreign', 120))
  assert(!p.receive({ ...f, t: 2, b: [NaN, 0, 0, 0] }, 'm', 120))
  p.advance(100)
  p.advance(250)
  assert(p.y <= 1.64)
  assert(p.y >= 1.6)
  p.receive({ ...f, t: 3, b: [0.5, 0.9, 0, 0], c: 3000 }, 'm', 300)
  p.advance(1000)
  assert.equal(p.countdown, 2300)
})

const speechUrl = await source('../src/services/speechService.ts', {
  './apiClient': `data:text/javascript,export const authedFetch=(...args)=>globalThis.__speechFetch(...args)`,
})
const { SpeechFailure, canUseDeviceSpeech, narrationPart, transcribe } = await import(speechUrl)
test('recorder startup failure releases the microphone for subsequent notes or dictation', async (t) => {
  let stopped = 0
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) } },
  })
  t.after(() => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else delete globalThis.navigator
    delete globalThis.MediaRecorder
  })
  globalThis.MediaRecorder = class {
    static isTypeSupported() {
      return true
    }
    constructor() {
      throw new Error('start failed')
    }
  }
  const { startRecording } = await import(await source('../src/features/voiceRecorder.ts'))
  await assert.rejects(startRecording, /start failed/)
  assert.equal(stopped, 1)
})
test('speech fallback matches Android: network, 503/504 and quota only; no fallback on cancel/auth/rate/no-speech', () => {
  for (const error of [
    new TypeError('offline'),
    new DOMException('timeout', 'TimeoutError'),
    new SpeechFailure(503, 'speech_unavailable'),
    new SpeechFailure(504, 'speech_timeout'),
    new SpeechFailure(429, 'quota_exceeded'),
  ])
    assert.equal(canUseDeviceSpeech(error), true)
  for (const error of [
    new Error('auth'),
    new DOMException('cancel', 'AbortError'),
    new SpeechFailure(401, 'unauthorized'),
    new SpeechFailure(404, 'not_found'),
    new SpeechFailure(429, 'rate_limited'),
    new SpeechFailure(422, 'no_speech'),
  ])
    assert.equal(canUseDeviceSpeech(error), false)
})
test('speech requests use IDs/raw audio, long cancellable timeouts, validated parts and no text upload for narration', async () => {
  const calls = []
  globalThis.__speechFetch = async (path, init) => {
    calls.push([path, init])
    return new Response(new Blob(['ogg']), {
      headers: { 'Content-Type': 'audio/ogg', 'X-Narration-Part': '0', 'X-Narration-Parts': '2' },
    })
  }
  const ctrl = new AbortController(),
    part = await narrationPart('connection', 'letter', 0, ctrl.signal)
  assert.equal(part.total, 2)
  assert.equal(calls[0][0], '/api/connections/connection/messages/letter/narration?part=0')
  assert.equal(calls[0][1].body, undefined)
  ctrl.abort()
  assert.equal(calls[0][1].signal.aborted, true)
  globalThis.__speechFetch = async () =>
    new Response('{}', { status: 429, headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(
    () => transcribe(new Blob(['audio']), new AbortController().signal),
    (e) => e.status === 429,
  )
  await assert.rejects(
    () => transcribe(new Blob([new Uint8Array(3_000_001)]), new AbortController().signal),
    (e) => e.code === 'too_large',
  )
  globalThis.__speechFetch = async (path, init) => {
    assert.equal(path, '/api/transcribe')
    assert.equal(init.body.type, 'audio/webm')
    return Response.json({ text: ' hello ', language: 'en', durationMs: 1000 })
  }
  assert.equal(await transcribe(new Blob(['audio'], { type: 'audio/webm' }), new AbortController().signal), 'hello')
})
