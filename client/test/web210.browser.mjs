// Real browser UI + real §12 Socket.IO handlers/rules; disposable authenticated fixture, no production writes.
// Run with node --import ../backend/node_modules/tsx/dist/loader.mjs test/web210.browser.mjs. PLAYWRIGHT_MODULE can point to an installed playwright/index.mjs.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { createServer as createViteServer } from 'vite'
import { MatchManager, parseClock, parsePoints } from '../../backend/src/games/matches.ts'

const require = createRequire(new URL('../../backend/package.json', import.meta.url)),
  { Server } = require('socket.io')
const playwright = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
)
const screenshots = fileURLToPath(new URL('../../docs/ui-web-2.0.10/', import.meta.url))
await mkdir(screenshots, { recursive: true })
const ids = { connection: '11111111-1111-4111-8111-111111111111', letter: '22222222-2222-4222-8222-222222222222' }
let uploadDelay = 0, failUpload = false
const requests = [],
  events = [],
  errors = []
let speechStatus = 200,
  transcriptionDelay = 0,
  disconnects = 0
const ogg = await readFile(new URL('../public/games/game_end.ogg', import.meta.url))
const api = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'X-Narration-Part,X-Narration-Parts')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  const url = new URL(req.url, 'http://fixture'),
    user = (req.headers.authorization || 'Bearer me').slice(7)
  requests.push([req.method, url.pathname, url.search, user])
  const json = (body) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }
  if (url.pathname === '/api/me')
    json({ userId: user, connectionCode: 'ABCDEFGH', ageVerifiedAt: '2026-10-19', termsAcceptedAt: '2026-10-19' })
  else if (url.pathname === '/api/connections/current')
    json({
      connection: {
        id: ids.connection,
        status: 'active',
        myUserId: user,
        isRequester: user === 'me',
        otherNickname: 'Alex', myNickname: 'My nickname',
        otherLastReadAt: null,
        otherLastDeliveredAt: null,
        wallpaper: 'off',
        messageStyle: 'bubbles',
        pinnedMessageId: null,
        myAvatarId: null,
        otherAvatarId: null,
      },
    })
  else if (url.pathname === '/api/me/avatars') json({ mine: null, other: null })
  else if (url.pathname.endsWith('/messages'))
    json({
      messages: [
        {
          id: ids.letter,
          senderId: 'other',
          type: 'letter',
          content: 'A quiet moment together. Thank you for being here.',
          payload: { from: 'Alex', to: 'You', appearance: 'dawn' },
          createdAt: new Date().toISOString(),
          replyTo: null,
          reactions: [],
        },
      ],
    })
  else if (url.pathname.endsWith('/narration')) {
    if (speechStatus !== 200) {
      res.statusCode = speechStatus
      json({
        error: 'unavailable',
        code: speechStatus === 429 ? 'quota_exceeded' : speechStatus === 404 ? 'not_found' : 'speech_unavailable',
      })
      return
    }
    res.setHeader('Content-Type', 'audio/ogg')
    res.setHeader('X-Narration-Part', url.searchParams.get('part'))
    res.setHeader('X-Narration-Parts', '2')
    res.end(ogg)
  } else if (url.pathname.endsWith('/attachments')) {
    const bytes = []; for await (const chunk of req) bytes.push(chunk)
    if (uploadDelay) await new Promise((r) => setTimeout(r, uploadDelay))
    if (failUpload) { res.statusCode = 502; json({ error: 'Upload failed' }); return }
    res.statusCode = 201; json({ path: `${ids.connection}/fixture.jpg`, mime: req.headers['content-type'], size: Buffer.concat(bytes).length })
  } else if (url.pathname.endsWith('/attachments/signed')) json({ urls: {} })
  else if (url.pathname === '/api/transcribe') {
    let bytes = 0
    for await (const chunk of req) bytes += chunk.length
    assert(bytes > 0)
    assert(req.headers['content-type'].startsWith('audio/'))
    if (transcriptionDelay) await new Promise((r) => setTimeout(r, transcriptionDelay))
    json({ text: 'Hello, world! How are you?', language: 'en', durationMs: 1000 })
  } else if (url.pathname.endsWith('/read')) res.writeHead(204).end()
  else {
    res.statusCode = 404
    json({ error: 'fixture route missing' })
  }
})
const io = new Server(api, { cors: { origin: '*' } })
// Actual server rules/simulation, with fixture identity and no DB, push or speech service.
const manager = new MatchManager({
  emitState: (_id, snapshot) => io.emit('match:state', snapshot),
  emitFrame: (_id, frame) => io.volatile.emit('match:pong', frame),
})
io.on('connection', (socket) => {
  const user = socket.handshake.auth.token, partner = user === 'me' ? 'other' : 'me'
  socket.data.userId = user
  socket.onAny((event, payload) => events.push([event, payload, user]))
  socket.on('disconnect', () => { disconnects++; manager.disconnected(user) })
  socket.on('presence', () => socket.emit('presence', { userId: partner, online: true, lastSeenAt: null }))
  socket.on('message:read', (_p, ack) => ack({ ok: true }))
  socket.on('message:send', (p, ack) => {
    const message = { ...p, id: crypto.randomUUID(), senderId: user, createdAt: new Date().toISOString(), reactions: [] }
    io.emit('message:new', message); ack({ ok: true, message })
  })
  socket.on('match:paddle', (p) => manager.paddle(ids.connection, user, p.matchId, p.x, p.y, p.released))
  for (const action of ['invite', 'accept', 'decline', 'leave', 'resign', 'move', 'draw', 'rematch', 'sync', 'away', 'react']) socket.on(`match:${action}`, (p = {}, ack) => {
    let result
    if (action === 'invite') result = manager.invite(ids.connection, user, partner, p.game, parseClock(p.clock), parsePoints(p.points))
    else if (action === 'leave' || action === 'resign') result = manager.leave(ids.connection, user, p.matchId, action === 'leave' ? 'left' : 'resigned')
    else if (action === 'move') result = manager.move(ids.connection, user, p.matchId, p.seq, p.move)
    else if (action === 'draw') result = manager.draw(ids.connection, user, p.matchId, p.action)
    else if (action === 'sync') result = manager.sync(ids.connection, user)
    else if (action === 'away') result = manager.away(ids.connection, user, p.matchId, p.away)
    else if (action === 'react') { io.emit('match:reaction', { id: String(Date.now()), matchId: p.matchId, from: user, text: p.text }); result = { ok: true, match: null } }
    else result = manager[action](ids.connection, user, p.matchId)
    ack(result)
  })
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const apiOrigin = `http://127.0.0.1:${api.address().port}`
const vite = await createViteServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  configFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify(apiOrigin) },
  plugins: [
    {
      name: 'fixture',
      enforce: 'pre',
      transformIndexHtml(html) {
        return html.replace(
          "connect-src 'self'",
          `connect-src 'self' ${apiOrigin} ${apiOrigin.replace('http:', 'ws:')}`,
        )
      },
      transform(code, path) {
        if (path.replaceAll('\\', '/').endsWith('/src/services/supabaseClient.ts'))
          return `const user=new URLSearchParams(location.search).get('user')||'me';export const supabase={auth:{getSession:async()=>({data:{session:{access_token:user,user:{id:user}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({})}}`
        if (code.includes('import.meta.env.VITE_API_URL'))
          return code.replaceAll('import.meta.env.VITE_API_URL', JSON.stringify(apiOrigin))
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0, hmr: false },
})
await vite.listen()
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
const browser = await playwright.chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
})
const contexts = []
const command = async (page, name) => { await page.locator('#message-input').fill(`/${name}`); await page.locator('#send-btn').click() }
const wait = async (fn, ms = 12000) => {
  const until = Date.now() + ms
  while (Date.now() < until) { if (await fn()) return; await new Promise((r) => setTimeout(r, 30)) }
  assert.fail('condition timed out')
}
const shot = async (p, name) => p.screenshot({ path: join(screenshots, `${name}.png`), animations: 'disabled' })
try {
  for (const width of [1280, 360]) {
    const pages = {}
    for (const user of ['me', 'other']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' })
      contexts.push(context)
      await context.addInitScript(() => {
        localStorage.setItem('notificationReminderAt', String(Date.now()))
        localStorage.setItem('letterFrom', 'Saved signature')
        localStorage.setItem('permissionRationale:microphone', '1')
        window.__spoken = []; window.__cancelled = 0
        Object.defineProperty(window, 'speechSynthesis', { value: { speak: (u) => window.__spoken.push(u.text), cancel: () => window.__cancelled++, pause() {}, resume() {} } })
      })
      await context.route('**/*', (route) => route.request().url().startsWith(origin) || route.request().url().startsWith(apiOrigin) ? route.continue() : route.abort())
      const page = await context.newPage(); pages[user] = page; page.setDefaultTimeout(12000)
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${origin}?user=${user}`)
      await page.locator('#message-input').waitFor(); await page.locator('#splash').waitFor({ state: 'hidden' })
    }
    const page = pages.me, other = pages.other
    const invite = async (title) => {
      await command(page, 'games')
      assert.equal(await page.getByRole('button', { name: 'Dots & Boxes', exact: true }).count(), 0)
      await page.getByRole('button', { name: title, exact: true }).click()
      await page.getByRole('button', { name: 'Invite Alex', exact: true }).click()
      await other.getByRole('button', { name: 'Play', exact: true }).click()
      await page.locator('.game-surface:not([hidden])').waitFor()
      await other.locator('.game-surface:not([hidden])').waitFor()
    }
    // Dismissing an invite keeps it pending and leaves actions in the chat banner.
    await command(page, 'games'); await page.getByRole('button', { name: 'Reversi', exact: true }).click()
    await page.getByRole('button', { name: 'Invite Alex', exact: true }).click()
    await other.getByText('Alex invites you to play').waitFor(); await other.keyboard.press('Escape')
    assert.equal(manager.get(ids.connection)?.status, 'invited')
    await other.locator('.game-invite').getByRole('button', { name: 'Accept', exact: true }).waitFor()
    await other.locator('#message-input').fill('Still typing')
    assert.equal(manager.get(ids.connection)?.status, 'invited')
    await other.locator('.game-invite').getByRole('button', { name: 'Decline', exact: true }).click()
    await wait(() => manager.get(ids.connection)?.outcome?.reason === 'declined')
    await command(page, 'games'); await page.getByRole('button', { name: 'Chess', exact: true }).click()
    await page.locator('.game-hub select').selectOption('Custom')
    await page.getByRole('spinbutton', { name: 'Time each in seconds', exact: true }).fill('10')
    await page.getByRole('spinbutton', { name: 'Bonus per move in seconds', exact: true }).fill('60')
    await page.getByRole('button', { name: 'Invite Alex', exact: true }).click()
    await other.getByRole('button', { name: 'Not now', exact: true }).waitFor()
    assert.deepEqual(manager.get(ids.connection).clock, { base: 10000, inc: 60000, left: [10000, 10000] })
    await other.locator('.modal-overlay:not(.modal-overlay--closing)').click({ position: { x: 5, y: 5 } })
    assert.equal(manager.get(ids.connection)?.status, 'invited')
    await other.locator('.game-invite').getByRole('button', { name: 'Decline', exact: true }).click()
    await wait(() => manager.get(ids.connection)?.outcome?.reason === 'declined')
    await command(page, 'games'); await page.getByRole('button', { name: 'Ping Pong', exact: true }).click()
    await page.locator('.game-hub select').selectOption('Custom'); await page.getByRole('spinbutton', { name: 'Target score, 1 to 99', exact: true }).fill('99')
    await page.getByRole('button', { name: 'Invite Alex', exact: true }).click()
    await other.getByRole('button', { name: 'Not now', exact: true }).waitFor(); assert.equal(manager.get(ids.connection).points, 99)
    await other.locator('.modal-overlay:not(.modal-overlay--closing) .modal-close').click()
    assert.equal(manager.get(ids.connection)?.status, 'invited')
    await other.locator('.game-invite').getByRole('button', { name: 'Decline', exact: true }).click()
    await wait(() => manager.get(ids.connection)?.outcome?.reason === 'declined')
    await command(page, 'games'); await page.getByRole('button', { name: 'Tic-Tac-Toe', exact: true }).click()
    await page.locator('.game-hub select').selectOption(''); await page.getByRole('button', { name: 'Invite Alex', exact: true }).click()
    await other.getByRole('button', { name: 'Not now', exact: true }).waitFor(); assert.equal(manager.get(ids.connection).clock, null)
    await other.getByRole('button', { name: 'Not now', exact: true }).click()
    await wait(() => manager.get(ids.connection)?.outcome?.reason === 'declined')
    for (const title of ['Chess', 'Tic-Tac-Toe', 'Connect 4', 'Reversi', 'Ping Pong']) {
      await invite(title)
      let m = manager.get(ids.connection), first = pages[m.players[0]]
      if (m.game !== 'pong') assert.equal(await page.locator('.game-clock').count(), 2)
      else assert.equal(await page.locator('.game-clock').count(), 0)
      if (m.game === 'chess') {
        await first.locator('[data-key="e2"]').click(); await first.locator('[data-key="e4"]').click()
        await wait(() => manager.get(ids.connection).seq === 1)
        assert.equal(await first.locator('.chess-square.dark').first().evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(0, 0, 0)')
      } else if (m.game === 'pong') {
        const canvas = page.locator('.game-board--pong canvas'), bounds = await canvas.boundingBox()
        const start = events.length
        await page.mouse.move(bounds.x + 20, bounds.y + 20); await page.mouse.down()
        await page.mouse.move(bounds.x + 70, bounds.y + 70, { steps: 5 }); await page.mouse.up()
        await wait(() => events.slice(start).some(([e, p]) => e === 'match:paddle' && p.released && Number.isFinite(p.y)))
      } else {
        await first.locator('.game-board > button[aria-disabled="false"]').first().click()
        await wait(() => manager.get(ids.connection).seq === 1)
        if (m.game === 'reversi') { await wait(async () => await page.locator('.reversi-disc').count() === 5); assert.equal(await page.locator('.reversi-flip').count(), 1) }
      }
      await page.getByRole('button', { name: 'React to game' }).click()
      const input = page.getByRole('textbox', { name: 'Comment', exact: true })
      await input.fill('👍'.repeat(61)); assert.equal(await input.inputValue(), '👍'.repeat(60))
      await page.getByRole('button', { name: 'Send comment', exact: true }).click()
      await wait(async () => (await other.locator('.game-name small').textContent()) === '👍'.repeat(60))
      assert(await page.locator('.game-reaction-tray').isHidden())
      await page.getByRole('button', { name: 'Offer draw', exact: true }).click()
      await other.getByRole('button', { name: 'Decline', exact: true }).click()
      await page.getByText('Alex declined your draw offer.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Offer draw', exact: true }).click()
      await other.getByRole('button', { name: 'Accept', exact: true }).click()
      await page.getByText('Draw by agreement', { exact: true }).waitFor()
      await shot(page, `${width}-${m.game}`)
      await other.getByRole('button', { name: 'Done', exact: true }).click()
      await page.getByText('Alex has left the game', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Rematch', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Done', exact: true }).click()
    }
    await page.locator('.letter-card').click()
    const narrationBefore = requests.filter(([, path]) => path.endsWith('/narration')).length
    await page.getByRole('button', { name: 'Read letter aloud', exact: true }).click()
    await wait(() => requests.filter(([, path]) => path.endsWith('/narration')).length >= narrationBefore + 2)
    await page.getByRole('button', { name: 'Read letter aloud', exact: true }).waitFor()
    speechStatus = 503
    await page.getByRole('button', { name: 'Read letter aloud', exact: true }).click()
    await page.getByText('Natural voice unavailable, using device voice.', { exact: true }).waitFor()
    await page.keyboard.press('Escape'); speechStatus = 200
    await command(page, 'letter')
    assert.equal(await page.locator('#letter-from').inputValue(), 'My nickname')
    assert.equal(await page.locator('#letter-to').inputValue(), 'Alex')
    const body = 'Hello, world! How are you?\nA second paragraph.'
    await page.locator('#letter-body').fill(body); await page.getByRole('button', { name: 'Next', exact: true }).click()
    const requestsBefore = requests.length
    await page.getByRole('button', { name: 'Read letter aloud', exact: true }).click()
    assert.equal(await page.evaluate(() => window.__spoken.at(-1)), `Dear Alex. ${body}. With love, My nickname.`)
    assert.equal(requests.slice(requestsBefore).filter(([, path]) => path.endsWith('/narration')).length, 0)
    const cancelled = await page.evaluate(() => window.__cancelled)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'))
    })
    assert((await page.evaluate(() => window.__cancelled)) > cancelled)
    await page.getByRole('button', { name: 'Read letter aloud', exact: true }).click()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    assert((await page.evaluate(() => window.__cancelled)) > cancelled)
    assert.equal(await page.locator('#letter-body').inputValue(), body)
    await page.keyboard.press('Escape')
    await command(page, 'audio')
    await wait(async () => /Listening/.test(await page.locator('.voice-typing').innerText()))
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await wait(async () => (await page.locator('#message-input').inputValue()) === 'Hello, world! How are you?')
    await page.locator('#message-input').fill('/check')
    assert.equal(await page.locator('.slash-item').count(), 0)
    await page.locator('#message-input').fill('👨‍👩‍👧‍👦'); await page.locator('#send-btn').click()
    await page.locator('[data-big-emoji="1"] .chat__meta').waitFor()
    // Decode actual canvas bytes: opaque -> JPEG/2048, alpha -> PNG, EXIF handled by one bitmap decode.
    const normalized = await page.evaluate(async () => {
      const { normalizePhoto } = await import('/src/utils/photo.ts')
      const canvas = document.createElement('canvas'); canvas.width = 4096; canvas.height = 2048
      canvas.getContext('2d').fillRect(0, 0, 4096, 2048)
      const input = await new Promise((r) => canvas.toBlob(r, 'image/png'))
      const opaque = await normalizePhoto(input)
      canvas.getContext('2d').clearRect(0, 0, 100, 100)
      const alpha = await normalizePhoto(await new Promise((r) => canvas.toBlob(r, 'image/png')))
      return [opaque.blob.type, opaque.width, opaque.height, alpha.blob.type]
    })
    assert.deepEqual(normalized, ['image/jpeg', 2048, 1024, 'image/png'])
    const orientations = await page.evaluate(async () => {
      const { normalizePhoto } = await import('/src/utils/photo.ts')
      const { readPhoto } = await import('/src/features/stickerMaker.ts')
      const c = document.createElement('canvas'); c.width = 100; c.height = 60
      const ctx = c.getContext('2d'), colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00']
      colors.forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(i % 2 * 50, Math.floor(i / 2) * 30, 50, 30) })
      const bytes = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 1))).arrayBuffer())
      const result = []
      for (let orientation = 1; orientation <= 8; orientation++) {
        const exif = new Uint8Array([255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0])
        const photo = new Blob([bytes.slice(0, 2), exif, bytes.slice(2)], { type: 'image/jpeg' })
        const normalized = await normalizePhoto(photo), avatar = await readPhoto(photo)
        const bitmap = await createImageBitmap(normalized.blob)
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
        const out = canvas.getContext('2d'); out.drawImage(bitmap, 0, 0); bitmap.close()
        const corners = [[3, 3], [canvas.width - 4, 3], [3, canvas.height - 4], [canvas.width - 4, canvas.height - 4]].map(([x, y]) => {
          const [r, g, b] = out.getImageData(x, y, 1, 1).data
          return r > 180 && g > 180 ? 'yellow' : r > 180 ? 'red' : g > 180 ? 'green' : b > 180 ? 'blue' : 'unknown'
        })
        result.push([normalized.width, normalized.height, avatar.width, avatar.height, corners])
      }
      return result
    })
    const corners = [['red','green','blue','yellow'], ['green','red','yellow','blue'], ['yellow','blue','green','red'], ['blue','yellow','red','green'], ['red','blue','green','yellow'], ['blue','red','yellow','green'], ['yellow','green','blue','red'], ['green','yellow','red','blue']]
    assert.deepEqual(orientations, corners.map((c, i) => [...(i < 4 ? [100, 60, 100, 60] : [60, 100, 60, 100]), c]))
    const photoBytes = Buffer.from(await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 120; c.height = 80; c.getContext('2d').fillRect(0, 0, 120, 80)
      return c.toDataURL('image/png').split(',')[1]
    }), 'base64')
    uploadDelay = 700
    await page.locator('#attach-image-input').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: photoBytes })
    await page.locator('[data-uploading="1"] .image-bubble__img--loaded').waitFor()
    await wait(async () => await page.locator('.chat__message[data-type="image"][data-id]').count() > 0)
    await page.locator('.chat__message[data-type="image"] .image-bubble__img').last().click()
    await page.locator('.photo-viewer-overlay').waitFor()
    await page.getByRole('button', { name: 'Zoom photo', exact: true }).click()
    await page.keyboard.press('Escape')
    failUpload = true
    await page.locator('#attach-image-input').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: photoBytes })
    await page.locator('.chat__message--failed .chat__upload-status').waitFor()
    failUpload = false; uploadDelay = 0
    await shot(page, `${width}-photo-upload-failure`)
    uploadDelay = 700
    const sendsBefore = events.filter(([e]) => e === 'message:send').length
    await page.locator('#attach-image-input').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: photoBytes })
    await page.locator('[data-uploading="1"]').last().waitFor()
    await page.evaluate(async () => (await import('/src/features/stickerLibrary.ts')).clearLocalMedia())
    await page.waitForTimeout(850)
    assert.equal(events.filter(([e]) => e === 'message:send').length, sendsBefore, 'an upload retired by sign-out must never send')
    uploadDelay = 0
    for (let i = 0; i < 20; i++) io.emit('message:new', { id: `scroll-${width}-${i}`, senderId: 'other', createdAt: new Date(Date.now() + i).toISOString(), type: 'text', content: 'Reading older messages. '.repeat(30), payload: null, reactions: [] })
    await page.locator(`[data-id="scroll-${width}-19"]`).waitFor()
    await page.locator('#chat-log').evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
    await page.getByRole('button', { name: 'Scroll to latest messages', exact: true }).click()
    await wait(async () => page.locator('#chat-log').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop < 80))
    io.emit('message:new', { id: `pinned-${width}`, senderId: 'other', createdAt: new Date(Date.now() + 100).toISOString(), type: 'text', content: 'Still at the latest message.', payload: null, reactions: [] })
    await page.locator(`[data-id="pinned-${width}"]`).waitFor()
    await wait(async () => page.locator('#chat-log').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop < 80))
    assert.equal(await page.getByRole('button', { name: 'View profile photo', exact: true }).count(), 1)
    const brush = await page.evaluate(async () => {
      const { brushSticker } = await import('/src/utils/stickerBrush.ts')
      const original = document.createElement('canvas'); original.width = original.height = 32
      original.getContext('2d').fillRect(0, 0, 32, 32)
      const erased = brushSticker(original, original, [{ points: [{ x: 16, y: 16 }], radius: 4, restore: false }])
      const restored = brushSticker(erased, original, [{ points: [{ x: 16, y: 16 }], radius: 4, restore: true }])
      return [original, erased, restored].map((c) => c.getContext('2d').getImageData(16, 16, 1, 1).data[3])
    })
    assert.deepEqual(brush, [255, 0, 255])
    // Exercise the actual manual editor without downloading/running any model.
    await page.evaluate(async () => {
      const { openStickerMaker } = await import('/src/features/stickerMaker.ts')
      const c = document.createElement('canvas'); c.width = c.height = 64; c.getContext('2d').fillRect(0, 0, 64, 64)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      openStickerMaker('me', new File([blob], 'fixture.png', { type: 'image/png' }), () => {})
    })
    await page.getByRole('button', { name: 'Cut-out', exact: true }).click()
    await page.getByRole('button', { name: 'Erase', exact: true }).click()
    await page.getByRole('slider', { name: 'Brush distance', exact: true }).fill('0')
    const canvas = page.locator('.sticker-maker canvas'), bounds = await canvas.boundingBox()
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.getByRole('button', { name: 'Undo brush stroke' }).click()
    await page.getByRole('button', { name: 'Redo brush stroke' }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await shot(page, `${width}-manual-sticker`)
    await page.keyboard.press('Escape')
    const callChecks = await page.evaluate(async () => {
      const { mountCallBar } = await import('/src/features/call/controller.ts')
      const { ensurePermissionRationale } = await import('/src/features/permissionRationale.ts')
      for (const kind of ['microphone', 'camera']) {
        const permission = ensurePermissionRationale(kind)
        document.querySelector('.modal-overlay:not(.modal-overlay--closing) #perm-go')?.click(); await permission
      }
      const tick = () => new Promise((r) => setTimeout(r, 20))
      const listeners = {}, ends = []
      let resolveInvite, resolveAccept
      const subscribe = (key, callback) => { listeners[key] = callback; return () => { delete listeners[key] } }
      const transport = {
        invite: () => new Promise((r) => { resolveInvite = r }), accept: () => new Promise((r) => { resolveAccept = r }),
        end: async (id) => { ends.push(id) }, decline: async () => {}, sendSignal: async () => {},
        onIncoming: (cb) => subscribe('incoming', cb), onAccepted: (cb) => subscribe('accepted', cb), onEnded: (cb) => subscribe('ended', cb), onSignal: (cb) => subscribe('signal', cb),
      }
      const nav = document.createElement('nav'); nav.innerHTML = '<div class="chat__nav-actions"></div>'; document.body.append(nav)
      const handle = mountCallBar(nav, transport, 'Fixture')
      const screen = [...document.querySelectorAll('.call-screen')].at(-1)
      handle.startAudioCall(); await tick()
      listeners.ended('ended-before-ack'); resolveInvite({ callId: 'ended-before-ack', iceServers: [] }); await tick()
      const earlyEnd = screen.hidden
      handle.startVideoCall(); await tick()
      screen.querySelector('[aria-label="Cancel"]').click()
      resolveInvite({ callId: 'cancelled-before-ack', iceServers: [] }); await tick()
      const cancelled = screen.hidden && ends.includes('cancelled-before-ack')
      handle.startAudioCall(); await tick()
      listeners.accepted('early-answer'); resolveInvite({ callId: 'early-answer', iceServers: [] }); await tick()
      const earlyAnswer = !screen.hidden && !!screen.querySelector('[aria-label="End"]')
      screen.querySelector('[aria-label="End"]').click(); await tick()
      listeners.accepted('early-answer'); const noRevive = screen.hidden
      listeners.incoming({ callId: 'incoming-ended', kind: 'audio', fromUserId: 'other' })
      screen.querySelector('[aria-label="Accept"]').click(); await tick()
      listeners.ended('incoming-ended'); resolveAccept({ iceServers: [] }); await tick()
      const lateAccept = screen.hidden
      listeners.incoming({ callId: 'other-device-answer', kind: 'video', fromUserId: 'other' })
      listeners.accepted('other-device-answer'); const otherDevice = screen.hidden
      handle.dispose(); nav.remove()
      return { earlyEnd, cancelled, earlyAnswer, noRevive, lateAccept, otherDevice }
    })
    assert.deepEqual(callChecks, { earlyEnd: true, cancelled: true, earlyAnswer: true, noRevive: true, lateAccept: true, otherDevice: true })
    assert.deepEqual(errors, [])
    for (const context of contexts.splice(0)) await context.close()
    manager.endConnection(ids.connection)
    console.log(`PASS ${width}px: five real-rule games, 2D Pong input, clocks, reactions, draws/away, invite dismiss, local preview voice, dictation punctuation, emoji, normalized photos and manual brush`)
  }
} catch (error) {
  for (const context of contexts) for (const page of context.pages()) { console.error((await page.locator('body').innerText()).slice(-1500)); await shot(page, 'failure').catch(() => {}) }
  throw error
} finally {
  manager.dispose(); await browser.close(); await vite.close(); await new Promise((r) => io.close(r)); api.closeAllConnections(); await new Promise((r) => api.close(r))
}
