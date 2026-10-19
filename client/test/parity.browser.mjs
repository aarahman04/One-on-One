// Isolated browser check: real client + Socket.IO, scripted contract data, no account or deployed writes.
// Run with Playwright installed, or set PLAYWRIGHT_MODULE to its index.mjs; requires backend npm ci.
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer as createViteServer } from 'vite'
import { ownerFeedbackChecks } from './ownerFeedback.browser.mjs'

const { Server } = createRequire(new URL('../../backend/package.json', import.meta.url))('socket.io')
const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const screenshotDir = new URL(process.env.PARITY_OWNER_FEEDBACK_ONLY ? '../../docs/ui-web-owner-feedback/' : '../../docs/ui-web-android-parity/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
await mkdir(screenshotDir, { recursive: true })
const ME = 'me'
const OTHER = 'other'
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let messages
let connection
let events
let previewRequests
let failEdit = false
let failDelete = false
let failUpload = false
let uploadDelay = 0
let avatars = { mine: null, other: null }
const ownerState = { failDeleteAccount: false, failAlarmAck: false, alarmAckDelay: 0 }
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
  const url = new URL(req.url, 'http://fixture')
  res.setHeader('Content-Type', 'application/json')
  if (url.pathname === '/api/me') {
    if (req.method !== 'DELETE') res.end(JSON.stringify({ connectionCode: 'ABCDEFGH' }))
    else if (ownerState.failDeleteAccount) res.writeHead(500).end(JSON.stringify({ error: 'Delete failed (fixture)' }))
    else res.writeHead(204).end()
  }
  else if (url.pathname === '/api/me/avatars') res.end(JSON.stringify(avatars))
  else if (url.pathname === '/api/me/avatar') {
    avatars.mine = req.method === 'DELETE' ? null : '/stickers/packs/Shapes/01_circle.webp'
    res.writeHead(req.method === 'DELETE' ? 204 : 200).end(req.method === 'DELETE' ? '' : JSON.stringify({ avatarId: 'fixture-avatar' }))
  }
  else if (url.pathname === '/api/gifs') res.end(JSON.stringify({ results: [{ id: 'fixtureGif', title: 'Hello GIF', previewUrl: 'https://media.giphy.com/fixture.gif', width: 320, height: 240 }], next: null }))
  else if (url.pathname.endsWith('/gifs') || url.pathname.endsWith('/attachments')) {
    const bytes = []; for await (const chunk of req) bytes.push(chunk)
    events.push(['upload', { path: url.pathname, mime: req.headers['content-type'], size: Buffer.concat(bytes).length }])
    if (uploadDelay) await new Promise((resolve) => setTimeout(resolve, uploadDelay))
    if (failUpload) { res.writeHead(502).end(JSON.stringify({ error: 'Upload failed (fixture)' })); return }
    res.writeHead(201).end(JSON.stringify({ path: 'chat/fixture.webp', mime: url.pathname.endsWith('/gifs') ? 'image/gif' : req.headers['content-type'], size: Math.max(1, Buffer.concat(bytes).length), width: 320, height: 240 }))
  }
  else if (url.pathname.endsWith('/attachments/signed')) res.end(JSON.stringify({ urls: { 'chat/fixture.webp': '/stickers/vectors/sticker_cat_happy.svg' } }))
  else if (url.pathname === '/api/connections/current') res.end(JSON.stringify({ connection }))
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
  socket.on('presence', (data) => events.push(['presence', data]))
  socket.on('message:send', (data, ack) => {
    events.push(['message:send', data])
    if (data.type === 'alarm' && data.payload?.ack && ownerState.failAlarmAck) { setTimeout(() => ack({ error: 'Ack failed (fixture)' }), ownerState.alarmAckDelay); return }
    const message = { id: id(1000 + messages.length), senderId: ME, createdAt: new Date().toISOString(), type: data.type, content: data.content, payload: data.payload, replyTo: data.replyTo, tempId: data.tempId, reactions: [], editedAt: null, deletedAt: null }
    messages.push(message)
    if (data.type === 'alarm' && data.payload?.ack && ownerState.alarmAckDelay) setTimeout(() => update('message:new', message, ack), ownerState.alarmAckDelay)
    else update('message:new', message, ack)
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
  plugins: [{ name: 'isolated-auth', enforce: 'pre', configureServer(server) {
    server.middlewares.use('/fixture-setup.js', (_req, res) => { res.setHeader('Content-Type', 'text/javascript'); res.end("localStorage.setItem('ageVerified:fixture','1');localStorage.setItem('termsAcceptedAt:fixture','fixture');localStorage.setItem('notificationReminderAt',String(Date.now()))") })
  }, transformIndexHtml(html) { return html.replace("connect-src 'self'", `connect-src 'self' ${apiOrigin} ${apiOrigin.replace('http:', 'ws:')}`).replace('</head>', process.env.PARITY_MANUAL ? '<script src="/fixture-setup.js"></script></head>' : '</head>') }, transform(_code, moduleId) {
    if (moduleId.replaceAll('\\', '/').endsWith('/src/services/supabaseClient.ts')) return "export const supabase = {auth:{getSession:async()=>({data:{session:{access_token:'fixture',user:{id:new URLSearchParams(location.search).get('owner')||'fixture'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({})}}"
    if (_code.includes('import.meta.env.VITE_API_URL')) return _code.replaceAll('import.meta.env.VITE_API_URL', JSON.stringify(apiOrigin))
  } }], server: { host: '127.0.0.1', port: 0, hmr: false },
})
await vite.listen()
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
if (process.env.PARITY_MANUAL) {
  connection.pinnedMessageId = null
  avatars.other = '/stickers/packs/Shapes/01_circle.webp'
  messages = [true, true, false, false].map((sticker, i) => ({ id: id(3001 + i), senderId: i % 2 ? OTHER : ME, content: '', createdAt: new Date(Date.now() - (4 - i) * 1000).toISOString(), type: 'image', payload: { path: 'chat/fixture.webp', mime: sticker ? 'image/webp' : 'image/jpeg', size: 1000, width: sticker ? 512 : 200, height: sticker ? 512 : 300, url: '/stickers/packs/Shapes/01_circle.webp' }, replyTo: null, reactions: [] }))
  console.log(`Manual contract fixture: ${origin}`)
  await new Promise(() => {})
}
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
const mediaChecks = async (page, width, engine) => {
  reset()
  messages = []
  const local = '/stickers/packs/Shapes/01_circle.webp'
  for (const [n, senderId, sticker] of [[3001, ME, true], [3002, OTHER, true], [3003, ME, false], [3004, OTHER, false]]) messages.push({ id: id(n), senderId, content: '', createdAt: new Date(Date.now() - (3005 - n) * 1000).toISOString(), type: 'image', payload: { path: 'chat/fixture.webp', mime: sticker ? 'image/webp' : 'image/jpeg', size: 1000, width: sticker ? 512 : 200, height: sticker ? 512 : 300, url: sticker ? '/stickers/vectors/sticker_cat_happy.svg' : '/love.jpg' }, replyTo: null, reactions: [] })
  connection.pinnedMessageId = null; avatars.other = local
  const initialMedia = [...messages]
  for (const theme of ['dark', 'light']) {
    messages = initialMedia.map((m) => ({ ...m })); events = []
    await page.evaluate((theme) => { localStorage.setItem('appearancePreview', JSON.stringify({ theme })); localStorage.setItem('notificationReminderAt', String(Date.now())) }, theme)
    await page.reload(); await visible(page, '#sticker-btn'); await page.locator('#splash').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.querySelector('#nav-avatar img')?.complete)
    assert.equal(await page.locator('[data-sticker]').count(), 2)
    await row(page, 3001).locator('.chat__meta').click()
    await page.waitForFunction((selector) => document.querySelector(selector)?.classList.contains('chat__message--expanded'), `.chat__message[data-id="${id(3001)}"]`)
    assert(/\n\d{1,2}:\d{2} (AM|PM)/.test(await row(page, 3001).locator('.chat__message-full-time').textContent()))
    await row(page, 3001).locator('.chat__meta').click()
    for (const n of [3001, 3002, 3003, 3004]) {
      const r = row(page, n), mine = [3001, 3003].includes(n)
      assert.equal(await r.getAttribute('data-meta-side'), mine ? 'right' : 'left')
      await r.locator('img').evaluate((img) => img.decode())
      const body = await r.locator('.chat__message-body').boundingBox(), pill = await r.locator('.chat__meta').boundingBox()
      assert(pill.x >= body.x - 1 && pill.x + pill.width <= body.x + body.width + 1, 'meta stays inside horizontal bubble bounds')
      if (n < 3003) assert.equal(Math.round(body.width), 150)
      else assert.equal(await r.locator('.image-bubble__media > .chat__meta').count(), 1)
    }
    await page.screenshot({ path: join(screenshotDir, `${engine}-${width}-${theme}-media.png`) })
    for (const [n, label] of [[3001, 'sent-sticker'], [3002, 'received-sticker'], [3003, 'sent-photo'], [3004, 'received-photo']]) {
      await row(page, n).scrollIntoViewIfNeeded()
      await row(page, n).screenshot({ path: join(screenshotDir, `${engine}-${width}-${theme}-${label}.png`) })
    }
    await page.locator('#sticker-btn').click(); await visible(page, '.sticker-tile img')
    assert.deepEqual(await page.locator('[data-stickers] h3').allTextContents(), ['Favourites', 'Recent', 'My stickers', 'Cats', 'IT', 'Life', 'Little signals', 'Nature', 'Shapes'])
    assert.equal(await page.locator('.sticker-tile img').count(), 91)
    await page.locator('.sticker-grid[aria-label="Shapes"]').getByRole('button', { name: 'Bubbles', exact: true }).press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close', 'hidden picker inputs cannot break the dialog focus trap')
    await page.getByRole('tab', { name: 'Stickers', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.modal-overlay--closing') && [...document.querySelectorAll('.modal-panel')].every((el) => el.getAnimations().length === 0))
    await page.screenshot({ path: join(screenshotDir, `${engine}-${width}-${theme}-sticker-sheet.png`) })
    assert(await page.locator('.media-picker').evaluate((el) => el.scrollWidth <= el.clientWidth), 'picker content fits its padded dialog')
    const cat = page.locator('[data-stickers]').getByRole('button', { name: 'Happy cat', exact: true })
    await cat.click({ button: 'right' }); await page.getByRole('button', { name: 'Favourite', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-stickers] .sticker-grid')?.querySelectorAll('img').length === 1)
    await page.locator('.sticker-grid[aria-label="Cats"]').getByRole('button', { name: 'Grumpy cat', exact: true }).click({ button: 'right' })
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm delete', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.sticker-tile[aria-label="Grumpy cat"]'))
    assert.equal(await page.evaluate(async () => (await (await import('/src/features/stickerLibrary.ts')).loadStickers('me')).length), 90, 'deleted built-ins are not reseeded')
    await page.getByRole('button', { name: 'Make a sticker', exact: true }).click()
    await page.locator('[data-photo]').setInputFiles(new URL('../public/love.jpg', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
    await page.getByRole('button', { name: 'Place crop', exact: true }).waitFor({ state: 'visible' })
    await page.waitForFunction(() => !document.querySelector('[data-next]').disabled)
    const handle = page.locator('[data-handle="0"]'), h = await handle.boundingBox()
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x + 45, h.y + 40); await page.mouse.up()
    assert.notEqual(await page.locator('.sticker-maker__crop').evaluate((el) => el.style.left), '0%')
    await page.waitForFunction(() => !document.querySelector('.modal-overlay--closing') && [...document.querySelectorAll('.modal-panel')].every((el) => el.getAnimations().length === 0))
    await page.screenshot({ path: join(screenshotDir, `${engine}-${width}-${theme}-maker-crop.png`) })
    await page.getByRole('button', { name: 'Cut-out', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('[data-cut]').disabled, undefined, { timeout: 60_000 })
    const cutError = await page.locator('.sticker-maker .media-error').textContent()
    assert(!/failed|fetch|compile|encode|WebAssembly|not allowed|model|graph/i.test(cutError), `local model inference: ${cutError}`)
    console.log(`MediaPipe ${engine} ${width}px ${theme}: ${cutError || 'cut-out succeeded'}`)
    await page.getByRole('button', { name: 'Original', exact: true }).click()
    await page.getByRole('button', { name: 'Place crop', exact: true }).click()
    await page.locator('.sticker-maker__zoom input').fill('1.5')
    await page.getByRole('button', { name: 'Save sticker', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.sticker-maker'))
    await page.locator('.sticker-grid[aria-label="My stickers"]').getByRole('button', { name: 'My sticker', exact: true }).waitFor()
    await page.getByRole('tab', { name: 'GIFs', exact: true }).click(); await visible(page, '.gif-grid button')
    await page.locator('.gif-grid img').evaluate((img) => img.decode())
    assert.equal(await page.getByText('Powered by GIPHY').count(), 1)
    await page.waitForFunction(() => !document.querySelector('.modal-overlay--closing') && [...document.querySelectorAll('.modal-panel')].every((el) => el.getAnimations().length === 0))
    await page.screenshot({ path: join(screenshotDir, `${engine}-${width}-${theme}-gif-tab.png`) })
    uploadDelay = 700
    await page.getByRole('button', { name: 'Hello GIF', exact: true }).click()
    await visible(page, '[data-uploading]')
    await page.locator('#message-input').fill('Text during upload'); await page.locator('#send-btn').click()
    assert.notEqual(await page.locator('#mic-btn').evaluate((el) => getComputedStyle(el).display), 'none', 'composer swap uses opacity/slide, not display toggles')
    await waitText(page, '.chat__message-text', 'Text during upload')
    await page.waitForFunction(() => !document.querySelector('[data-uploading]'))
    assert(events.some(([event, data]) => event === 'message:send' && data.payload?.mime === 'image/gif'))
    await page.locator('#sticker-btn').click(); await visible(page, '.sticker-tile img')
    await page.locator('.sticker-grid[aria-label="My stickers"]').getByRole('button', { name: 'My sticker', exact: true }).click()
    await visible(page, '[data-uploading][data-sticker]'); await page.waitForFunction(() => !document.querySelector('[data-uploading]'))
    const send = events.findLast(([event, data]) => event === 'message:send' && data.payload?.mime === 'image/webp')?.[1]
    assert(send); assert.equal(send.payload.width, 512); assert.equal(send.payload.height, 512); assert(send.payload.size <= 100_000); assert(!('localUrl' in send.payload))
    // Upload failure stays visible in the chat and is locally discardable.
    failUpload = true
    await page.locator('#sticker-btn').click(); await visible(page, '.sticker-tile img')
    await page.locator('.sticker-grid[aria-label="My stickers"]').getByRole('button', { name: 'My sticker', exact: true }).click()
    await waitText(page, '.toast', 'Upload failed')
    await page.locator('.toast').filter({ hasText: 'Upload failed' }).last().click()
    await page.waitForFunction(() => ![...document.querySelectorAll('.toast')].some((el) => el.textContent.includes('Upload failed')))
    assert.equal(await page.locator('.media-picker').count(), 0)
    await page.locator('.chat__message--failed .chat__discard').click()
    assert.equal(await page.locator('.chat__message--failed').count(), 0)
    failUpload = false; uploadDelay = 0
    // A sticker reply keeps the ordinary quote bubble.
    await row(page, 3004).locator('img').click({ button: 'right' })
    await page.locator('#selection-reply').click()
    uploadDelay = 700
    await page.locator('#sticker-btn').click(); await visible(page, '.sticker-tile img')
    await page.locator('.sticker-grid[aria-label="Cats"]').getByRole('button', { name: 'Happy cat', exact: true }).click()
    await visible(page, '[data-uploading] .chat__quote')
    assert.equal(await page.locator('[data-uploading][data-sticker]').count(), 0)
    await page.waitForFunction(() => !document.querySelector('[data-uploading]'))
    assert(events.some(([event, data]) => event === 'message:send' && data.payload?.mime === 'image/webp' && data.replyTo === id(3004)))
    // A real MediaRecorder over the browser's fake microphone exercises the recording/send path.
    await page.locator('#mic-btn').click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#composer')?.dataset.recording === 'true')
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: 'Stop recording and send', exact: true }).click()
    await visible(page, '[data-uploading][data-type="voice"]')
    assert(await page.locator('[data-uploading] .voice-bubble__time').textContent())
    await page.locator('#message-input').fill('Text during voice upload'); await page.locator('#send-btn').click()
    await waitText(page, '.chat__message-text', 'Text during voice upload')
    await page.waitForFunction(() => !document.querySelector('[data-uploading]'))
    assert(events.some(([event, data]) => event === 'message:send' && data.type === 'voice' && data.payload.duration >= 1))
    uploadDelay = 0
    await page.locator('#menu-btn').click(); await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Choose photo', exact: true }).click()
    await page.locator('.profile-settings input').setInputFiles(new URL('../public/love.jpg', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
    await page.waitForFunction(() => document.querySelector('#nav-avatar img')?.src.startsWith('blob:'))
    assert((await page.locator('.call-screen__avatar img').getAttribute('src')).startsWith('blob:'), 'private photo also reaches call screen')
    await page.getByRole('button', { name: 'Upload photo', exact: true }).click()
    await page.locator('.profile-settings input').setInputFiles(new URL('../public/love.jpg', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
    await page.waitForFunction(() => document.querySelector('.profile-settings__avatar img')?.complete)
    await page.getByRole('button', { name: 'Remove photo', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.profile-settings__avatar img'))
    await page.getByRole('button', { name: 'Remove private photo', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#nav-avatar img')?.getAttribute('src') === '/stickers/packs/Shapes/01_circle.webp')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await row(page, 3003).locator('img').click({ button: 'right' }); await page.locator('#selection-delete').click()
    await page.locator('[data-delete]').click(); await waitText(page, `.chat__message[data-id="${id(3003)}"]`, 'This message was deleted')
    assert.equal(await row(page, 3003).locator('.chat__meta').evaluate((el) => getComputedStyle(el).position), 'static', 'deleted media keeps the ordinary tombstone footer')
    const cleared = await page.evaluate(async () => {
      const lib = await import('/src/features/stickerLibrary.ts'), list = await lib.loadStickers('me'), stamp = lib.mediaEpoch()
      await (await import('/src/services/authService.ts')).signOut({ skipPush: true })
      let rejected = false; try { await lib.saveSticker(list[0], stamp) } catch { rejected = true }
      const reseeded = await lib.loadStickers('me'), other = await lib.loadStickers('different-account')
      return rejected && reseeded.length === 91 && other.length === 91 && !reseeded.some((s) => s.favourite || s.used || !s.pack)
    })
    assert(cleared, 'clearing removes personal data and rejects late saves')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'media layout has no horizontal overflow')
  }
}
try {
  for (const engine of browsers) {
    const browser = await (engine === 'edge' || engine === 'chrome' ? playwright.chromium : playwright[engine]).launch({ ...(engine === 'edge' ? { channel: 'msedge' } : engine === 'chrome' ? { channel: 'chrome' } : {}), ...(engine !== 'firefox' ? { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } : {}) })
    try {
      for (const width of [1280, 360]) {
        reset()
        const context = await browser.newContext({ viewport: { width, height: 820 }, permissions: ['microphone'], hasTouch: width === 360, ...(engine !== 'firefox' ? { isMobile: width === 360 } : {}), serviceWorkers: 'block' })
        await context.addInitScript(() => {
          localStorage.setItem('ageVerified:fixture', '1'); localStorage.setItem('termsAcceptedAt:fixture', 'fixture')
          if (!localStorage.getItem('notificationReminderAt')) localStorage.setItem('notificationReminderAt', String(Date.now()))
          window.__copied = ''
          Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied = text } } })
        })
        const page = await context.newPage()
        page.setDefaultTimeout(10_000)
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.route('**/*', (route) => route.request().url() === 'https://media.giphy.com/fixture.gif' ? route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAgABAIAAAAAAAP///yH5BAEAAAAALAAAAAACAAEAAAICRAEAOw==', 'base64') }) : route.request().url().startsWith(origin) || route.request().url().startsWith(apiOrigin) ? route.continue() : route.abort())
        if (process.env.PARITY_MEDIA_ONLY) {
          await page.goto(origin); await mediaChecks(page, width, engine)
          assert.deepEqual(errors, [], 'media has no page exceptions')
          await context.close(); console.log(`PASS media ${engine} ${width}px both themes`); continue
        }
        await page.goto(origin)
        await waitText(page, '#nav-status', 'in chat')
        if (process.env.PARITY_OWNER_FEEDBACK_ONLY) {
          await ownerFeedbackChecks({ page, width, engine, origin, screenshotDir, io, id, row, ownerState, messages, events, disconnect: () => { connection = null } })
          assert.deepEqual(errors, [], 'owner feedback has no page exceptions')
          await context.close(); console.log(`PASS owner feedback ${engine} ${width}px both themes`); continue
        }
        if (process.env.PARITY_PRESENCE_ONLY) {
          const waitPresence = async (active, after = 0) => {
            for (let i = 0; i < 100; i++) {
              if (events.slice(after).some(([event, data]) => event === 'presence' && data.active === active)) return
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
            assert.fail(`Missing presence active=${active}`)
          }
          await waitPresence(true)
          io.emit('presence', { userId: OTHER, online: false, lastSeenAt: new Date(Date.now() - 60_000).toISOString() })
          await waitText(page, '#nav-status', 'Last seen')
          await page.waitForTimeout(4200)
          assert.match(await page.locator('#nav-status').textContent(), /Last seen/)
          io.emit('presence', { userId: OTHER, online: true, lastSeenAt: null })
          await waitText(page, '#nav-status', 'in chat')
          let after = events.length
          await page.evaluate(() => window.dispatchEvent(new Event('blur')))
          await waitPresence(false, after)
          after = events.length
          await page.evaluate(() => window.dispatchEvent(new Event('focus')))
          await waitPresence(true, after)
          after = events.length
          await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
            document.dispatchEvent(new Event('visibilitychange'))
          })
          await waitPresence(false, after)
          await page.evaluate(() => {
            delete document.visibilityState
            document.dispatchEvent(new Event('visibilitychange'))
          })
          after = events.length
          for (const socket of io.sockets.sockets.values()) socket.conn.close()
          await waitPresence(true, after)
          assert.deepEqual(errors, [], 'presence has no page exceptions')
          await context.close(); console.log(`PASS presence ${engine} ${width}px`); continue
        }
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
        await mediaChecks(page, width, engine)
        assert.deepEqual(errors, [], 'media has no page exceptions')
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
