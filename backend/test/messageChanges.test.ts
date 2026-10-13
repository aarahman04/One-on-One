import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 1).toString('base64')

const { assertCanChange, EDIT_WINDOW_MS } = await import('../src/services/messageService.js')
const { isPublicAddress, checkUrl, parseMeta } = await import('../src/services/linkPreviewService.js')

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)
const row = (over = {}) => ({ senderId: 'me', createdAt: new Date(NOW - 60_000).toISOString(), type: 'text' as const, deletedAt: null, ...over })

test('sender can edit and delete a recent text', () => {
  assert.doesNotThrow(() => assertCanChange(row(), 'me', 'edit', NOW))
  assert.doesNotThrow(() => assertCanChange(row(), 'me', 'delete', NOW))
})
test('other member cannot change it', () => assert.throws(() => assertCanChange(row(), 'other', 'delete', NOW), /own messages/))
test('30 minute window is enforced', () => {
  const old = row({ createdAt: new Date(NOW - EDIT_WINDOW_MS - 1).toISOString() })
  assert.throws(() => assertCanChange(old, 'me', 'edit', NOW), /30 minutes/)
  assert.throws(() => assertCanChange(old, 'me', 'delete', NOW), /30 minutes/)
})
test('only text can be edited; media can be deleted', () => {
  assert.throws(() => assertCanChange(row({ type: 'image' }), 'me', 'edit', NOW), /only text/)
  assert.doesNotThrow(() => assertCanChange(row({ type: 'image' }), 'me', 'delete', NOW))
})
test('alarm, call and deleted messages cannot change', () => {
  assert.throws(() => assertCanChange(row({ type: 'alarm' }), 'me', 'delete', NOW))
  assert.throws(() => assertCanChange(row({ type: 'call' }), 'me', 'delete', NOW))
  assert.throws(() => assertCanChange(row({ deletedAt: new Date(NOW).toISOString() }), 'me', 'edit', NOW), /deleted/)
})

test('private and metadata addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1'])
    assert.equal(isPublicAddress(ip), false, ip)
  for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::6810:85e5']) assert.equal(isPublicAddress(ip), true, ip)
})
test('only public http(s) urls on standard ports pass', () => {
  assert.equal(checkUrl('https://open.spotify.com/track/1').hostname, 'open.spotify.com')
  for (const bad of ['file:///etc/passwd', 'http://127.0.0.1/', 'http://localhost/', 'http://x.com:8080/', 'https://user:pw@x.com/', 'http://[::1]/', 'ftp://x.com'])
    assert.throws(() => checkUrl(bad), bad)
})
test('parseMeta reads open graph, resolves relative urls and falls back', () => {
  const html = `<head><title>Fallback &amp; title</title>
    <meta property="og:title" content="Song &#8211; Artist"><meta content="Spotify" property="og:site_name">
    <meta property="og:image" content="/cover.jpg"><link rel="shortcut icon" href="/fav.png"></head>`
  const meta = parseMeta(html, new URL('https://open.spotify.com/track/1'))
  assert.equal(meta.title, 'Song – Artist')
  assert.equal(meta.siteName, 'Spotify')
  assert.equal(meta.image, 'https://open.spotify.com/cover.jpg')
  assert.equal(meta.icon, 'https://open.spotify.com/fav.png')
  const bare = parseMeta('<title>Hi</title>', new URL('https://www.shirt.online/'))
  assert.deepEqual([bare.title, bare.siteName, bare.image, bare.icon], ['Hi', 'shirt.online', null, 'https://www.shirt.online/favicon.ico'])
})

const { isReactionEmoji } = await import('../src/services/reactionService.js')
test('any single emoji is a valid reaction, text is not', () => {
  for (const e of ['❤️', '👍', '😂', '🙏', '👍🏽', '🇮🇳', '👨‍👩‍👧', '❤️‍🔥', '1️⃣', '🫠']) assert.equal(isReactionEmoji(e), true, e)
  for (const e of ['', 'a', 'hi', '👍👍', '👍 ', '<b>', 'x'.repeat(40), 5]) assert.equal(isReactionEmoji(e), false, String(e))
})
