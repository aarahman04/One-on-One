// Real browser UI + real §12 Socket.IO handlers/rules; disposable authenticated fixture, no production writes.
// npm run build --prefix ../backend first. PLAYWRIGHT_MODULE can point to an installed playwright/index.mjs.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { createServer as createViteServer } from 'vite'
import { initMatches, registerMatchHandlers } from '../../backend/dist/games/matchSocket.js'
import { ChessRules } from '../../backend/dist/games/rules.js'

const require = createRequire(new URL('../../backend/package.json', import.meta.url)),
  { Server } = require('socket.io')
const playwright = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
)
const screenshots = fileURLToPath(new URL('../../docs/ui-web-2.0.7/', import.meta.url))
await mkdir(screenshots, { recursive: true })
const ids = { connection: '11111111-1111-4111-8111-111111111111', letter: '22222222-2222-4222-8222-222222222222' }
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
        otherNickname: 'Alex',
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
  } else if (url.pathname === '/api/transcribe') {
    let bytes = 0
    for await (const chunk of req) bytes += chunk.length
    assert(bytes > 0)
    assert(req.headers['content-type'].startsWith('audio/'))
    if (transcriptionDelay) await new Promise((r) => setTimeout(r, transcriptionDelay))
    json({ text: 'spoken words', language: 'en', durationMs: 1000 })
  } else if (url.pathname.endsWith('/read')) res.writeHead(204).end()
  else {
    res.statusCode = 404
    json({ error: 'fixture route missing' })
  }
})
const io = new Server(api, { cors: { origin: '*' } })
const member = { id: ids.connection, user_a_id: 'me', user_b_id: 'other', status: 'active' }
const deps = {
  getConnection: async (u) => (['me', 'other'].includes(u) ? member : null),
  hasInactiveConnection: async () => false,
}
const manager = initMatches(io, deps)
io.on('connection', (socket) => {
  const user = socket.handshake.auth.token
  socket.data.userId = user
  socket.join(`conn:${ids.connection}`)
  registerMatchHandlers(io, socket, { ...deps, withinRateLimit: () => true, withinPaddleLimit: () => true })
  socket.onAny((event, payload) => events.push([event, payload, user]))
  socket.on('disconnect', () => disconnects++)
  socket.on('presence', () =>
    socket.emit('presence', { userId: user === 'me' ? 'other' : 'me', online: true, lastSeenAt: null }),
  )
  socket.on('message:read', (_p, ack) => ack({ ok: true }))
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
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
})
const contexts = []
const command = async (p, name) => {
  await p.locator('#message-input').fill(`/${name}`)
  await p.locator('#send-btn').click()
}
const wait = async (fn, ms = 12000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 30))
  }
  assert.fail('condition timed out')
}
const shot = async (p, name) => {
  await p.screenshot({ path: join(screenshots, `${name}.png`), animations: 'disabled' })
}
try {
  for (const width of [1280, 360]) {
    const pages = {}
    for (const user of ['me', 'other']) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        hasTouch: width === 360,
        isMobile: width === 360,
        serviceWorkers: 'block',
        colorScheme: 'dark',
      })
      contexts.push(context)
      await context.addInitScript(() => {
        localStorage.setItem('notificationReminderAt', String(Date.now()))
        window.__spoken = []
        Object.defineProperty(window, 'speechSynthesis', {
          value: { speak: (u) => window.__spoken.push(u.text), cancel() {}, pause() {}, resume() {} },
        })
      })
      await context.route('**/*', (route) =>
        route.request().url().startsWith(origin) || route.request().url().startsWith(apiOrigin)
          ? route.continue()
          : route.abort(),
      )
      const page = await context.newPage()
      pages[user] = page
      page.on('pageerror', (e) => errors.push(e.message))
      page.setDefaultTimeout(15000)
      await page.goto(`${origin}?user=${user}`)
      await page.locator('#message-input').waitFor()
      await page.locator('#splash').waitFor({ state: 'hidden' })
    }
    const page = pages.me,
      other = pages.other
    const invite = async (title) => {
      await command(page, 'games')
      await page.getByRole('button', { name: title, exact: true }).click()
      await other.getByRole('button', { name: 'Accept', exact: true }).click()
      await page.locator('.game-surface:not([hidden])').waitFor()
      await other.locator('.game-surface:not([hidden])').waitFor()
    }
    await invite('Chess')
    let match = manager.get(ids.connection),
      white = pages[match.players[0]],
      black = pages[match.players[1]]
    assert.equal(await white.locator('.game-identity').textContent(), 'Playing as White')
    assert.equal(await black.locator('.game-identity').textContent(), 'Playing as Black')
    assert.equal(await black.locator('.chess-square').first().getAttribute('data-key'), 'h1')
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => (document.querySelector('.chat').dataset.theme = t), theme)
      await shot(page, `${width}-${theme}-chess`)
    }
    await white.locator('[data-key="f2"]').focus()
    await white.keyboard.press('Enter')
    assert(await white.locator('[data-key="f3"]').evaluate((e) => e.classList.contains('hint')))
    await white.locator('[data-key="f3"]').focus()
    await white.keyboard.press('Enter')
    await wait(() => manager.get(ids.connection).seq === 1)
    // Reconnect reload restores the authoritative board before any new move.
    await black.reload()
    await black.locator('.game-board--chess').waitFor()
    assert.equal(await black.locator('.chess-piece').count(), 32)
    const play = async (p, from, to, seq) => {
      await p.locator(`[data-key="${from}"]`).click()
      await p.locator(`[data-key="${to}"]`).click()
      await wait(() => manager.get(ids.connection).seq === seq)
    }
    await play(black, 'e7', 'e5', 2)
    // Pointer drag exercises lifted piece and destination snap on desktop.
    if (width === 1280) {
      const from = await white.locator('[data-key="g2"]').boundingBox(),
        to = await white.locator('[data-key="g4"]').boundingBox()
      await white.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await white.mouse.down()
      await white.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
      assert.equal(await white.locator('.chess-piece.dragging').count(), 1)
      await white.mouse.up()
      await wait(() => manager.get(ids.connection).seq === 3)
    } else await play(white, 'g2', 'g4', 3)
    await play(black, 'd8', 'h4', 4)
    await page.getByRole('button', { name: 'Rematch', exact: true }).waitFor()
    assert.equal(manager.get(ids.connection).outcome.reason, 'checkmate')
    assert.equal(await page.locator('.chess-piece').count(), 32)
    assert.match(await page.locator('.chess-history').textContent(), /Qh4#/)
    await shot(white, `${width}-chess-final-white`)
    await shot(black, `${width}-chess-final-black`)
    const before = manager.get(ids.connection).players
    await page.getByRole('button', { name: 'Rematch', exact: true }).click()
    await other.getByRole('button', { name: 'Accept rematch', exact: true }).click()
    await wait(() => manager.get(ids.connection).id !== match.id)
    assert.deepEqual(manager.get(ids.connection).players, [...before].reverse())
    // Draw controls use the same authoritative state on both clients.
    await page.getByRole('button', { name: 'Offer draw', exact: true }).click()
    await other.getByRole('button', { name: 'Accept', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await other.getByRole('button', { name: 'Done', exact: true }).click()
    // A late-game fixture exercises the real promotion move and keyboard/outside cancellation.
    await invite('Chess')
    const promotionMatch = manager.matches.get(ids.connection)
    promotionMatch.rules = new ChessRules('7k/P7/8/8/8/8/8/7K w - - 0 1')
    promotionMatch.version++
    io.to(`conn:${ids.connection}`).emit('match:state', manager.get(ids.connection))
    const promoter = pages[promotionMatch.players[0]]
    await promoter.locator('[data-key="a7"][aria-label*="white pawn"]').waitFor()
    await promoter.locator('[data-key="a7"]').click()
    await promoter.locator('[data-key="a8"]').click()
    await promoter.getByRole('button', { name: 'Promote to queen', exact: true }).waitFor()
    assert.equal(await promoter.locator('.chess-promotion img').count(), 4)
    await promoter.keyboard.press('Escape')
    assert.equal(await promoter.locator('.chess-promotion').count(), 0)
    assert.equal(await promoter.getByRole('heading', { name: 'Leave this game?', exact: true }).count(), 0)
    await promoter.locator('[data-key="a7"]').click()
    await promoter.locator('[data-key="a8"]').click()
    await shot(promoter, `${width}-chess-promotion`)
    await promoter.getByRole('button', { name: 'Promote to queen', exact: true }).click()
    await wait(() => manager.get(ids.connection).seq === 1)
    assert.match(manager.get(ids.connection).board.fen, /^Q/)
    await promoter.getByRole('button', { name: 'Resign', exact: true }).click()
    await promoter.getByRole('button', { name: 'Resign', exact: true }).last().click()
    for (const p of [page, other]) await p.getByRole('button', { name: 'Done', exact: true }).click()
    await invite('Table Tennis')
    match = manager.get(ids.connection)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await wait(() => manager.get(ids.connection).paused)
    const syncs = events.filter(([name]) => name === 'match:sync').length
    for (const socket of io.sockets.sockets.values()) if (socket.data.userId === 'me') socket.conn.close()
    await wait(() => events.filter(([name]) => name === 'match:sync').length > syncs)
    await page.waitForTimeout(150)
    assert(manager.get(ids.connection).paused, 'a hidden tab must reassert away after reconnect sync')
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await wait(() => !manager.get(ids.connection).paused)
    await page.locator('.game-board--pong input').fill('0.498')
    await page.locator('.game-board--pong input').dispatchEvent('input')
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => (document.querySelector('.chat').dataset.theme = t), theme)
      await shot(page, `${width}-${theme}-pong-countdown`)
    }
    // Deliberately miss with seat 2 while seat 1 returns centred serves; the real simulation scores to seven.
    const loser = pages[match.players[1]]
    await loser.locator('.game-board--pong input').fill('0.078')
    await loser.locator('.game-board--pong input').dispatchEvent('input')
    await wait(() => manager.get(ids.connection).status === 'over', 55000)
    assert.equal(manager.get(ids.connection).outcome.reason, 'first_to_7')
    assert.equal(Math.max(...manager.get(ids.connection).board.score), 7)
    for (const [user, p] of Object.entries(pages)) {
      const final = manager.get(ids.connection),
        seat = final.players.indexOf(user)
      await wait(
        async () =>
          (await p.locator('.pong-score').textContent()) ===
          `You ${final.board.score[seat]} · Alex ${final.board.score[1 - seat]} · First to 7`,
      )
    }
    await shot(page, `${width}-pong-result`)
    for (const p of [page, other]) await p.getByRole('button', { name: 'Done', exact: true }).click()
    for (const title of ['Tic-Tac-Toe', 'Connect 4', 'Dots & Boxes']) {
      await invite(title)
      const m = manager.get(ids.connection),
        first = pages[m.players[0]]
      await first.locator('.game-board > button[aria-disabled="false"]').first().click()
      await wait(() => manager.get(ids.connection).seq === 1)
      await shot(page, `${width}-${m.game}`)
      const moves = m.game === 'tictactoe' ? [3, 1, 4, 2] : m.game === 'connect4' ? [1, 0, 1, 0, 1, 0] : null
      if (moves)
        for (const key of moves) {
          const next = manager.get(ids.connection),
            p = pages[next.turn]
          await p.locator(`[data-key="${key}"]`).click()
          await wait(() => manager.get(ids.connection).seq === next.seq + 1)
        }
      else
        for (const h of [true, false])
          for (let i = 0; i < 30; i++) {
            if (h && i === 0) continue
            const next = manager.get(ids.connection),
              p = pages[next.turn],
              row = Math.floor(i / (h ? 5 : 6)),
              col = i % (h ? 5 : 6)
            await p.locator(`[data-key="${h}-${row}-${col}"]`).click()
            await wait(() => manager.get(ids.connection).seq === next.seq + 1)
          }
      await wait(() => manager.get(ids.connection).status === 'over')
      for (const p of [page, other]) await p.getByRole('button', { name: 'Done', exact: true }).click()
    }
    await page.locator('.letter-card').click()
    await page.getByRole('button', { name: 'Read letter aloud', exact: true }).click()
    await wait(() => requests.some(([, path, search]) => path.endsWith('/narration') && search === '?part=1'))
    await page.getByRole('button', { name: 'Read letter aloud', exact: true }).waitFor()
    assert.equal((await page.evaluate(() => window.__spoken)).length, 0)
    speechStatus = 429
    await page.getByRole('button', { name: 'Read letter aloud', exact: true }).click()
    await wait(async () => !!(await page.evaluate(() => window.__spoken.length)))
    await shot(page, `${width}-letter-device-fallback`)
    await page.getByRole('button', { name: 'Stop reading', exact: true }).last().click()
    await page.keyboard.press('Escape')
    speechStatus = 200
    await command(page, 'audio')
    await page.locator('.voice-typing').waitFor()
    await page.locator('#message-input').fill('Draft')
    await wait(async () => /Listening/.test(await page.locator('.voice-typing').innerText()))
    await page.getByRole('button', { name: 'Transcribe', exact: true }).click()
    await wait(async () => (await page.locator('#message-input').inputValue()) === 'Draft spoken words')
    assert(!events.some(([e]) => e === 'message:send'), 'dictation never sends a message')
    transcriptionDelay = 500
    await command(page, 'audio')
    await wait(async () => /Listening/.test(await page.locator('.voice-typing').innerText()))
    await page.getByRole('button', { name: 'Transcribe', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.waitForTimeout(600)
    assert.equal(await page.locator('#message-input').inputValue(), '')
    transcriptionDelay = 0
    assert(!events.some(([e]) => e.startsWith('game:')))
    assert(disconnects > 0)
    assert(events.some(([e]) => e === 'match:sync'))
    assert.deepEqual(errors, [])
    for (const p of [page, other]) assert(await p.locator('.chat').evaluate((el) => el.scrollWidth <= el.clientWidth))
    for (const context of contexts.splice(0)) await context.close()
    manager.endConnection(ids.connection)
    console.log(
      `PASS ${width}px: full chess, full table tennis, rematch/draw/reconnect, all boards, natural-audio parts/fallback, dictation/cancel`,
    )
  }
} catch (error) {
  for (const context of contexts)
    for (const [p, page] of context.pages().entries()) {
      console.error((await page.locator('body').innerText()).slice(-1600))
      await shot(page, `failure-${p}`).catch(() => {})
    }
  throw error
} finally {
  manager.dispose()
  await browser.close()
  await vite.close()
  await new Promise((r) => io.close(r))
  api.closeAllConnections()
  await new Promise((r) => api.close(r))
}
