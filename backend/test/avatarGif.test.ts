import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 1).toString('base64')

const { sniffImage, validateAvatar, avatarId, AVATAR_MAX_BYTES } = await import('../src/services/avatarService.js')
const { isGiphyMediaUrl, toResult, isGif, gifSize, searchGifs } = await import('../src/services/gifService.js')

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])

test('avatar magic bytes must match the declared type', () => {
  assert.equal(sniffImage(JPEG), 'image/jpeg')
  assert.equal(sniffImage(PNG), 'image/png')
  assert.equal(sniffImage(WEBP), 'image/webp')
  assert.equal(validateAvatar(JPEG, 'image/jpeg'), 'jpg')
  assert.throws(() => validateAvatar(PNG, 'image/jpeg'), /unsupported image type/)
  assert.throws(() => validateAvatar(Buffer.from('<svg/>'), 'image/svg+xml'), /unsupported image type/)
  assert.throws(() => validateAvatar(Buffer.from('GIF89a'), 'image/gif'), /unsupported image type/)
})

test('avatar size is capped', () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(AVATAR_MAX_BYTES)])
  assert.throws(() => validateAvatar(big, 'image/jpeg'), /size limit/)
  assert.throws(() => validateAvatar(Buffer.alloc(0), 'image/jpeg'), /empty upload/)
})

test('avatar id is the file name without folder or extension', () => {
  assert.equal(avatarId('avatars/u1/0b7c-11.jpg'), '0b7c-11')
  assert.equal(avatarId(null), null)
})

test('only https GIPHY media hosts are accepted', () => {
  assert.equal(isGiphyMediaUrl('https://media2.giphy.com/media/abc/200.gif?cid=1'), true)
  assert.equal(isGiphyMediaUrl('http://media2.giphy.com/media/abc/200.gif'), false)
  assert.equal(isGiphyMediaUrl('https://giphy.com.evil.example/x.gif'), false)
  assert.equal(isGiphyMediaUrl('https://media.giphy.com:8443/x.gif'), false)
  assert.equal(isGiphyMediaUrl('https://169.254.169.254/latest'), false)
})

test('GIPHY results are reduced to safe fields', () => {
  const ok = toResult({ id: 'abc123', title: 'hi', images: { fixed_width: { url: 'https://media1.giphy.com/media/abc123/200w.gif', width: '200', height: '150' } } })
  assert.deepEqual(ok, { id: 'abc123', title: 'hi', previewUrl: 'https://media1.giphy.com/media/abc123/200w.gif', width: 200, height: 150 })
  assert.equal(toResult({ id: '../x', images: { fixed_width: { url: 'https://media1.giphy.com/a.gif' } } }), null)
  assert.equal(toResult({ id: 'abc', images: { fixed_width: { url: 'https://evil.example/a.gif' } } }), null)
})

test('gif magic bytes and header size', () => {
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0xc8, 0x00, 0x96, 0x00])])
  assert.equal(isGif(gif), true)
  assert.deepEqual(gifSize(gif), { width: 200, height: 150 })
  assert.equal(isGif(JPEG), false)
})

test('search without GIPHY_API_KEY is a clean 503', async () => {
  delete process.env.GIPHY_API_KEY
  await assert.rejects(searchGifs('cats', 0), /not configured/)
})
