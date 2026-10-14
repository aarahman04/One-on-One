// Isolated browser check: real client + Socket.IO, scripted contract data, no account or deployed writes.
// Run with Playwright installed, or set PLAYWRIGHT_MODULE to its index.mjs; requires backend npm ci.
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer as createViteServer } from 'vite'

const { Server } = createRequire(new URL('../../backend/package.json', import.meta.url))('socket.io')
const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const screenshotDir = await mkdtemp(join(tmpdir(), 'one-on-one-parity-'))
const ME = 'me'
const OTHER = 'other'
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let messages
let connection
let events
let previewRequests
let failEdit = false
let failDelete = false
const reset = (fullPage = false, nickname = 'Arfah') => {
  const now = Date.now()
  const msg = (n, senderId, content, extra = {}) => ({ id: id(n), senderId, content, createdAt: new Date(now - (10 - n) * 20_000).toISOString(), type: 'text', payload: null, replyTo: null, reactions: [], editedAt: null, deletedAt: null, ...extra })
  messages = [
    msg(1, ME, 'Old message', { createdAt: new Date(now - 31 * 60_000).toISOString() }),
    msg(2, OTHER, 'they said that'),
    msg(3, ME, 'Hey! editable'),
    msg(4, OTHER, 'shirt.online call +91 98765-43210'),
    msg(5, ME, 'Reply to Hey', { replyTo: id(3) }),
    msg(6, OTHER, 'https://open.spotify.com/track/1'),
    msg(7, OTHER, 'https://unsafe.site'),
    msg(8, ME, 'Latest editable'),
    msg(9, OTHER, 'A private letter', { type: 'letter', payload: { appearance: 'dawn', from: 'Arfah', to: 'You' } }),
  ]
  if (fullPage) messages = [...Array.from({ length: 52 }, (_, i) => msg(-i - 1, OTHER, `Earlier ${i}`, { id: id(i + 100), createdAt: new Date(now - (i + 60) * 60_000).toISOString() })), ...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  connection = { id: 'chat', status: 'active', myUserId: ME, isRequester: true, otherNickname: nickname, otherConnectionCode: '', myLeaveStep: 0, otherLeaveStep: 0, daysRemaining: null, bothLeaving: false, canAdvanceLeave: true, otherLastReadAt: new Date(now).toISOString(), otherLastDeliveredAt: new Date(now).toISOString(), wallpaper: 'off', messageStyle: 'bubbles', pinnedMessageId: id(3), pinnedBy: OTHER, pinnedAt: new Date(now).toISOString() }
  events = []
  previewRequests = []
  failEdit = false
  failDelete = false
}
reset()
const api = createHttpServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
  const url = new URL(req.url, 'http://fixture')
  res.setHeader('Content-Type', 'application/json')
  if (url.pathname === '/api/connections/current') res.end(JSON.stringify({ connection }))
  else if (url.pathname.endsWith('/messages')) {
    const before = url.searchParams.get('before')
    const after = url.searchParams.get('after')
    const selected = messages.filter((m) => (!before || m.createdAt < before) && (!after || m.createdAt > after))
    res.end(JSON.stringify({ messages: after ? selected.slice(0, 50) : selected.slice(-50) }))
  } else if (url.pathname === '/api/link-preview') {
    const target = url.searchParams.get('url')
    previewRequests.push(target)
    const unsafe = target.includes('unsafe')
    res.end(JSON.stringify({ preview: { url: unsafe ? 'javascript:alert(1)' : target, siteName: 'Fixture site', title: unsafe ? '<script>unsafe</script>' : 'A preview title', description: 'A description of the shared link, supplied by the server.', image: unsafe ? btoa('<svg></svg>') : 'R0lGODlhAgABAIAAAAAAAP///yH5BAEAAAAALAAAAAACAAEAAAICRAEAOw==', imageMime: unsafe ? 'image/svg+xml' : 'image/gif', imageKind: target.includes('spotify') ? 'cover' : 'icon' } }))
  } else if (url.pathname.endsWith('/nickname')) {
    let body = ''; for await (const chunk of req) body += chunk
    connection.otherNickname = JSON.parse(body).nickname
    res.writeHead(204).end()
  } else if (url.pathname.endsWith('/read') || url.pathname.endsWith('/report') || url.pathname.endsWith('/subscribe')) res.writeHead(204).end()
  else { res.writeHead(404); res.end(JSON.stringify({ error: 'fixture route missing' })) }
})
const io = new Server(api, { cors: { origin: '*' } })
io.on('connection', (socket) => {
  const update = (event, data, ack) => { io.emit(event, data); ack?.({ ok: true, ...(event === 'pin:update' ? { pin: data } : { message: data }) }) }
  socket.on('typing', (data) => events.push(['typing', data]))
  socket.on('message:send', (data, ack) => {
    events.push(['message:send', data])
    const message = { id: id(1000 + messages.length), senderId: ME, createdAt: new Date().toISOString(), type: data.type, content: data.content, payload: data.payload, replyTo: data.replyTo, tempId: data.tempId, reactions: [], editedAt: null, deletedAt: null }
    messages.push(message)
    update('message:new', message, ack)
  })
  socket.on('message:edit', (data, ack) => {
    events.push(['message:edit', data])
    if (failEdit) { ack({ error: 'Edit failed (fixture)' }); return }
    const message = messages.find((m) => m.id === data.messageId)
    Object.assign(message, { content: data.content, editedAt: new Date().toISOString() })
    update('message:update', message, ack)
  })
  socket.on('message:delete', (data, ack) => {
    events.push(['message:delete', data])
    if (failDelete) { ack({ error: 'Delete failed (fixture)' }); return }
    const message = messages.find((m) => m.id === data.messageId)
    Object.assign(message, { content: '', payload: null, reactions: [], deletedAt: new Date().toISOString() })
    if (connection.pinnedMessageId === message.id) {
      Object.assign(connection, { pinnedMessageId: null, pinnedBy: null, pinnedAt: null })
      io.emit('pin:update', { messageId: null, pinnedBy: null, pinnedAt: null })
    }
    update('message:update', message, ack)
  })
  socket.on('message:pin', (data, ack) => {
    events.push(['message:pin', data])
    const pin = { messageId: data.messageId, pinnedBy: data.messageId ? ME : null, pinnedAt: data.messageId ? new Date().toISOString() : null }
    Object.assign(connection, { pinnedMessageId: pin.messageId, pinnedBy: pin.pinnedBy, pinnedAt: pin.pinnedAt })
    update('pin:update', pin, ack)
  })
  for (const op of ['add', 'remove']) socket.on(`reaction:${op}`, (data, ack) => {
    events.push([`reaction:${op}`, data])
    io.emit('reaction:update', { ...data, userId: ME, op })
    ack({ ok: true })
  })
})
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
const apiOrigin = `http://127.0.0.1:${api.address().port}`
process.env.VITE_API_URL = apiOrigin
process.env.VITE_VAPID_PUBLIC_KEY = 'fixture'
const vite = await createViteServer({
  root: new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), configFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify(apiOrigin), 'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify('fixture') },
  plugins: [{ name: 'isolated-auth', enforce: 'pre', transformIndexHtml(html) { return html.replace("connect-src 'self'", `connect-src 'self' ${apiOrigin} ${apiOrigin.replace('http:', 'ws:')}`) }, transform(_code, moduleId) {
    if (moduleId.replaceAll('\\', '/').endsWith('/src/services/supabaseClient.ts')) return "export const supabase = {auth:{getSession:async()=>({data:{session:{access_token:'fixture',user:{id:'fixture'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({})}}"
    if (_code.includes('import.meta.env.VITE_API_URL')) return _code.replaceAll('import.meta.env.VITE_API_URL', JSON.stringify(apiOrigin))
  } }], server: { host: '127.0.0.1', port: 0, hmr: false },
})
await vite.listen()
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
const row = (page, n) => page.locator(`.chat__message[data-id="${id(n)}"]`)
const visible = async (page, selector) => page.locator(selector).first().waitFor({ state: 'visible' })
const waitText = async (page, selector, text) => {
  try { await page.waitForFunction(({ selector, text }) => [...document.querySelectorAll(selector)].some((el) => el.textContent.includes(text)), { selector, text }) }
  catch (error) {
    await page.screenshot({ path: join(screenshotDir, 'failure.png') })
    console.log('Failed state', { selector, text, events: events.slice(-5), screenshotDir }, await page.evaluate(() => ({ selection: document.querySelector('#selection-count')?.textContent, draft: document.querySelector('#message-input')?.value, editing: document.querySelector('#composer')?.dataset.editing, toast: document.querySelector('.toast')?.textContent })))
    throw error
  }
}

const browsers = (process.env.PARITY_BROWSERS ?? 'chromium').split(',')
try {
  for (const engine of browsers) {
    const browser = await (engine === 'edge' || engine === 'chrome' ? playwright.chromium : playwright[engine]).launch(engine === 'edge' ? { channel: 'msedge' } : engine === 'chrome' ? { channel: 'chrome' } : {})
    try {
      for (const width of [1280, 360]) {
        reset()
        const context = await browser.newContext({ viewport: { width, height: 820 }, hasTouch: width === 360, ...(engine !== 'firefox' ? { isMobile: width === 360 } : {}), serviceWorkers: 'block' })
        await context.addInitScript(() => {
          localStorage.setItem('ageVerified', '1'); localStorage.setItem('termsAcceptedAt', 'fixture')
          if (!localStorage.getItem('notificationReminderAt')) localStorage.setItem('notificationReminderAt', String(Date.now()))
          window.__copied = ''
          Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied = text } } })
        })
        const page = await context.newPage()
        page.setDefaultTimeout(10_000)
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.route('**/*', (route) => route.request().url().startsWith(origin) || route.request().url().startsWith(apiOrigin) ? route.continue() : route.abort())
        await page.goto(origin)
        await waitText(page, '#nav-status', 'in chat')
        await visible(page, '#pin-banner')
        assert((await page.locator('#pin-snippet').textContent()).includes('Hey!'))
        await page.locator('#message-input').focus()
        await row(page, 3).locator('.chat__message-text').dblclick()
        await visible(page, '.chat__quick-reactions')
        assert.equal(await page.evaluate(() => document.activeElement.id), 'message-input', 'quick bar preserves composer focus')
        await page.waitForFunction(() => document.querySelector('.chat__quick-reactions').getAnimations().length === 0)
        const reactionBounds = await page.locator('.chat__quick-reactions').boundingBox()
        assert(reactionBounds.x >= 8 && reactionBounds.x + reactionBounds.width <= width - 8, 'full quick bar fits the viewport')
        assert.equal(await page.locator('.chat__quick-reactions button').count(), 7)
        await page.screenshot({ path: join(screenshotDir, `${engine}-${width}-quick-reactions.png`) })
        await page.getByRole('button', { name: 'React with 👍', exact: true }).click()
        await visible(page, '.chat__reaction-chip')
        assert(events.some(([event]) => event === 'reaction:add'))
        await row(page, 3).locator('.chat__message-text').dblclick()
        assert.equal(await page.getByRole('button', { name: 'React with 👍', exact: true }).getAttribute('aria-pressed'), 'true')
        await page.getByRole('button', { name: 'Choose another emoji' }).click()
        await page.getByRole('searchbox', { name: 'Search emoji' }).fill('rocket')
        await page.screenshot({ path: join(screenshotDir, `${engine}-${width}-emoji-picker.png`) })
        await page.getByRole('button', { name: 'rocket', exact: true }).click()
        assert(events.some(([event, data]) => event === 'reaction:add' && data.emoji === '🚀'))
        await row(page, 9).locator('.letter-card').dblclick()
        await visible(page, '.chat__quick-reactions')
        assert.equal(await page.getByRole('dialog').count(), 0, 'double-tapping a card reacts without opening its viewer')
        await page.keyboard.press('Escape')
        if (width === 360 && engine !== 'firefox') {
          await row(page, 8).scrollIntoViewIfNeeded()
          const bounds = await row(page, 8).locator('.chat__message-body').boundingBox()
          await page.locator('#message-input').focus()
          await page.touchscreen.tap(bounds.x + 20, bounds.y + 15)
          await page.touchscreen.tap(bounds.x + 20, bounds.y + 15)
          await visible(page, '.chat__quick-reactions')
          assert.equal(await page.evaluate(() => document.activeElement.id), 'message-input', 'touch reactions preserve focus')
          await page.keyboard.press('Escape')
          const touch = async (type, dx = 0) => page.evaluate(({ selector, type, x, y }) => {
            const event = new Event(type, { bubbles: true, cancelable: true })
            Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] })
            document.querySelector(selector).dispatchEvent(event)
          }, { selector: `.chat__message[data-id="${id(8)}"]`, type, x: bounds.x + 20 + dx, y: bounds.y + 15 })
          await touch('touchstart')
          await page.waitForFunction(() => document.querySelector('#selection-count').textContent === '1')
          await touch('touchend')
          await page.keyboard.press('Escape')
          await page.waitForTimeout(650)
          await touch('touchstart')
          await touch('touchmove', 72)
          await touch('touchend')
          await visible(page, '#reply-bar')
          assert.equal(await page.evaluate(() => document.activeElement.id), 'message-input', 'swipe reply focuses composer')
          await page.keyboard.press('Escape')
          await page.waitForTimeout(500)
        }
        await row(page, 3).locator('.chat__message-text').click({ button: 'right' })
        await row(page, 5).locator('.chat__message-text').click()
        assert.equal(await page.locator('#selection-count').textContent(), '2')
        await page.screenshot({ path: join(screenshotDir, `${engine}-${width}-selection.png`) })
        await page.locator('#selection-copy').click()
        assert.equal(await page.evaluate(() => window.__copied), 'Hey! editable\nReply to Hey')
        await row(page, 1).locator('.chat__message-text').click({ button: 'right' })
        assert(await page.locator('#selection-edit').isHidden())
        assert(await page.locator('#selection-delete').isHidden())
        await page.keyboard.press('Escape')
        await page.locator('#message-input').press('ArrowUp')
        await waitText(page, '#edit-bar', 'Edit message')
        await page.locator('#message-input').fill('Changed on web')
        failEdit = true
        await page.locator('#send-btn').click()
        await waitText(page, '.toast', 'Edit failed')
        assert.equal(await page.locator('#message-input').inputValue(), 'Changed on web', 'failed edit retains draft')
        failEdit = false
        await page.locator('#send-btn').click()
        await waitText(page, `.chat__message[data-id="${id(8)}"]`, 'Changed on web')
        assert((await row(page, 8).textContent()).includes('edited'))
        await row(page, 8).locator('.chat__message-text').click({ button: 'right' })
        await page.locator('#selection-more').click()
        await page.getByRole('button', { name: 'Pin', exact: true }).click()
        await waitText(page, '#pin-snippet', 'Changed on web')
        await page.locator('#pin-open').click()
        await page.locator('#pin-unpin').click()
        await page.waitForFunction(() => document.querySelector('#pin-banner').getAttribute('aria-hidden') === 'true')
        io.emit('typing', { userId: OTHER, typing: true })
        await waitText(page, '#nav-status', 'typing…')
        await visible(page, '.chat__typing')
        await page.waitForFunction(() => document.querySelector('#nav-status').textContent !== 'typing…', undefined, { timeout: 8000 })
        io.emit('typing', { userId: OTHER, typing: true })
        const incoming = { ...messages[1], id: id(900), createdAt: new Date().toISOString(), content: 'Incoming clears typing' }
        messages.push(incoming); io.emit('message:new', incoming)
        await waitText(page, `div[data-id="${incoming.id}"]`, incoming.content)
        assert.notEqual(await page.locator('#nav-status').textContent(), 'typing…')
        await page.locator('#message-input').fill('typing test')
        await page.locator('#message-input').fill('typing test again')
        const trueEvents = events.filter(([e, data]) => e === 'typing' && data.typing)
        assert(trueEvents.length >= 1)
        await page.locator('#message-input').fill('')
        assert(events.some(([e, data]) => e === 'typing' && !data.typing))
        await visible(page, '.chat__link-preview--wide')
        assert.equal(await page.locator('.chat__link-preview[href="javascript:alert(1)"]').count(), 0)
        assert.equal(await page.locator('.chat__link-preview script').count(), 0)
        assert.equal(previewRequests.filter((url) => url.includes('spotify')).length <= 1, true)
        await row(page, 4).locator('a').first().click({ button: 'right' })
        assert.equal(await page.evaluate(() => window.__copied), 'https://shirt.online/')
        await row(page, 4).locator('a[href^="tel:"]').click({ button: 'right' })
        assert.equal(await page.evaluate(() => window.__copied), '+91 98765-43210')
        if (width === 1280) {
          await row(page, 8).hover()
          await row(page, 8).getByRole('button', { name: 'Reply', exact: true }).click()
          await visible(page, '#reply-bar')
          assert.equal(await page.evaluate(() => document.activeElement.id), 'message-input')
          await page.keyboard.press('Escape')
          await row(page, 8).locator('.chat__message-text').hover()
          await page.mouse.down()
          await page.waitForFunction(() => document.querySelector('#selection-count').textContent === '1')
          await page.mouse.up()
          await page.keyboard.press('Escape')
          await page.waitForTimeout(650)
        }
        await row(page, 2).locator('.chat__message-text').click({ button: 'right' })
        await page.locator('#selection-more').click()
        const downloadEvent = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Save a copy', exact: true }).click()
        const download = await downloadEvent
        assert.equal(download.suggestedFilename(), 'one-on-one-messages.txt')
        await row(page, 2).locator('.chat__message-text').click({ button: 'right' })
        await page.locator('#selection-more').click()
        await page.getByRole('button', { name: 'Report message', exact: true }).click()
        await visible(page, '.report-dialog__reason')
        await page.getByRole('button', { name: 'Report', exact: true }).click()
        await waitText(page, '.toast', 'has been reported')
        await page.locator('#menu-btn').click()
        await page.getByRole('button', { name: 'Search', exact: true }).click()
        await page.locator('#search-input').fill('hey')
        await waitText(page, '#search-count', '2/2')
        await page.locator('#search-close').click()
        await row(page, 3).locator('.chat__message-text').click({ button: 'right' })
        await page.locator('#selection-delete').click()
        failDelete = true
        await page.locator('[data-delete]').click()
        await waitText(page, '.toast', 'Delete failed')
        assert(!(await row(page, 3).textContent()).includes('This message was deleted'))
        failDelete = false
        await page.locator('[data-delete]').click()
        await waitText(page, `.chat__message[data-id="${id(3)}"]`, 'This message was deleted')
        assert((await row(page, 5).locator('.chat__quote').textContent()).includes('This message was deleted'))
        assert.equal(await row(page, 3).locator('.chat__hover-actions, .chat__reaction-chip').count(), 0)
        const alarm = { ...incoming, id: id(901), type: 'alarm', content: '', payload: null }
        messages.push(alarm); io.emit('message:new', alarm)
        await visible(page, '#alarm-acknowledge')
        assert(await page.locator('.chat--alarm').count())
        await page.reload()
        await visible(page, '#alarm-acknowledge')
        assert(!events.some(([e, data]) => e === 'message:send' && data.type === 'alarm' && data.payload?.ack === alarm.id), 'opening the chat does not acknowledge an alarm')
        await page.locator('#alarm-acknowledge').click()
        await page.waitForFunction(() => !document.querySelector('.chat--alarm'))
        assert(events.some(([e, data]) => e === 'message:send' && data.type === 'alarm' && data.payload.ack === alarm.id))
        assert.equal(await page.locator('.chat__load-older').count(), 0)
        await page.waitForFunction(() => [...document.querySelectorAll('.chat__strip[aria-hidden="true"]')].every((strip) => strip.getBoundingClientRect().height < 1))
        for (const theme of ['light', 'dark']) for (const wallpaper of ['off', 'love', 'samurai']) {
          await page.evaluate(({ theme, wallpaper }) => {
            const chat = document.querySelector('.chat'); chat.dataset.theme = theme
            chat.classList.toggle('chat--wallpaper-love', wallpaper === 'love'); chat.classList.toggle('chat--wallpaper-samurai', wallpaper === 'samurai')
          }, { theme, wallpaper })
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${theme} ${wallpaper}: document overflow`)
          assert(await page.evaluate(() => { const log = document.querySelector('#chat-log'); return log.scrollWidth <= log.clientWidth }), `${width} ${theme} ${wallpaper}: log overflow`)
          await page.screenshot({ path: join(screenshotDir, `${engine}-${width}-${theme}-${wallpaper}.png`) })
        }
        assert.deepEqual(errors, [], 'no page exceptions')
        // A reconnect must catch changed records AND every page of new messages.
        for (const socket of io.sockets.sockets.values()) socket.conn.close()
        Object.assign(messages.find((m) => m.id === id(8)), { content: 'Edited while offline', editedAt: new Date().toISOString() })
        const missed = Array.from({ length: 55 }, (_, i) => ({ ...incoming, id: id(2000 + i), content: `Missed ${i}`, createdAt: new Date(Date.now() + i + 20).toISOString() }))
        messages.push(...missed)
        await waitText(page, `.chat__message[data-id="${id(8)}"]`, 'Edited while offline')
        await page.waitForFunction(() => [...document.querySelectorAll('.chat__message-text')].filter((el) => el.textContent.startsWith('Missed ')).length === 55)
        assert.equal(await page.locator(`.chat__message[data-id="${id(8)}"]`).count(), 1)
        // Full-page paging, an unloaded pin, reminder persistence, and reduced motion.
        reset(true)
        await page.reload()
        await waitText(page, '#nav-status', 'in chat')
        await visible(page, '.chat__load-older')
        assert.equal(await page.locator('.chat__message').count(), 50)
        const oldPin = { messageId: id(150), pinnedBy: OTHER, pinnedAt: new Date().toISOString() }
        io.emit('pin:update', oldPin)
        await page.locator('#pin-open').click()
        await visible(page, `.chat__message[data-id="${id(150)}"]`)
        assert.equal(await page.locator('.chat__message').count(), 61)
        assert.equal(await page.locator('.chat__load-older').count(), 0)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await row(page, 3).locator('.chat__message-text').dblclick()
        assert.equal(await page.locator('.chat__quick-reactions').evaluate((el) => getComputedStyle(el).animationName), 'none')
        await page.keyboard.press('Escape')
        await page.evaluate(() => localStorage.setItem('notificationReminderAt', '0'))
        await page.reload()
        await visible(page, '.modal-panel')
        assert((await page.locator('.modal-panel').textContent()).includes('Turn on notifications?'))
        await page.getByRole('button', { name: 'Not now', exact: true }).click()
        assert(Number(await page.evaluate(() => localStorage.getItem('notificationReminderAt'))) > Date.now() - 10_000)
        await page.reload()
        await waitText(page, '#nav-status', 'in chat')
        assert.equal(await page.locator('.modal-panel').count(), 0)
        reset(false, null)
        await page.reload()
        await visible(page, '.modal-panel')
        assert((await page.locator('.modal-panel').textContent()).includes('What would you like to call this person?'))
        assert.equal(await page.locator('.chat').count(), 1)
        await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill('New nickname')
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await waitText(page, '#nav-title', 'New nickname')
        await context.close()
        console.log(`PASS ${engine} ${width}px: contract interactions, failure drafts, layouts, both themes/all wallpapers`)
      }
    } finally { await browser.close() }
  }
  console.log(`Screenshots: ${screenshotDir}`)
} finally {
  await vite.close()
  await new Promise((resolve) => io.close(resolve))
  api.close()
}
