import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'

process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 1).toString('base64')

const { default: express } = await import('express')
const { supabaseAdmin } = await import('../src/database/supabaseAdmin.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { speechRouter } = await import('../src/routes/speech.js')
const { ConnectionError } = await import('../src/utils/connectionError.js')
const { encrypt } = await import('../src/services/crypto.js')
const { splitNarration, narrationParagraphs, NARRATION_PART_CHARS, NARRATION_FIRST_PART_CHARS } = await import('../src/services/speechService.js')

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const D = '00000000-0000-4000-8000-00000000000d'
const USERS = [A, B, C, D]
const CONN = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const LETTER = '33333333-3333-4333-8333-333333333331'
const TEXT = '33333333-3333-4333-8333-333333333332'
const DELETED = '33333333-3333-4333-8333-333333333333'
const OTHER_LETTER = '33333333-3333-4333-8333-333333333334'
const BODY = `I have been meaning to write this for a while.\n\n${'The days are long and bright here. '.repeat(20)}\nSee you soon!`

function letterRow(id: string, connectionId: string, extra: object = {}) {
  return {
    id, connection_id: connectionId, sender_id: A, created_at: new Date().toISOString(), type: 'letter',
    content: encrypt(BODY), payload: { enc: encrypt(JSON.stringify({ appearance: 'dawn', from: 'Ay', to: 'Bee' })) },
    reply_to: null, deleted_at: null, ...extra,
  }
}

function seed() {
  const db = installFakeSupabase(supabaseAdmin)
  db.tables.users = USERS.map((id, i) => ({ id, auth_user_id: `auth-${i}`, connection_code: `CODE000${i}` }))
  USERS.forEach((_, i) => db.authUsers.set(`tok-${i}`, `auth-${i}`))
  const conn = (id: string, a: string, b: string) => ({
    id, user_a_id: a, user_b_id: b, status: 'active', created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), ended_at: null, ended_by: null,
  })
  db.tables.connections = [conn(CONN, A, B), conn(OTHER, C, D)]
  db.tables.messages = [
    letterRow(LETTER, CONN),
    { ...letterRow(TEXT, CONN), type: 'text', payload: null },
    letterRow(DELETED, CONN, { deleted_at: new Date().toISOString(), content: encrypt(''), payload: null }),
    letterRow(OTHER_LETTER, OTHER),
  ]
  return db
}

interface StubCall { path: string; headers: IncomingMessage['headers']; body: Buffer }

// Local stand-in for the Python speech service.
async function stub(t: TestContext, reply: (call: StubCall) => { status: number; type: string; body: string | Buffer; headers?: Record<string, string> }) {
  const calls: StubCall[] = []
  const http = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const call = { path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) }
      calls.push(call)
      const r = reply(call)
      res.writeHead(r.status, { 'Content-Type': r.type, ...r.headers }).end(r.body)
    })
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  process.env.SPEECH_SERVICE_URL = `http://127.0.0.1:${(http.address() as { port: number }).port}`
  process.env.SPEECH_SERVICE_TOKEN = 'svc-token'
  t.after(() => {
    http.close()
    delete process.env.SPEECH_SERVICE_URL
    delete process.env.SPEECH_SERVICE_TOKEN
  })
  return calls
}

async function server(t: TestContext) {
  const app = express()
  app.use(express.json())
  app.use('/api', speechRouter)
  // Same mapping as src/index.ts.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ConnectionError) {
      res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'internal server error' })
  })
  const http = createServer(app)
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  t.after(() => http.close())
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}/api`
  const auth = (user: string) => ({ Authorization: `Bearer tok-${USERS.indexOf(user)}` })
  return {
    narrate: (user: string, conn: string, msg: string, part?: string) =>
      fetch(`${base}/connections/${conn}/messages/${msg}/narration${part === undefined ? '' : `?part=${part}`}`, { headers: auth(user) }),
    transcribe: (user: string, type: string, body: Buffer) =>
      fetch(`${base}/transcribe`, { method: 'POST', headers: { ...auth(user), 'Content-Type': type }, body: new Uint8Array(body) }),
  }
}

const ogg = { status: 200, type: 'audio/ogg', body: Buffer.from('OggS-fake-audio') }

test('splitNarration: deterministic, bounded, lossless, paragraph-aware', () => {
  const paragraphs = narrationParagraphs({ from: ' Ay ', to: 'Bee', body: `${BODY}\n\n${'x'.repeat(900)}` })
  assert.equal(paragraphs[0], 'Dear Bee.')
  assert.equal(paragraphs.at(-1), 'With love, Ay.')
  const parts = splitNarration(paragraphs)
  assert.deepEqual(splitNarration(paragraphs), parts)
  assert.ok(parts.length > 3)
  for (const p of parts) assert.ok(p.length > 0 && p.length <= NARRATION_PART_CHARS, `${p.length}`)
  // Same words in the same order, so no word was split or lost (only the 900-char
  // word is cut, because it can't fit; collapse it before comparing).
  const words = (s: string) => s.split(/\s+/).filter(Boolean).join(' ')
  assert.equal(words(parts.join(' ')).replace(/x(?: *x)*/g, 'x'), words(paragraphs.join(' ')).replace(/x(?: *x)*/g, 'x'))
  assert.ok(parts[0].startsWith('Dear Bee.\n\nI have been meaning'))
  // Part 0 is short so the first audio arrives fast; the rest use the full size.
  assert.ok(parts[0].length <= NARRATION_FIRST_PART_CHARS, `${parts[0].length}`)
  assert.ok(parts[1].length > NARRATION_FIRST_PART_CHARS)
  // A first sentence longer than the part-0 room is cut between words, losslessly.
  const long = splitNarration(narrationParagraphs({ from: 'A', to: 'B', body: `${'word '.repeat(60)}end. Next.` }))
  assert.ok(long[0].startsWith('Dear B.\n\nword word') && long[0].length <= NARRATION_FIRST_PART_CHARS, long[0])
  assert.equal(words(long.join(' ')), words(`Dear B. ${'word '.repeat(60)}end. Next. With love, A.`))
  // A short letter is one part.
  assert.deepEqual(splitNarration(narrationParagraphs({ from: 'A', to: 'B', body: 'Hi.\nBye.' })), ['Dear B.\n\nHi.\n\nBye.\n\nWith love, A.'])
})

test('narration: member gets DB text as ogg parts with headers', async (t) => {
  seed()
  const calls = await stub(t, () => ogg)
  const api = await server(t)
  const expected = splitNarration(narrationParagraphs({ from: 'Ay', to: 'Bee', body: BODY }))
  const res = await api.narrate(B, CONN, LETTER)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'audio/ogg')
  assert.equal(res.headers.get('access-control-expose-headers'), 'X-Narration-Part, X-Narration-Parts')
  assert.equal(res.headers.get('x-narration-part'), '0')
  assert.equal(res.headers.get('x-narration-parts'), String(expected.length))
  assert.equal(res.headers.get('cache-control'), 'private, no-store')
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'OggS-fake-audio')
  assert.equal(calls[0].path, '/tts')
  assert.equal(calls[0].headers['x-speech-token'], 'svc-token')
  assert.deepEqual(JSON.parse(calls[0].body.toString()), { text: expected[0], voice: 'af_heart', speed: 1 })

  const last = await api.narrate(A, CONN, LETTER, String(expected.length - 1))
  assert.equal(last.status, 200)
  assert.equal(JSON.parse(calls[1].body.toString()).text, expected.at(-1))
})

test('narration: every unauthorized case is the same 404 not_found', async (t) => {
  seed()
  const calls = await stub(t, () => ogg)
  const api = await server(t)
  const cases: [string, string, string, string?][] = [
    [C, CONN, LETTER], // not a member
    [A, CONN, OTHER_LETTER], // message of another connection
    [A, OTHER, OTHER_LETTER], // connection A isn't in
    [A, CONN, TEXT], // not a letter
    [A, CONN, DELETED], // deleted
    [A, CONN, 'not-a-uuid'],
    [A, 'not-a-uuid', LETTER],
    [A, CONN, LETTER, '99'], // out of range
    [A, CONN, LETTER, '-1'],
    [A, CONN, LETTER, 'abc'],
  ]
  for (const [user, conn, msg, part] of cases) {
    const res = await api.narrate(user, conn, msg, part)
    assert.equal(res.status, 404, `${user} ${conn} ${msg} ${part}`)
    assert.equal((await res.json()).code, 'not_found')
  }
  assert.equal(calls.length, 0)
})

test('narration: ended partner keeps access in the window, leaver does not', async (t) => {
  const db = seed()
  Object.assign(db.tables.connections[0], { status: 'ended', ended_by: A, ended_at: new Date().toISOString() })
  await stub(t, () => ogg)
  const api = await server(t)
  assert.equal((await api.narrate(B, CONN, LETTER)).status, 200)
  assert.equal((await api.narrate(A, CONN, LETTER)).status, 404)
})

test('speech unavailable / failing service map to 503 speech_unavailable / 504 speech_timeout', async (t) => {
  seed()
  const api = await server(t)
  delete process.env.SPEECH_SERVICE_URL
  const unset = await api.narrate(A, CONN, LETTER)
  assert.equal(unset.status, 503)
  assert.equal((await unset.json()).code, 'speech_unavailable')
  const unsetStt = await api.transcribe(A, 'audio/mp4', Buffer.from('audio'))
  assert.equal((await unsetStt.json()).code, 'speech_unavailable')

  let status = 500
  await stub(t, () => ({ status, type: 'application/json', body: '{}' }))
  assert.equal((await (await api.narrate(A, CONN, LETTER)).json()).code, 'speech_unavailable')
  status = 504
  const timeout = await api.narrate(A, CONN, LETTER)
  assert.equal(timeout.status, 504)
  assert.equal((await timeout.json()).code, 'speech_timeout')

  process.env.SPEECH_SERVICE_URL = 'http://127.0.0.1:1' // nothing listens
  assert.equal((await api.narrate(A, CONN, LETTER)).status, 503)
})

test('transcribe: type, size, no_speech, success, live connection', async (t) => {
  const db = seed()
  let text = 'hello there'
  const calls = await stub(t, () => ({ status: 200, type: 'application/json', body: JSON.stringify({ text, language: '', durationMs: 1200 }) }))
  const api = await server(t)

  const bad = await api.transcribe(A, 'video/mp4', Buffer.from('x'))
  assert.equal(bad.status, 415)
  assert.equal((await bad.json()).code, 'unsupported_audio')

  const big = await api.transcribe(A, 'audio/mp4', Buffer.alloc(3 * 1024 * 1024 + 1))
  assert.equal(big.status, 413)
  assert.equal((await big.json()).code, 'too_large')

  const ok = await api.transcribe(A, 'audio/mp4; codecs=mp4a.40.2', Buffer.from('m4a-bytes'))
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { text: 'hello there', language: '', durationMs: 1200 })
  assert.equal(calls[0].path, '/stt')
  assert.equal(calls[0].headers['content-type'], 'audio/mp4')
  assert.equal(calls[0].body.toString(), 'm4a-bytes')

  text = '  '
  const silent = await api.transcribe(A, 'audio/wav', Buffer.from('wav'))
  assert.equal(silent.status, 422)
  assert.equal((await silent.json()).code, 'no_speech')

  db.tables.connections[0].status = 'ended'
  assert.equal((await api.transcribe(A, 'audio/wav', Buffer.from('wav'))).status, 409)
  assert.equal(calls.length, 2)
})

test('transcribe and narration are rate limited per user', async (t) => {
  seed()
  await stub(t, () => ({ status: 200, type: 'application/json', body: JSON.stringify({ text: 'hi', language: '', durationMs: 1 }) }))
  const api = await server(t)
  const statuses = []
  for (let i = 0; i < 11; i++) statuses.push((await api.transcribe(D, 'audio/ogg', Buffer.from('o'))).status)
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200))
  const limited = await api.transcribe(D, 'audio/ogg', Buffer.from('o'))
  assert.equal(limited.status, 429)
  assert.equal((await limited.json()).code, 'rate_limited')
  // Another user is unaffected.
  assert.equal((await api.transcribe(C, 'audio/ogg', Buffer.from('o'))).status, 200)

  let last = 0
  for (let i = 0; i < 31; i++) last = (await api.narrate(C, OTHER, OTHER_LETTER, '999')).status
  assert.equal(last, 429)
})

test('a sleeping speech service is woken: 502 and 503 loading are retried, other 503s are not', async (t) => {
  seed()
  process.env.SPEECH_WAKE_RETRY_MS = '10'
  t.after(() => { delete process.env.SPEECH_WAKE_RETRY_MS })
  const replies = [
    { status: 502, type: 'text/plain', body: 'waking' },
    { status: 503, type: 'application/json', body: '{"code":"not_ready"}', headers: { 'X-Speech-State': 'loading' } },
    { status: 200, type: 'application/json', body: JSON.stringify({ text: 'awake', language: '', durationMs: 900 }) },
  ]
  const calls = await stub(t, () => replies.shift() ?? { status: 503, type: 'application/json', body: '{"code":"busy"}' })
  const api = await server(t)
  const woke = await api.transcribe(B, 'audio/ogg', Buffer.from('o'))
  assert.equal(woke.status, 200)
  assert.equal((await woke.json()).text, 'awake')
  assert.equal(calls.length, 3)
  assert.ok(calls.every((c) => c.body.toString() === 'o')) // the same body is resent
  // A busy service is not a sleeping one: answered at once.
  assert.equal((await api.transcribe(B, 'audio/ogg', Buffer.from('o'))).status, 503)
  assert.equal(calls.length, 4)
})
