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
      assert.ok((await call.inviteCall(io, conn(cid), A, kind)).callId, 'the connection is free for a new call')
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
