import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Use the installed compiler so the checks also run on the project's Node 20 baseline.
const load = async (path) => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`)
const { messageLinks, safeWebUrl } = await load('../src/utils/linkify.ts')
const { canDelete, canEdit, EDIT_WINDOW_MS, matchRanges, notificationReminderDue, NOTIFICATION_REMINDER_MS, previewImageUrl } = await load('../src/utils/chatRules.ts')
const { default: groups } = await load('../src/features/emojiData.ts')
const { nextScreenFor } = await load('../src/state/nextScreen.ts')

test('missing nicknames enter chat for the in-chat prompt; pending requests keep their routing', () => {
  assert.equal(nextScreenFor({ status: 'active', otherNickname: null }), 'chat')
  assert.equal(nextScreenFor({ status: 'leave_pending', otherNickname: null }), 'chat')
  assert.equal(nextScreenFor({ status: 'pending', isRequester: true }), 'waiting')
  assert.equal(nextScreenFor({ status: 'pending', isRequester: false }), 'request')
  assert.equal(nextScreenFor({ status: 'terminated' }), 'connection-id')
})

const targets = (text) => messageLinks(text).map((link) => [text.slice(link.start, link.end), link.url])
test('Android link fixtures: domains, punctuation, email and file names', () => {
  assert.deepEqual(targets('see https://a.com/x?y=1.'), [['https://a.com/x?y=1', 'https://a.com/x?y=1']])
  assert.deepEqual(targets('try www.example.org or google.com/maps'), [['www.example.org', 'https://www.example.org/'], ['google.com/maps', 'https://google.com/maps']])
  assert.deepEqual(targets('mail me at a@b.com'), [])
  assert.deepEqual(targets('shop at shirt.online and open.spotify.com/track/1'), [['shirt.online', 'https://shirt.online/'], ['open.spotify.com/track/1', 'https://open.spotify.com/track/1']])
  assert.deepEqual(targets('see notes.txt and photo.jpeg'), [])
  assert.deepEqual(targets('example.site example.store example.xyz example.in maps.app.goo.gl/x').map((t) => t[0]), ['example.site', 'example.store', 'example.xyz', 'example.in', 'maps.app.goo.gl/x'])
})
test('Android phone fixtures: 7–15 digits; dates, short numbers and URL digits ignored', () => {
  assert.deepEqual(targets('call +91 98765-43210 or (022) 2345 6789'), [['+91 98765-43210', 'tel:+919876543210'], ['(022) 2345 6789', 'tel:02223456789']])
  assert.deepEqual(targets('on 2026-10-13 bring 12 of https://x.io/1234567'), [['https://x.io/1234567', 'https://x.io/1234567']])
  assert.deepEqual(targets('1234567890123456'), [])
})
test('search starts a word, handles Unicode and treats punctuation literally', () => {
  assert.deepEqual(matchRanges('they Hey! heyy', 'hey'), [{ start: 5, end: 8 }, { start: 10, end: 13 }])
  assert.deepEqual(matchRanges('éhey 1hey Hey', 'hey'), [{ start: 10, end: 13 }])
  assert.deepEqual(matchRanges('a+b aab', 'a+b'), [{ start: 0, end: 3 }])
  assert.deepEqual(matchRanges('anything', ' '), [])
})
test('edit/delete mirror sender, type, deletion and the exact 30-minute boundary', () => {
  const now = Date.now()
  const own = { id: 'message', senderId: 'me', type: 'text', createdAt: new Date(now - EDIT_WINDOW_MS).toISOString() }
  assert(canEdit(own, 'me', now))
  assert(!canEdit(own, 'me', now + 1))
  assert(!canEdit(own, 'other', now))
  assert(!canEdit({ ...own, deletedAt: new Date(now).toISOString() }, 'me', now))
  assert(!canEdit({ ...own, id: undefined }, 'me', now))
  assert(!canEdit({ ...own, type: 'image' }, 'me', now))
  assert(canDelete({ ...own, type: 'image' }, 'me', now))
  for (const type of ['call', 'system', 'alarm']) assert(!canDelete({ ...own, type }, 'me', now))
  assert(!canDelete({ ...own, createdAt: 'invalid' }, 'me', now))
})
test('notification reminder waits three days', () => {
  assert(notificationReminderDue(0, 100))
  assert(!notificationReminderDue(100, 100 + NOTIFICATION_REMINDER_MS - 1))
  assert(notificationReminderDue(100, 100 + NOTIFICATION_REMINDER_MS))
})
test('previews accept only http(s) and bounded raster images with matching magic bytes', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/a', 'https://', '/relative']) assert.equal(safeWebUrl(url), null)
  assert.equal(safeWebUrl('https://example.com/x'), 'https://example.com/x')
  assert.equal(previewImageUrl(btoa('<svg></svg>'), 'image/svg+xml'), null)
  assert.equal(previewImageUrl(btoa('<svg></svg>'), 'image/png'), null)
  assert.equal(previewImageUrl('not base64!', 'image/jpeg'), null)
  assert.equal(previewImageUrl('A'.repeat(820001), 'image/png'), null)
  assert.equal(previewImageUrl(btoa('\x89PNG\r\n\x1a\n'), 'image/png'), null)
  assert(previewImageUrl('R0lGODlhAgABAIAAAAAAAP///yH5BAEAAAAALAAAAAACAAEAAAICRAEAOw==', 'image/gif')?.startsWith('data:image/gif;base64,'))
  // Real 2×1 rasters, generated once with the repository's existing sharp dependency.
  for (const [mime, base64] of [
    ['image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWOoPPC/8sB/AA6DBHEZN551AAAAAElFTkSuQmCC'],
    ['image/jpeg', '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKGAYiD/2Q=='],
    ['image/webp', 'UklGRjoAAABXRUJQVlA4IC4AAADwAQCdASoCAAEAAUAmJaACdLoB+AAEyAAA/vEpL/zNExzH7V//mCV+QbrkAAAA'],
  ]) assert(previewImageUrl(base64, mime), mime)
  const huge = Buffer.alloc(24)
  Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(huge)
  huge.write('IHDR', 12); huge.writeUInt32BE(100000, 16); huge.writeUInt32BE(100000, 20)
  assert.equal(previewImageUrl(huge.toString('base64'), 'image/png'), null)
})
test('bundled full picker has all categories and only single emoji within the contract limit', () => {
  const entries = groups.flatMap((group) => group.emoji)
  assert.equal(groups.length, 9)
  assert.equal(entries.length, 3944)
  assert.equal(new Set(entries.map(([emoji]) => emoji)).size, entries.length)
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  for (const [emoji, name] of entries) { assert(emoji.length <= 32 && name); assert.equal([...segmenter.segment(emoji)].length, 1) }
})

test('read blue clears 3:1 on both gradient stops of every Android palette', async () => {
  const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8')
  const luminance = (hex) => hex.match(/[a-f\d]{2}/gi).map((n) => parseInt(n, 16) / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0)
  for (const [blue, stops] of [['5ab4ff', ['1b6841', '15523a']], ['0b57d0', ['d6f6d8', 'c3eec8', 'efd08a', 'f5e6b5']], ['80c8ff', ['b0003a', 'd10a4a']]]) {
    assert(css.includes(`--bubble-read: #${blue};`))
    for (const stop of stops) { const a = luminance(blue), b = luminance(stop); assert((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 3, `${blue} on ${stop}`) }
  }
})
