import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 1).toString('base64')

const { supabaseAdmin } = await import('../src/database/supabaseAdmin.js')
const { installFakeSupabase } = await import('./fakeSupabase.js')
const call = await import('../src/services/callService.js')

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const conn = (id: string) => ({ id, user_a_id: A, user_b_id: B, status: 'active', created_at: new Date().toISOString() })
const flush = () => new Promise((resolve) => setImmediate(resolve))

// Fake io whose room holds `online` (userIds); records every emit.
function fakeIo(online: Set<string>) {
  const emitted: Array<[string, any]> = []
  const io: any = {
    in: () => ({ fetchSockets: async () => [...online].map((userId) => ({ data: { userId }, emit: () => {} })) }),
    to: () => ({ emit: (event: string, payload: any) => emitted.push([event, payload]) }),
  }
  return { io, emitted }
}

for (const kind of ['audio', 'video'] as const) {
  test(`a ${kind} call whose participant vanishes is completed after the grace period`, async () => {
    const db = installFakeSupabase(supabaseAdmin)
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const online = new Set([A, B])
      const { io, emitted } = fakeIo(online)
      const cid = `conn-${kind}-1`
      const { callId } = await call.inviteCall(io, conn(cid), A, kind)
      call.acceptCall(io, cid, callId, B)

      online.delete(A)
      await call.callSocketGone(io, cid, A)
      mock.timers.tick(call.CALL_DISCONNECT_GRACE_MS - 1)
      await flush()
      assert.equal(emitted.filter(([e]) => e === 'call:ended').length, 0)

      mock.timers.tick(1)
      await flush(); await flush()
      assert.deepEqual(emitted.find(([e]) => e === 'call:ended')?.[1], { callId, reason: 'completed' })
      assert.equal((db.tables.messages ?? []).filter((m: any) => m.type === 'call').length, 1, 'the call card is written')
      const next = await call.inviteCall(io, conn(cid), A, kind)
      assert.ok(next.callId, 'the connection is free for a new call')
      call.endCall(io, cid, next.callId, A)
    } finally { mock.timers.reset() }
  })
}

test('reconnecting within the grace period keeps the call', async () => {
  installFakeSupabase(supabaseAdmin)
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const online = new Set([A, B])
    const { io, emitted } = fakeIo(online)
    const { callId } = await call.inviteCall(io, conn('conn-2'), A, 'video')
    call.acceptCall(io, 'conn-2', callId, B)
    online.delete(B)
    await call.callSocketGone(io, 'conn-2', B)
    online.add(B)
    call.callSocketBack('conn-2', B)
    mock.timers.tick(call.CALL_DISCONNECT_GRACE_MS * 2)
    await flush(); await flush()
    assert.equal(emitted.filter(([e]) => e === 'call:ended').length, 0)
    call.endCall(io, 'conn-2', callId, A)
  } finally { mock.timers.reset() }
})

test('a caller who vanishes while ringing cancels; a ringing callee is left to the ring timeout', async () => {
  installFakeSupabase(supabaseAdmin)
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const online = new Set([A, B])
    const { io, emitted } = fakeIo(online)
    const first = await call.inviteCall(io, conn('conn-3'), A, 'audio')
    online.delete(B)
    await call.callSocketGone(io, 'conn-3', B)
    mock.timers.tick(call.CALL_DISCONNECT_GRACE_MS + 1)
    await flush(); await flush()
    assert.equal(emitted.filter(([e]) => e === 'call:ended').length, 0, 'callee offline: still ringing')
    mock.timers.tick(60_000) // the ring timeout (45 s) ends it, as before
    await flush(); await flush()
    assert.deepEqual(emitted.find(([e]) => e === 'call:ended')?.[1], { callId: first.callId, reason: 'missed' })

    online.add(B)
    const second = await call.inviteCall(io, conn('conn-4'), A, 'audio')
    online.delete(A)
    await call.callSocketGone(io, 'conn-4', A)
    mock.timers.tick(call.CALL_DISCONNECT_GRACE_MS)
    await flush(); await flush()
    assert.deepEqual(emitted.filter(([e]) => e === 'call:ended').at(-1)?.[1], { callId: second.callId, reason: 'cancelled' })
  } finally { mock.timers.reset() }
})

test('another socket keeps the participant online; a later last-socket disconnect still ends the call', async () => {
  const db = installFakeSupabase(supabaseAdmin)
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const online = new Set([A, B])
    const { io, emitted } = fakeIo(online)
    const cid = 'conn-multiple'
    const { callId } = await call.inviteCall(io, conn(cid), A, 'video')
    call.acceptCall(io, cid, callId, B)
    await call.callSocketGone(io, cid, A)
    mock.timers.tick(call.CALL_DISCONNECT_GRACE_MS)
    await flush()
    assert.equal(emitted.filter(([event]) => event === 'call:ended').length, 0)

    online.delete(A)
    await call.callSocketGone(io, cid, A)
    // The room check at expiry also protects a reconnection whose callback was delayed.
    online.add(A)
    mock.timers.tick(call.CALL_DISCONNECT_GRACE_MS)
    await flush()
    online.delete(A)
    await call.callSocketGone(io, cid, A)
    mock.timers.tick(call.CALL_DISCONNECT_GRACE_MS)
    await flush()
    assert.equal(emitted.filter(([event]) => event === 'call:ended').length, 1)
    assert.equal(db.tables.messages.length, 1)
  } finally { mock.timers.reset() }
})

test('a reconnect during an expiry lookup cannot end a new disconnect grace period', async () => {
  installFakeSupabase(supabaseAdmin)
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const online = new Set([A, B])
    const { io, emitted } = fakeIo(online)
    const cid = 'conn-expiry-race'
    const { callId } = await call.inviteCall(io, conn(cid), A, 'video')
    call.acceptCall(io, cid, callId, B)
    online.delete(A)
    await call.callSocketGone(io, cid, A)
    const inRoom = io.in
    let finishLookup!: (sockets: unknown[]) => void
    io.in = () => ({ fetchSockets: () => new Promise((resolve) => { finishLookup = resolve }) })
    mock.timers.tick(call.CALL_DISCONNECT_GRACE_MS)
    call.callSocketBack(cid, A)
    io.in = inRoom
    await call.callSocketGone(io, cid, A)
    finishLookup([])
    await flush()
    mock.timers.tick(call.CALL_DISCONNECT_GRACE_MS - 1)
    await flush()
    assert.equal(emitted.filter(([event]) => event === 'call:ended').length, 0)
    mock.timers.tick(1)
    await flush()
    assert.equal(emitted.filter(([event]) => event === 'call:ended').length, 1)
  } finally { mock.timers.reset() }
})

test('concurrent disconnects and an explicit hangup write exactly one call card', async () => {
  const db = installFakeSupabase(supabaseAdmin)
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const online = new Set([A, B])
    const { io, emitted } = fakeIo(online)
    const cid = 'conn-both-gone'
    const { callId } = await call.inviteCall(io, conn(cid), A, 'video')
    call.acceptCall(io, cid, callId, B)
    online.clear()
    await Promise.all([call.callSocketGone(io, cid, A), call.callSocketGone(io, cid, A), call.callSocketGone(io, cid, B)])
    mock.timers.tick(call.CALL_DISCONNECT_GRACE_MS)
    await flush()
    call.endCall(io, cid, callId, A)
    assert.equal(emitted.filter(([event]) => event === 'call:ended').length, 1)
    assert.equal(db.tables.messages.length, 1)
  } finally { mock.timers.reset() }
})

test('a retried accept preserves the original call duration', async () => {
  installFakeSupabase(supabaseAdmin)
  let now = 1000
  const clock = mock.method(Date, 'now', () => now)
  const { io, emitted } = fakeIo(new Set([A, B]))
  const cid = 'conn-accept-retry'
  const { callId } = await call.inviteCall(io, conn(cid), A, 'video')
  try {
    call.acceptCall(io, cid, callId, B)
    now = 16_000
    call.acceptCall(io, cid, callId, B)
    now = 21_000
    call.endCall(io, cid, callId, A)
    await flush()
    assert.equal(emitted.filter(([event]) => event === 'call:accepted').length, 1)
    assert.deepEqual(emitted.find(([event]) => event === 'message:new')?.[1].payload, { kind: 'video', outcome: 'completed', durationSec: 20 })
  } finally {
    call.endCall(io, cid, callId, A)
    clock.mock.restore()
  }
})

test('a callee who disconnects while accept is in flight still gets a grace timer', async () => {
  const db = installFakeSupabase(supabaseAdmin)
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const online = new Set([A, B])
    const { io, emitted } = fakeIo(online)
    const cid = 'conn-accept-disconnect'
    const { callId } = await call.inviteCall(io, conn(cid), A, 'video')
    online.delete(B)
    await call.callSocketGone(io, cid, B) // still ringing: no grace yet
    call.acceptCall(io, cid, callId, B)
    await flush()
    mock.timers.tick(call.CALL_DISCONNECT_GRACE_MS)
    await flush()
    assert.equal(emitted.filter(([event]) => event === 'call:ended').length, 1)
    assert.equal(db.tables.messages.length, 1)
  } finally { mock.timers.reset() }
})
