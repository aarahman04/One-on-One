import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const load = async (path) => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`)
const { isSticker, metaSide, dragTrim, stickerPlacement, transformPlacement, encodeSticker } = await load('../src/utils/stickerMath.ts')
const { formatClock, formatMessageTime, formatFullTimestamp } = await load('../src/utils/formatTime.ts')
test('bare stickers require the exact image payload and no reply or tombstone', () => {
  const sticker = { type: 'image', payload: { mime: 'image/webp', width: 512, height: 512 } }
  assert.equal(isSticker(sticker), true)
  for (const patch of [{ type: 'voice' }, { replyTo: 'id' }, { deletedAt: 'now' }, { payload: null }, { payload: { mime: 'image/gif', width: 512, height: 512 } }, { payload: { mime: 'image/webp', width: '512', height: 512 } }]) assert.equal(isSticker({ ...sticker, ...patch }), false)
})
test('all media meta uses the sent right / received left rule', () => {
  assert.equal(metaSide(true), 'right'); assert.equal(metaSide(false), 'left')
})
test('crop movement preserves dimensions at the photo boundary; each corner has a 10% minimum', () => {
  const full = { left: 0, top: 0, right: 1, bottom: 1 }
  assert.deepEqual(dragTrim(full, 0, 2, 2), { left: .9, top: .9, right: 1, bottom: 1 })
  const smaller = { left: .2, top: .3, right: .6, bottom: .7 }
  const moved = dragTrim(smaller, -1, 9, -9)
  assert.equal(moved.right, 1); assert.equal(moved.top, 0)
  assert(Math.abs(moved.right - moved.left - .4) < 1e-10)
  for (let handle = 0; handle < 4; handle++) {
    const t = dragTrim(smaller, handle, handle % 2 ? -9 : 9, handle < 2 ? 9 : -9)
    assert(t.right - t.left >= .1 - 1e-10); assert(t.bottom - t.top >= .1 - 1e-10)
  }
  assert.throws(() => dragTrim(full, -1, NaN, 0))
})
test('square placement fits portrait/landscape with transparent space and bounds pan/zoom', () => {
  const p = stickerPlacement(400, 200, { zoom: 1, x: 9, y: 9 })
  assert.equal(p.width, 1); assert.equal(p.height, .5); assert.equal(p.top, .25); assert.equal(p.x, 0)
  const zoomed = stickerPlacement(200, 400, { zoom: 99, x: 9, y: -9 })
  assert.equal(zoomed.zoom, 6); assert.equal(zoomed.x, 1); assert.equal(zoomed.y, -2.5)
  assert.throws(() => stickerPlacement(0, 200, { zoom: 1, x: 0, y: 0 }))
})
test('pinch/wheel placement preserves the focal point before bounding', () => {
  const p = transformPlacement(512, 512, { zoom: 2, x: 0, y: 0 }, 1.5, .1, 0, .2, -.2)
  assert.equal(p.zoom, 3); assert(Math.abs(p.x) < 1e-10); assert(Math.abs(p.y - .1) < 1e-10)
  assert.throws(() => transformPlacement(512, 512, p, 0, 0, 0))
})
test('WebP retries through quality .8 and never accepts over 100000 bytes', async () => {
  const tried = []
  const blob = await encodeSticker(async (q) => { tried.push(q); return new Blob([new Uint8Array(q > .9 ? 100001 : 100000)], { type: 'image/webp' }) })
  assert.deepEqual(tried, [1, .95, .9]); assert.equal(blob.size, 100000)
  const all = []
  await assert.rejects(encodeSticker(async (q) => { all.push(q); return new Blob([new Uint8Array(100001)], { type: 'image/webp' }) }), /tighter crop/)
  assert.deepEqual(all, [1, .95, .9, .85, .8])
  await assert.rejects(encodeSticker(async () => null), /encode WebP/)
  await assert.rejects(encodeSticker(async () => new Blob(['png'], { type: 'image/png' })), /encode WebP/)
})
test('all clock formatters use h:mm AM/PM in the viewer local timezone', () => {
  for (const [hour, expected] of [[0, '12:05 AM'], [12, '12:05 PM'], [23, '11:05 PM']]) {
    const date = new Date(2026, 9, 14, hour, 5, 59)
    assert.equal(formatClock(date), expected); assert.equal(formatMessageTime(date), expected)
    assert.equal(formatFullTimestamp(date).split('\n')[1], expected)
  }
  assert.equal(formatClock(new Date(NaN)), ''); assert.equal(formatFullTimestamp(new Date(NaN)), '')
})
