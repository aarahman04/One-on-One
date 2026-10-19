import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 1).toString('base64')

const { default: express } = await import('express')
const { supabaseAdmin } = await import('../src/database/supabaseAdmin.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const { meRouter } = await import('../src/routes/me.js')
const { connectionsRouter } = await import('../src/routes/connections.js')
const { messagesRouter } = await import('../src/routes/messages.js')
const { attachmentsRouter } = await import('../src/routes/attachments.js')
const { ConnectionError, sweepEndedConnections } = await import('../src/services/connectionService.js')
const { deleteConnectionAttachments } = await import('../src/services/attachmentService.js')
const { createSocketServer } = await import('../src/websocket/socketServer.js')
const { gamePayload } = await import('../src/websocket/games.js')
const { encrypt } = await import('../src/services/crypto.js')

const { io: connect } = createRequire(new URL('../../client/package.json', import.meta.url))('socket.io-client')

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const D = '00000000-0000-4000-8000-00000000000d'
const CONN = '11111111-1111-4111-8111-111111111111'
const DAY = 24 * 60 * 60 * 1000
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString()
const waitFor = async (ready: () => boolean) => {
  for (let i = 0; i < 300; i++) {
    if (ready()) return
    await delay(10)
  }
  assert.fail('timed out')
}

function seed() {
  const db = installFakeSupabase(supabaseAdmin)
  db.tables.users = [A, B, C, D].map((id, i) => ({
    id,
    auth_user_id: `auth-${i}`,
    connection_code: `CODE000${i}`,
    age_verified_at: null,
    terms_accepted_at: null,
  }))
  ;[A, B, C, D].forEach((_, i) => db.authUsers.set(`tok-${i}`, `auth-${i}`))
  return db
}
const tokenOf = (id: string) => `tok-${[A, B, C, D].indexOf(id)}`

function addConnection(db: ReturnType<typeof seed>, id: string, status: string, extra: object = {}) {
  ;(db.tables.connections ??= []).push({
    id, user_a_id: A, user_b_id: B, status, created_at: iso(DAY), updated_at: iso(DAY),
    wallpaper: 'off', message_style: 'bubbles', ended_at: null, ended_by: null, ...extra,
  })
  ;(db.tables.connection_members ??= []).push(
    { connection_id: id, user_id: A, nickname: 'Bee', leave_step: 0, leave_last_step_at: null },
    { connection_id: id, user_id: B, nickname: 'Ay', leave_step: 0, leave_last_step_at: null },
  )
  ;(db.tables.messages ??= []).push({
    id: `${id.slice(0, 8)}-0000-4000-8000-000000000001`, connection_id: id, sender_id: A,
    content: encrypt('hello'), created_at: iso(DAY / 2), type: 'text', payload: null, reply_to: null,
  })
}

async function server(t: TestContext) {
  const app = express()
  app.use(express.json())
  app.use('/api', meRouter, connectionsRouter, messagesRouter, attachmentsRouter)
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
  const io = createSocketServer(http, ['http://localhost'])
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`
  const clients: ReturnType<typeof connect>[] = []
  t.after(async () => {
    for (const c of clients) c.disconnect()
    await new Promise<void>((resolve) => io.close(() => resolve()))
  })
  const api = async (user: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${tokenOf(user)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  const socket = async (user: string) => {
    const client = connect(base, { auth: { token: tokenOf(user) }, reconnection: false })
    clients.push(client)
    const events: { name: string; data: any }[] = []
    client.onAny((name: string, data: unknown) => events.push({ name, data }))
    await waitFor(() => client.connected)
    await delay(50) // let presence join the room
    const emit = (name: string, data: unknown) =>
      new Promise<any>((resolve) => client.emit(name, data, (res: unknown) => resolve(res)))
    return { client, events, emit }
  }
  return { api, socket }
}

test('gates: strict validation, stamped once, never cleared, returned by /me', async (t) => {
  seed()
  const { api } = await server(t)
  for (const bad of [{}, { ageVerified: false }, { termsAccepted: 'yes' }, { ageVerified: true, extra: true }, []]) {
    assert.equal((await api(A, 'POST', '/me/gates', bad)).status, 400, JSON.stringify(bad))
  }
  const first = await api(A, 'POST', '/me/gates', { ageVerified: true })
  assert.equal(first.status, 200)
  assert.ok(first.body.ageVerifiedAt)
  assert.equal(first.body.termsAcceptedAt, null)
  await delay(5)
  const second = await api(A, 'POST', '/me/gates', { ageVerified: true, termsAccepted: true })
  assert.equal(second.body.ageVerifiedAt, first.body.ageVerifiedAt)
  assert.ok(second.body.termsAcceptedAt)
  const me = await api(A, 'GET', '/me')
  assert.deepEqual(
    [me.body.userId, me.body.ageVerifiedAt, me.body.termsAcceptedAt],
    [A, first.body.ageVerifiedAt, second.body.termsAcceptedAt],
  )
})

test('leave is instant; leaver sees nothing, partner sees ended; old countdown routes are 410', async (t) => {
  const db = seed()
  addConnection(db, CONN, 'active')
  const { api } = await server(t)
  const left = await api(A, 'POST', `/connections/${CONN}/leave`)
  assert.equal(left.status, 200)
  assert.equal(left.body.leave.status, 'ended')
  assert.equal(left.body.leave.terminated, true)
  const row = db.tables.connections.find((r) => r.id === CONN)!
  assert.deepEqual([row.status, row.ended_by], ['ended', A])

  assert.equal((await api(A, 'GET', '/connections/current')).body.connection, null)
  const partner = (await api(B, 'GET', '/connections/current')).body.connection
  assert.equal(partner.status, 'ended')
  assert.equal(partner.endedBy, A)
  assert.equal(partner.otherNickname, 'Bee')
  assert.equal(Date.parse(partner.purgeAt) - Date.parse(partner.endedAt), 7 * DAY)
  assert.equal(partner.myLeaveStep, 0) // 2.0.5 fields still present

  for (const path of ['leave/cancel', 'leave/confirm-end']) {
    const res = await api(B, 'POST', `/connections/${CONN}/${path}`)
    assert.equal(res.status, 410)
    assert.equal(res.body.code, 'leave_steps_removed')
  }
  assert.equal((await api(B, 'POST', `/connections/${CONN}/leave`)).status, 409)
})

test('leaver and partner can both start a new connection at once; partner starting one purges the ended chat', async (t) => {
  const db = seed()
  addConnection(db, CONN, 'active')
  db.storage.set('attachments', new Set([`${CONN}/a.jpg`]))
  const { api } = await server(t)
  await api(A, 'POST', `/connections/${CONN}/leave`)
  assert.equal((await api(A, 'POST', '/connections/request', { connectionCode: 'CODE0002' })).status, 201)
  assert.ok(db.tables.connections.some((r) => r.id === CONN), 'leaver joining does not purge the partner history')
  assert.equal((await api(B, 'POST', '/connections/request', { connectionCode: 'CODE0003' })).status, 201)
  assert.ok(!db.tables.connections.some((r) => r.id === CONN), 'partner starting a connection purges it')
  assert.equal(db.storage.get('attachments')!.size, 0)
})

test('partner keeps read-only history and media; every write is rejected; leaver loses everything', async (t) => {
  const db = seed()
  addConnection(db, CONN, 'active')
  const { api, socket } = await server(t)
  await api(A, 'POST', `/connections/${CONN}/leave`)

  const history = await api(B, 'GET', `/connections/${CONN}/messages`)
  assert.equal(history.status, 200)
  assert.equal(history.body.messages[0].content, 'hello')
  const signed = await api(B, 'POST', `/connections/${CONN}/attachments/signed`, { paths: [`${CONN}/a.jpg`] })
  assert.equal(signed.status, 200)

  assert.equal((await api(A, 'GET', `/connections/${CONN}/messages`)).status, 409)
  assert.equal((await api(A, 'POST', `/connections/${CONN}/attachments/signed`, { paths: [] })).status, 409)
  for (const [method, path, body] of [
    ['POST', 'read'], ['POST', 'delivered'], ['PATCH', 'nickname', { nickname: 'x' }],
    ['PATCH', 'wallpaper', { wallpaper: 'love' }], ['POST', 'block'],
  ] as const) {
    assert.equal((await api(B, method, `/connections/${CONN}/${path}`, body)).status, 409, path)
  }

  const b = await socket(B)
  assert.deepEqual(await b.emit('message:send', { content: 'hi' }), { error: 'no active connection' })
  assert.deepEqual(await b.emit('message:pin', { messageId: null }), { error: 'no active connection' })
  assert.equal((await b.emit('message:read', { connectionId: CONN })).ok, false)
  assert.deepEqual(await b.emit('game:invite', { gameId: 'g1', game: 'chess' }), { ok: false, error: 'connection_inactive' })
})

test('acknowledge-end is partner-only and hard-deletes rows and storage', async (t) => {
  const db = seed()
  addConnection(db, CONN, 'active')
  db.storage.set('attachments', new Set([`${CONN}/a.jpg`, `${CONN}/b.webm`, 'other/c.jpg']))
  const { api } = await server(t)
  assert.equal((await api(B, 'POST', `/connections/${CONN}/acknowledge-end`)).status, 409) // not ended yet
  await api(A, 'POST', `/connections/${CONN}/leave`)
  assert.equal((await api(A, 'POST', `/connections/${CONN}/acknowledge-end`)).status, 403)
  assert.equal((await api(C, 'POST', `/connections/${CONN}/acknowledge-end`)).status, 403)
  assert.equal((await api(B, 'POST', `/connections/${CONN}/acknowledge-end`)).status, 204)
  assert.equal(db.tables.connections.length, 0)
  assert.equal(db.tables.connection_members.length, 0)
  assert.equal(db.tables.messages.length, 0)
  assert.deepEqual([...db.storage.get('attachments')!], ['other/c.jpg'])
  assert.equal((await api(B, 'GET', '/connections/current')).body.connection, null)
})

test('sweeper purges ended connections older than 7 days and keeps newer ones', async () => {
  const db = seed()
  const OLD = '22222222-2222-4222-8222-222222222222'
  addConnection(db, OLD, 'ended', { ended_at: iso(8 * DAY), ended_by: A })
  addConnection(db, CONN, 'ended', { ended_at: iso(DAY), ended_by: A })
  db.storage.set('attachments', new Set([`${OLD}/x.jpg`, `${CONN}/y.jpg`]))
  assert.equal(await sweepEndedConnections(), 1)
  assert.deepEqual(db.tables.connections.map((r) => r.id), [CONN])
  assert.deepEqual([...db.storage.get('attachments')!], [`${CONN}/y.jpg`])
})

test('attachment cleanup pages through more than 1000 objects', async () => {
  const db = seed()
  db.storage.set('attachments', new Set(Array.from({ length: 2500 }, (_, i) => `${CONN}/${String(i).padStart(4, '0')}.jpg`)))
  await deleteConnectionAttachments(CONN)
  assert.equal(db.storage.get('attachments')!.size, 0)
  const lists = db.storageCalls.filter((c) => c.op === 'list').map((c) => (c.arg as { offset: number }).offset)
  assert.deepEqual(lists, [0, 1000, 2000])
  assert.deepEqual(db.storageCalls.filter((c) => c.op === 'remove').map((c) => c.arg), [1000, 1000, 500])
})

test('game payload validation', () => {
  assert.deepEqual(gamePayload('game:invite', { gameId: 'g-1', game: 'pong', extra: 1 }), { gameId: 'g-1', game: 'pong' })
  assert.equal(gamePayload('game:invite', { gameId: 'g-1', game: 'poker' }), null)
  assert.equal(gamePayload('game:accept', { gameId: 'bad id!' }), null)
  assert.equal(gamePayload('game:accept', { gameId: 'x'.repeat(65) }), null)
  assert.deepEqual(gamePayload('game:move', { gameId: 'g', seq: 0, data: { x: 1 } }), { gameId: 'g', seq: 0, data: { x: 1 } })
  assert.equal(gamePayload('game:move', { gameId: 'g', seq: -1, data: 1 }), null)
  assert.equal(gamePayload('game:move', { gameId: 'g', seq: 1.5, data: 1 }), null)
  assert.equal(gamePayload('game:move', { gameId: 'g', seq: 1, data: 'x'.repeat(4100) }), null)
  assert.equal(gamePayload('game:end', { gameId: 'g' }), null)
  assert.equal(gamePayload('game:decline', null), null)
})

test('game relay: partner only, with from; rejects invalid, non-member, inactive, offline; move rate limit', async (t) => {
  const db = seed()
  addConnection(db, CONN, 'active')
  const { socket } = await server(t)
  const a = await socket(A), a2 = await socket(A), b = await socket(B), carol = await socket(C)

  assert.deepEqual(await a.emit('game:invite', { gameId: 'g1', game: 'chess' }), { ok: true })
  await waitFor(() => b.events.some((e) => e.name === 'game:invite'))
  assert.deepEqual(b.events.find((e) => e.name === 'game:invite')!.data, { gameId: 'g1', game: 'chess', from: A })
  assert.ok(![a, a2, carol].some((s) => s.events.some((e) => e.name.startsWith('game:'))))

  assert.deepEqual(await b.emit('game:move', { gameId: 'g1', seq: 0, data: { from: 'e2', to: 'e4' } }), { ok: true })
  assert.deepEqual(await a.emit('game:invite', { gameId: 'g1', game: 'poker' }), { ok: false, error: 'invalid_payload' })
  assert.deepEqual(await a.emit('game:move', { gameId: 'g1', seq: 1, data: 'x'.repeat(5000) }), { ok: false, error: 'invalid_payload' })
  assert.deepEqual(await carol.emit('game:accept', { gameId: 'g1' }), { ok: false, error: 'not_member' })

  const acks = await Promise.all(Array.from({ length: 41 }, (_, i) => a.emit('game:move', { gameId: 'g1', seq: i, data: i })))
  // 41 in the same second plus the oversize move above (which still spent a slot)
  assert.ok(acks.some((r) => r.error === 'rate_limited'))
  assert.ok(acks.filter((r) => r.ok).length >= 38)

  b.client.disconnect()
  await delay(50)
  assert.deepEqual(await a.emit('game:end', { gameId: 'g1', reason: 'quit' }), { ok: false, error: 'partner_offline' })

  db.tables.connections[0].status = 'ended'
  assert.deepEqual(await a2.emit('game:decline', { gameId: 'g1' }), { ok: false, error: 'connection_inactive' })
})

test('message:read socket event and POST /delivered emit receipt:update to the other member', async (t) => {
  const db = seed()
  addConnection(db, CONN, 'active')
  const { api, socket } = await server(t)
  const a = await socket(A), b = await socket(B)
  const receipts = (s: typeof b, key: string) => s.events.filter((e) => e.name === 'receipt:update' && key in e.data)

  b.events.length = 0
  assert.deepEqual(await a.emit('message:read', { connectionId: CONN }), { ok: true })
  await waitFor(() => receipts(b, 'lastReadAt').length > 0)
  const read = receipts(b, 'lastReadAt')[0].data
  assert.equal(read.userId, A)
  assert.equal(db.tables.connection_members.find((m) => m.user_id === A)!.last_read_at, read.lastReadAt)
  assert.equal(receipts(a, 'lastReadAt').length, 0)

  assert.equal((await api(A, 'POST', `/connections/${CONN}/delivered`)).status, 204)
  await waitFor(() => receipts(b, 'lastDeliveredAt').some((e) => e.data.userId === A))
  assert.equal((await api(C, 'POST', `/connections/${CONN}/delivered`)).status, 403)
  assert.deepEqual(await a.emit('message:read', {}), { ok: false, error: 'connectionId is required' })
})
