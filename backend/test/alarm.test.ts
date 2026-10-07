import { test } from 'node:test'
import assert from 'node:assert/strict'

// supabaseAdmin throws at import without these; no network call is made.
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 1).toString('base64')

const { evaluateAlarmAck, withAlarmAckLock, ALARM_ACK_WINDOW_MS } = await import('../src/services/messageService.js')
const { alarmFcmData, mediaNoticeFor } = await import('../src/websocket/socketServer.js')

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)
const raise = (over = {}) => ({
  type: 'alarm',
  senderId: 'raiser',
  createdAt: new Date(NOW - 10_000).toISOString(),
  isAck: false,
  ...over,
})
const base = { existingAck: null, now: NOW }

test('plain ack by the other member is accepted', () => {
  assert.deepEqual(evaluateAlarmAck({ ...base, raise: raise(), senderId: 'other', cancelled: false }), { ok: true })
})

test('cancel by the raiser is accepted', () => {
  assert.deepEqual(evaluateAlarmAck({ ...base, raise: raise(), senderId: 'raiser', cancelled: true }), { ok: true })
})

test('cancel by the other member is rejected', () => {
  assert.throws(() => evaluateAlarmAck({ ...base, raise: raise(), senderId: 'other', cancelled: true }), /only the sender/)
})

test('raiser cannot plain-ack their own alarm', () => {
  assert.throws(() => evaluateAlarmAck({ ...base, raise: raise(), senderId: 'raiser', cancelled: false }), /your own/)
})

test('missing raise, non-alarm target, or ack-of-an-ack is rejected', () => {
  assert.throws(() => evaluateAlarmAck({ ...base, raise: null, senderId: 'other', cancelled: false }), /not found/)
  assert.throws(() => evaluateAlarmAck({ ...base, raise: raise({ type: 'text' }), senderId: 'other', cancelled: false }), /not found/)
  assert.throws(() => evaluateAlarmAck({ ...base, raise: raise({ isAck: true }), senderId: 'other', cancelled: false }), /not found/)
})

test('new ack older than 2 minutes is rejected', () => {
  const old = raise({ createdAt: new Date(NOW - ALARM_ACK_WINDOW_MS - 1).toISOString() })
  assert.throws(() => evaluateAlarmAck({ ...base, raise: old, senderId: 'other', cancelled: false }), /expired/)
})

test('repeat returns the existing ack, even past the window', () => {
  const old = raise({ createdAt: new Date(NOW - ALARM_ACK_WINDOW_MS * 5).toISOString() })
  const existing = { id: 'ack1' }
  assert.deepEqual(
    evaluateAlarmAck({ raise: old, existingAck: existing, senderId: 'raiser', cancelled: true, now: NOW }),
    { existing },
  )
})

test('repeat by the wrong party is still rejected (ownership beats idempotency)', () => {
  assert.throws(
    () => evaluateAlarmAck({ raise: raise(), existingAck: { id: 'a' }, senderId: 'other', cancelled: true, now: NOW }),
    /only the sender/,
  )
})

test('alarm lock serialises concurrent acks for one raise', async () => {
  const order: string[] = []
  const slow = withAlarmAckLock('r1', async () => {
    order.push('a-start')
    await new Promise((r) => setTimeout(r, 20))
    order.push('a-end')
  })
  const fast = withAlarmAckLock('r1', async () => {
    order.push('b')
  })
  await Promise.all([slow, fast])
  assert.deepEqual(order, ['a-start', 'a-end', 'b'])
})

const msg = (payload: unknown) => ({ id: 'ack-msg-id', type: 'alarm', content: '', payload }) as never

test('FCM data for ack/cancel carries the RAISE id as alarmId', () => {
  assert.deepEqual(alarmFcmData(msg({ ack: 'raise-1' })), {
    type: 'alarm', ack: 'true', cancelled: 'false', alarmId: 'raise-1',
  })
  assert.deepEqual(alarmFcmData(msg({ ack: 'raise-1', cancelled: true })), {
    type: 'alarm', ack: 'true', cancelled: 'true', alarmId: 'raise-1',
  })
  assert.equal(alarmFcmData({ ...(msg(null) as object), id: 'raise-9' } as never).alarmId, 'raise-9')
})

test('push body for cancel/ack does not read like a new alarm', () => {
  assert.match(mediaNoticeFor(msg(null)), /emergency alarm/)
  const cancel = mediaNoticeFor(msg({ ack: 'r', cancelled: true }))
  const ackBody = mediaNoticeFor(msg({ ack: 'r' }))
  assert.doesNotMatch(cancel, /emergency|🚨|sent/)
  assert.match(cancel, /cancelled/)
  assert.doesNotMatch(ackBody, /emergency|🚨|sent/)
})
