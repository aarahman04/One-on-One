import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = async (path, replacements = {}) => {
  let code = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  for (const [from, to] of Object.entries(replacements)) code = code.replaceAll(`'${from}'`, JSON.stringify(to))
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const { planLetterPages, chooseLetterSize } = await import(await source('../src/features/letterLayout.ts'))
const { archiveContent, archiveMessages, archiveFiles, archiveFilename, safeArchiveName } = await import(await source('../src/features/archiveRules.ts'))
const { swipeClaim, swipeOffset } = await import(await source('../src/utils/swipeReply.ts'))

test('both archive formats retain readable call records instead of empty call content', () => {
  assert.equal(archiveContent({ type: 'call', content: '', payload: { kind: 'video', outcome: 'completed', durationSec: 125 } }), 'Video call · Completed · 2:05')
  assert.equal(archiveContent({ type: 'call', content: '', payload: { kind: 'audio', outcome: 'unreachable' } }), 'Voice call · Not reached')
  assert.equal(archiveContent({ type: 'text', content: 'Original words' }), 'Original words')
})

test('pagination keeps the signature with three final body lines and preserves every line', () => {
  for (let length = 0; length < 160; length++) {
    const lines = Array(length).fill(28), metrics = { header: 92, lines, signature: 56 }
    const pages = planLetterPages(metrics, 714)
    assert.deepEqual(pages.flatMap((p) => Array.from({ length: p.to - p.from }, (_, i) => p.from + i)), Array.from({ length }, (_, i) => i))
    assert.equal(pages.filter((p) => p.signature).length, 1)
    const last = pages.at(-1)
    assert.equal(last.signature, true)
    assert(last.to - last.from >= Math.min(3, length))
    for (const [i, page] of pages.entries()) assert((i === 0 ? metrics.header : 0) + (page.to - page.from) * 28 + (page.signature ? 74 : 0) <= 714)
  }
})

test('near-one-page letters step down; long letters keep 20pt', () => {
  const measure = (size) => ({ header: (size + 8) * 2 + 36, lines: Array(size === 20 ? 20 : 18).fill(size + 8), signature: (size + 8) * 2 })
  const near = chooseLetterSize(700, measure)
  assert.equal(near.size, 18); assert.equal(near.pages.length, 1)
  assert.equal(chooseLetterSize(714, (size) => ({ header: 90, lines: Array(70).fill(size + 8), signature: 2 * (size + 8) })).size, 20)
})

test('zip naming is safe, unique ignoring case, and excludes tombstoned media before file collection', () => {
  const msg = (id, type, payload, deletedAt = null) => ({ id, type, payload, deletedAt, createdAt: '2026-10-20T12:00:00Z' })
  const messages = [msg('a','letter',{ to: '../A/B' }), msg('b','letter',{ to: '../A/B' }), msg('c','image',{ mime:'image/webp',width:512,height:512,path:'chat/c' }), msg('d','voice',{ mime:'audio/mp4',path:'chat/d' }), msg('e','file',{ mime:'text/plain',name:'../../Letter.TXT',path:'chat/e' }), msg('f','file',{ mime:'text/plain',name:'../../letter.txt',path:'chat/f' }), msg('g','image',{ mime:'image/png',path:'chat/deleted' },'now'), msg('h','system',null)]
  const kept = archiveMessages(messages), files = archiveFiles(messages)
  assert.equal(kept.length, 6); assert.equal(files.length, 6)
  assert(files[0].name.startsWith('letters/2026-10-20-')); assert(files[1].name.endsWith('(2).pdf'))
  assert(files[2].name.startsWith('images/stickers/')); assert(files[3].name.startsWith('voice/'))
  assert(files[5].name.endsWith('(2).txt'))
  assert(!files.some((f) => f.message.id === 'g'))
  assert(files.every((f) => !f.name.split('/').includes('..')))
  assert.equal(safeArchiveName('...'), 'file')
  assert.equal(safeArchiveName('CON.txt'), '_CON.txt')
  assert.match(archiveFilename('../Arfah/', '2026-10-20T12:00:00Z'), /^one-on-one-[^/\\]+-2026-10-20\.zip$/)
})

test('swipes claim only strongly horizontal movement toward the reply direction', () => {
  assert.equal(swipeClaim(9,1,false), 'wait')
  assert.equal(swipeClaim(80,0,false,true), 'scroll')
  for (const [dx,dy,mine] of [[60,30,false],[60,31,false],[60,0,true],[-60,0,false],[0,40,true]]) assert.equal(swipeClaim(dx,dy,mine), 'scroll')
  assert.equal(swipeClaim(61,30,false),'reply'); assert.equal(swipeClaim(-61,30,true),'reply')
  assert.equal(swipeOffset(60,false),60); assert.equal(swipeOffset(-60,true),-60)
  assert.equal(swipeOffset(100,false),70); assert.equal(swipeOffset(-200,true),-80)
})
