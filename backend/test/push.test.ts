import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 1).toString('base64')

const { buildFcmMessage, PUSH_PLATFORMS } = await import('../src/services/pushService.js')
const { nativeMessageData } = await import('../src/websocket/socketServer.js')

const msg = (over: object) =>
  ({ id: 'm1', senderId: 's', content: 'hello there', createdAt: '2026-01-01T00:00:00Z', type: 'text', payload: null, replyTo: null, reactions: [], ...over }) as never

test('platform enum', () => {
  assert.deepEqual([...PUSH_PLATFORMS], ['android', 'android-native'])
})

test('native text message: data-only, high priority, full schema', () => {
  const native = nativeMessageData(msg({}), 'c1', 'Mo', false)
  assert.deepEqual(native, {
    type: 'text', messageId: 'm1', connectionId: 'c1', senderName: 'Mo', preview: 'hello there', urgent: 'false',
  })
  const out = buildFcmMessage('tok', 'android-native', { title: 'Mo', body: 'hello there', native }) as Record<string, any>
  assert.equal(out.notification, undefined)
  assert.equal(out.android.priority, 'high')
  assert.equal(out.android.ttl, undefined)
  assert.deepEqual(out.data, native)
  assert.ok(Object.values(out.data).every((v) => typeof v === 'string'))
})

test('native preview matches the push body for media types and never leaks location', () => {
  assert.equal(nativeMessageData(msg({ type: 'image' }), 'c', '', false).preview, 'sent you a photo')
  assert.equal(nativeMessageData(msg({ type: 'location', content: '1,2' }), 'c', '', false).preview, 'shared their location')
})

test('native alarm: carries raise id, ack, cancelled; plain ack stays high', () => {
  const raise = nativeMessageData(msg({ type: 'alarm', content: '' }), 'c1', 'Mo', true)
  assert.equal(raise.alarmId, 'm1')
  assert.equal(raise.ack, 'false')
  const cancel = nativeMessageData(msg({ id: 'm2', type: 'alarm', content: '', payload: { ack: 'm1', cancelled: true } }), 'c1', 'Mo', true)
  assert.equal(cancel.alarmId, 'm1')
  assert.equal(cancel.cancelled, 'true')
  const plainAck = nativeMessageData(msg({ id: 'm3', type: 'alarm', content: '', payload: { ack: 'm1' } }), 'c1', 'Mo', true)
  const out = buildFcmMessage('t', 'android-native', { title: '', body: '', urgent: true, native: plainAck, nativeTtl: '120s' }) as Record<string, any>
  assert.equal(out.android.priority, 'high')
  assert.equal(out.android.ttl, '120s')
})

test('legacy android token keeps today\'s payloads (notification block; plain ack normal)', () => {
  const text = buildFcmMessage('t', 'android', { title: 'Mo', body: 'hi', native: { type: 'text' } }) as Record<string, any>
  assert.deepEqual(text.notification, { title: 'Mo', body: 'hi' })
  assert.equal(text.android.priority, 'high')
  assert.equal(text.android.notification.channel_id, 'messages')
  assert.deepEqual(text.data, { urgent: 'false' })
  const ack = buildFcmMessage('t', 'android', {
    title: '', body: '', urgent: true, data: { type: 'alarm', ack: 'true', cancelled: 'false', alarmId: 'm1' },
  }) as Record<string, any>
  assert.equal(ack.notification, undefined)
  assert.equal(ack.android.priority, 'normal')
  assert.equal(ack.android.ttl, '120s')
})

test('native token with no native data (e.g. missed-call text push) falls back to notification shape', () => {
  const out = buildFcmMessage('t', 'android-native', { title: 'Mo', body: 'Missed voice call' }) as Record<string, any>
  assert.deepEqual(out.notification, { title: 'Mo', body: 'Missed voice call' })
})

test('call pushes: data-only, high priority, 30s ttl', () => {
  const call = buildFcmMessage('t', 'android-native', {
    title: '', body: '', native: { type: 'call', callId: 'k1', kind: 'video', callerName: 'Mo' }, nativeTtl: '30s',
  }) as Record<string, any>
  assert.equal(call.notification, undefined)
  assert.equal(call.android.priority, 'high')
  assert.equal(call.android.ttl, '30s')
  assert.deepEqual(call.data, { type: 'call', callId: 'k1', kind: 'video', callerName: 'Mo' })
})
