import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { Server } from 'socket.io'
import { registerPresence, type PresenceUpdate } from '../src/websocket/presence.js'

const { io: connect } = createRequire(new URL('../../client/package.json', import.meta.url))('socket.io-client')
const connection = { id: 'pair', user_a_id: 'alice', user_b_id: 'bob', status: 'active', created_at: '' }
const waitFor = async (ready: () => boolean) => {
  for (let i = 0; i < 300; i++) { if (ready()) return; await delay(10) }
  assert.fail('Timed out waiting for socket event')
}

async function setup(t: TestContext) {
  const http = createServer()
  const io = new Server(http)
  io.use((socket, next) => { socket.data.userId = socket.handshake.auth.userId; next() })
  registerPresence(io, async (userId) => ['alice', 'bob'].includes(userId) ? connection : null)
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const address = http.address() as { port: number }
  const clients: ReturnType<typeof connect>[] = []
  t.after(async () => {
    for (const client of clients) client.disconnect()
    await new Promise<void>((resolve) => io.close(() => resolve()))
  })
  return async (userId: string) => {
    const client = connect(`http://127.0.0.1:${address.port}`, { auth: { userId }, autoConnect: false, reconnection: false })
    clients.push(client)
    const events: PresenceUpdate[] = []
    client.on('presence', (update: PresenceUpdate) => events.push(update))
    client.connect()
    await waitFor(() => client.connected)
    if (userId !== 'outsider') await waitFor(() => events.length > 0)
    return { client, events }
  }
}

test('multiple sockets stay online until the last active socket disconnects', async (t) => {
  const join = await setup(t)
  const alice = await join('alice'), second = await join('alice'), bob = await join('bob')
  alice.client.emit('presence', { active: true })
  await waitFor(() => bob.events.some((event) => event.online))
  const secondReplies = second.events.length
  second.client.emit('presence', { active: true })
  await waitFor(() => second.events.length > secondReplies)
  alice.client.emit('presence', { active: false })
  bob.client.emit('presence', { active: false })
  await waitFor(() => bob.events.length >= 3)
  assert.equal(bob.events.at(-1)?.online, true)
  second.client.disconnect()
  await waitFor(() => bob.events.at(-1)?.online === false)
  assert.ok(Number.isFinite(Date.parse(bob.events.at(-1)!.lastSeenAt!)))
})

test('a newly connected partner receives the current state and own sockets receive no own broadcast', async (t) => {
  const join = await setup(t)
  const alice = await join('alice'), second = await join('alice')
  const replies = alice.events.length
  alice.client.emit('presence', { active: true })
  await waitFor(() => alice.events.length > replies)
  const bob = await join('bob')
  assert.deepEqual(bob.events.at(-1), { userId: 'alice', online: true, lastSeenAt: null })
  assert.ok(second.events.every((event) => event.userId === 'bob'))
})

test('duplicate active state is not broadcast again; inactive state immediately wins', async (t) => {
  const join = await setup(t)
  const alice = await join('alice'), bob = await join('bob')
  alice.client.emit('presence', { active: true })
  await waitFor(() => bob.events.at(-1)?.online === true)
  const count = bob.events.length, replies = alice.events.length
  alice.client.emit('presence', { active: true })
  await waitFor(() => alice.events.length > replies)
  assert.equal(bob.events.length, count)
  alice.client.emit('presence', { active: false })
  await waitFor(() => bob.events.at(-1)?.online === false)
})

test('invalid payloads and nonmembers cannot change or receive connection presence', async (t) => {
  const join = await setup(t)
  const alice = await join('alice'), bob = await join('bob'), outsider = await join('outsider')
  for (const payload of [null, {}, { active: 'true' }, { active: 1 }]) alice.client.emit('presence', payload)
  outsider.client.emit('presence', { active: true, userId: 'alice', connectionId: 'pair' })
  const count = bob.events.length
  bob.client.emit('presence', { active: false })
  await waitFor(() => bob.events.length > count)
  assert.equal(bob.events.at(-1)?.online, false)
  assert.equal(outsider.events.length, 0)
})

test('presence has a separate 20-event rate limit', async (t) => {
  const join = await setup(t)
  const alice = await join('alice'), bob = await join('bob')
  const count = bob.events.length
  for (let i = 0; i < 21; i++) alice.client.emit('presence', { active: i % 2 === 0 })
  await waitFor(() => bob.events.length >= count + 20)
  assert.equal(bob.events.length, count + 20)
  assert.equal(bob.events.at(-1)?.online, false)
})
