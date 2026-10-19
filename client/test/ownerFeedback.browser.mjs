import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function ownerFeedbackChecks({ page, width, engine, origin, screenshotDir, io, id, row, ownerState, messages, events, disconnect }) {
  const input = page.locator('#message-input')
  await page.waitForFunction(() => document.querySelector('#message-input')?.placeholder.startsWith('Try /'))
  assert.equal(await input.getAttribute('aria-label'), 'Message')
  await input.fill('A draft')
  assert.equal(await input.getAttribute('placeholder'), 'Message')
  await input.fill('')
  const center = await input.evaluate((el) => {
    const r = el.getBoundingClientRect(), p = el.closest('.chat__input-pill').getBoundingClientRect()
    return Math.abs((r.top + r.bottom - p.top - p.bottom) / 2)
  })
  assert(center <= 1, `composer centered within 1px, got ${center}`)
  assert.equal(await row(page, 8).locator('.chat__bubble-time').evaluate((el) => getComputedStyle(el).opacity), '0.72')
  assert.equal(await row(page, 8).locator('.chat__receipt').evaluate((el) => getComputedStyle(el).opacity), '1')

  await row(page, 9).locator('.letter-card').click()
  await page.locator('.letter-sheet').waitFor()
  await page.evaluate(() => document.fonts.ready)
  assert.equal(await page.locator('.letter-sheet').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)')
  assert.equal(await page.locator('.letter-sheet').evaluate((el) => getComputedStyle(el).color), 'rgb(0, 0, 0)')
  assert.match(await page.locator('.letter-sheet').evaluate((el) => getComputedStyle(el).fontFamily), /Dancing Script/)
  const date = await page.evaluate((createdAt) => new Date(createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }), messages.find((m) => m.id === id(9)).createdAt)
  assert.equal(await page.locator('.letter-sheet__date').textContent(), date)
  assert.match(await page.locator('.letter-sheet__from').textContent(), /With love,\s+Arfah/)
  const pdfDir = await mkdtemp(join(tmpdir(), 'one-on-one-letter-'))
  const downloadPdf = async (name) => {
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
    const file = await download
    assert.match(file.suggestedFilename(), /\.pdf$/)
    const path = join(pdfDir, name)
    await file.saveAs(path)
    assert.equal((await readFile(path)).subarray(0, 5).toString(), '%PDF-')
    return path
  }
  const shortPdf = await downloadPdf('short.pdf')
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.querySelector('.chat').dataset.theme = theme }, theme)
    await page.locator('.letter-sheet').evaluate((el) => { el.closest('.modal-overlay').scrollTop = 0 })
    await page.screenshot({ path: join(screenshotDir, `${engine}-${width}-${theme}-letter.png`) })
  }
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.modal-overlay'))
  const longBody = ('A promise for tomorrow. नमस्ते 🌷 👩🏽‍💻\n\n' + 'x'.repeat(90) + '\n').repeat(24)
  await page.evaluate(async (body) => {
    const { openLetter } = await import('/src/features/letters.ts')
    openLetter(body, { appearance: 'botanical', from: 'A & <friend> 🌷', to: 'You' }, '2026-10-19T12:00:00Z')
  }, longBody)
  assert.equal(await page.locator('.letter-sheet script').count(), 0)
  const longPdf = await downloadPdf('long.pdf')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.modal-overlay'))
  console.log(`PDF fixtures ${engine} ${width}px: ${shortPdf}; ${longPdf}`)

  await input.fill('/letter'); await input.press('Enter')
  await page.locator('#letter-body').fill('A letter from the web. 🌷')
  await page.locator('#letter-from').fill('Me')
  await page.locator('#letter-next').click()
  assert.equal(await page.locator('.letter-compose__picker, .letter-appearance-opt').count(), 0)
  await page.getByRole('button', { name: 'Send letter', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.modal-overlay'))
  assert(events.some(([e, data]) => e === 'message:send' && data.type === 'letter' && data.payload.appearance === 'dawn'))

  for (const [n, type, payload] of [
    [5001, 'letter', { appearance: 'botanical', from: 'Me', to: 'Arfah' }],
    [5002, 'image', { path: 'chat/fixture.webp', mime: 'image/jpeg', size: 1000, width: 200, height: 300, url: '/love.jpg' }],
    [5003, 'file', { path: 'chat/fixture.webp', mime: 'application/pdf', name: 'notes.pdf', size: 1000 }],
  ]) {
    const message = { id: id(n), senderId: 'me', createdAt: new Date().toISOString(), content: 'A keepsake', type, payload, reactions: [], replyTo: null }
    messages.push(message); io.emit('message:new', message)
    const card = row(page, n).locator(type === 'letter' ? '.letter-card' : type === 'file' ? '.file-card' : 'img').first()
    await card.scrollIntoViewIfNeeded()
    if (width === 360) {
      const touch = (type) => card.evaluate((el, type) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: 100, clientY: 300 }] })
        el.dispatchEvent(event)
      }, type)
      await touch('touchstart')
      await page.waitForTimeout(550)
      await touch('touchend')
    } else {
      const box = await card.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up()
    }
    await page.locator('#selection-delete').waitFor({ state: 'visible' })
    assert(await page.locator('#selection-delete').isEnabled(), `${type} hold allows delete`)
    assert.equal(await page.locator('.letter-view').count(), 0, 'hold does not open the letter')
    await page.waitForTimeout(650)
    await page.keyboard.press('Escape')
  }

  const raise = { id: id(5100), senderId: 'other', createdAt: new Date().toISOString(), content: '', type: 'alarm', payload: null, reactions: [], replyTo: null }
  await page.evaluate(() => {
    window.__alarmPauses = 0
    const pause = HTMLMediaElement.prototype.pause
    HTMLMediaElement.prototype.pause = function () { if (this.src.endsWith('/alarm.wav')) window.__alarmPauses++; return pause.call(this) }
  })
  messages.push(raise); io.emit('message:new', raise)
  await page.locator('#alarm-acknowledge').waitFor({ state: 'visible' })
  ownerState.failAlarmAck = true; ownerState.alarmAckDelay = 1200
  await page.locator('#alarm-acknowledge').click()
  assert.equal(await page.locator('.chat--alarm').count(), 0, 'quiet before the server responds')
  assert(await page.evaluate(() => window.__alarmPauses > 0), 'audio stops before the server responds')
  assert(!messages.some((m) => m.payload?.ack === raise.id), 'failed acknowledgement is not recorded')
  await page.waitForFunction(() => document.body.textContent.includes('Ack failed (fixture)'))
  await page.keyboard.press('Escape')
  ownerState.failAlarmAck = false
  await row(page, 5100).locator('.alarm-card').click()
  await page.waitForFunction(() => !!document.querySelector('.alarm-card--ack'))
  const footer = await page.locator('.alarm-card--ack').evaluate((el) => {
    const body = el.closest('.chat__message-body').getBoundingClientRect()
    const meta = el.closest('.chat__message-body').querySelector('.chat__meta').getBoundingClientRect()
    return { right: body.right - meta.right, bottom: body.bottom - meta.bottom }
  })
  assert(footer.right < 15 && footer.bottom < 15, `alarm footer hugs the bubble: ${JSON.stringify(footer)}`)
  ownerState.alarmAckDelay = 0
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.querySelector('.chat').dataset.theme = theme }, theme)
    await page.screenshot({ path: join(screenshotDir, `${engine}-${width}-${theme}-chat.png`) })
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))

  disconnect(); await page.reload()
  await page.locator('#share-btn:not([disabled])').waitFor()
  await page.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: async (data) => { window.__share = data } }) })
  await page.locator('#share-btn').click()
  const share = await page.evaluate(() => window.__share)
  assert.match(share.text, /https:\/\/play\.google\.com\/store\/apps\/details\?id=app.web.oneonone/)
  assert.match(share.text, /https:\/\/one-on-one-mu\.vercel\.app/)
  assert.match(share.text, /ABCDEFGH/)
  await page.locator('#connection-id').click()
  assert.equal(await page.evaluate(() => window.__copied), 'ABCDEFGH')
  await page.evaluate(() => { navigator.share = undefined })
  await page.locator('#share-btn').click()
  assert.equal(await page.evaluate(() => window.__copied), share.text)
  const beforeCancel = await page.locator('#subtitle').textContent()
  await page.evaluate(() => { navigator.share = async () => { throw new DOMException('cancelled', 'AbortError') } })
  await page.locator('#share-btn').click()
  assert.equal(await page.locator('#subtitle').textContent(), beforeCancel)

  // Legacy browser-wide values must not admit a different signed-in account.
  await page.evaluate(() => { localStorage.setItem('ageVerified', '1'); localStorage.setItem('termsAcceptedAt', 'old') })
  await page.goto(`${origin}/?owner=returning`)
  await page.locator('#dob-day').selectOption('1'); await page.locator('#dob-month').selectOption('1'); await page.locator('#dob-year').selectOption('2000')
  await page.locator('#dob-btn').click(); await page.locator('#agree-check').check(); await page.locator('#agree-btn').click()
  await page.locator('#share-btn').waitFor()
  await page.evaluate(async () => (await import('/src/services/authService.ts')).signOut({ skipPush: true }))
  await page.reload(); await page.locator('#share-btn').waitFor()
  assert.equal(await page.locator('#dob-day, #agree-check').count(), 0, 'same account skips both gates after sign-out')
  await page.goto(`${origin}/?owner=different`)
  await page.locator('#dob-day').waitFor()
  await page.goto(`${origin}/?owner=returning`)
  await page.locator('#share-btn').waitFor()
  ownerState.failDeleteAccount = true
  assert(await page.evaluate(async () => { try { await (await import('/src/services/meApi.ts')).deleteAccount(); return false } catch { return !!localStorage.getItem('ageVerified:returning') } }))
  ownerState.failDeleteAccount = false
  await page.evaluate(async () => (await import('/src/services/meApi.ts')).deleteAccount())
  assert.equal(await page.evaluate(() => localStorage.getItem('ageVerified:returning')), null)
  assert.equal(await page.evaluate(() => localStorage.getItem('ageVerified:fixture')), '1', 'delete preserves another account gates')
  await page.reload(); await page.locator('#dob-day').waitFor()
  await page.goto(`${origin}/?owner=recreated`); await page.locator('#dob-day').waitFor()
}
