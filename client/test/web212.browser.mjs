import assert from 'node:assert/strict'

export async function verifyGameParity({ page, other, manager, events, io, ids, width, command, wait, shot }) {
  await verifyPointerAndSounds(page)
  const pages = { me: page, other }
  const current = () => manager.get(ids.connection)
  const begin = async (title, select, custom) => {
    io.emit('presence', { userId: 'other', online: false, lastSeenAt: null })
    await command(page, 'games'); await page.getByRole('button', { name: title, exact: true }).click()
    await page.locator('.game-hub select').selectOption(select)
    if (custom?.base) {
      await page.getByRole('spinbutton', { name: 'Time each in seconds', exact: true }).fill(String(custom.base))
      await page.getByRole('spinbutton', { name: 'Bonus per move in seconds', exact: true }).fill(String(custom.inc))
    }
    if (custom?.points) await page.getByRole('spinbutton', { name: 'Target score, 1 to 99', exact: true }).fill(String(custom.points))
    await page.getByRole('button', { name: 'Invite Alex', exact: true }).click()
    await other.getByRole('button', { name: 'Play', exact: true }).waitFor()
  }
  const accept = async () => {
    await other.getByRole('button', { name: 'Play', exact: true }).click()
    await wait(() => current()?.status === 'playing')
    await page.locator('.game-surface:not([hidden])').waitFor(); await other.locator('.game-surface:not([hidden])').waitFor()
  }
  const done = async () => {
    for (const p of [page, other]) await p.getByRole('button', { name: 'Done', exact: true }).click()
    await wait(async () => await page.locator('.game-surface').isHidden() && await other.locator('.game-surface').isHidden())
  }
  const resign = async () => { manager.leave(ids.connection, 'me', current().id, 'resigned'); await done() }
  const reconnect = async (user) => {
    const p = pages[user], start = events.length
    for (const socket of io.sockets.sockets.values()) if (socket.data.userId === user) socket.conn.close()
    await wait(() => events.slice(start).some(([e, , from]) => e === 'match:sync' && from === user))
    await wait(() => !current().away.includes(user))
    await p.locator('.game-status').filter({ hasText: 'Reconnecting' }).waitFor({ state: 'hidden' })
  }
  assert.equal(await page.locator('#message-input').getAttribute('autocapitalize'), 'sentences')
  const original = 'i chose lowercase. pasted text stays. 日本語 /letter'
  await page.locator('#message-input').fill(original)
  assert.equal(await page.locator('#message-input').inputValue(), original)
  await page.locator('#message-input').fill('')

  for (const [title, game] of [['Chess', 'chess'], ['Tic-Tac-Toe', 'tictactoe'], ['Connect 4', 'connect4'], ['Reversi', 'reversi']]) {
    for (const base of [null, 60000, 120000, 300000, 600000, 3600000]) {
      await begin(title, base === null ? '' : String(base))
      assert.deepEqual(current().clock, base === null ? null : { base, inc: 0, left: [base, base] })
      await other.getByRole('button', { name: 'Not now', exact: true }).click()
      await wait(() => current().status === 'over')
    }
    await begin(title, 'Custom', { base: 60, inc: 2 }); await accept()
    assert.equal(current().clock.base, 60000); assert.equal(current().clock.inc, 2000)
    for (const p of [page, other]) assert.equal(await p.locator('.game-clock').count(), 2)
    await new Promise((r) => setTimeout(r, 350))
    const first = pages[current().players[0]]
    if (game === 'chess') { await first.locator('[data-key="e2"]').click(); await first.locator('[data-key="e4"]').click() }
    else await first.locator('.game-board > button[aria-disabled="false"]').first().click()
    await wait(() => current().seq === 1)
    assert(current().clock.left[0] > 60000, `${game} increment`)
    await wait(async () => (await page.locator('.game-clock.running').count()) === 1 && (await other.locator('.game-clock.running').count()) === 1)
    await reconnect('other')
    assert.equal(current().clock.inc, 2000)
    await wait(async () => {
      const values = await Promise.all([page, other].map((p) => p.locator('.game-clock.running').textContent()))
      return values[0] === values[1]
    })
    for (const [sender, receiver, text] of [[page, other, `Good ${game}`], [other, page, `👍 ${game}`]]) {
      await sender.getByRole('button', { name: 'React to game' }).click()
      await sender.getByRole('textbox', { name: 'Comment', exact: true }).fill(text)
      await sender.getByRole('button', { name: 'Send comment', exact: true }).click()
      await wait(async () => await receiver.locator('.game-name small').textContent() === text)
    }
    await resign()
  }
  // Real MatchManager timeout, no move or client-declared outcome.
  await begin('Tic-Tac-Toe', 'Custom', { base: 10, inc: 0 }); await accept()
  await wait(() => current().status === 'over', 14000)
  assert.equal(current().outcome.reason, 'timeout'); assert.equal(current().seq, 0)
  for (const p of [page, other]) await p.getByText('Time ran out', { exact: true }).waitFor()
  await done()

  for (const points of [11, 21, 13]) {
    await begin('Ping Pong', points === 13 ? 'Custom' : String(points), { points: points === 13 ? points : undefined })
    assert.equal(current().points, points); await accept()
    for (const p of [page, other]) await wait(async () => (await p.locator('.pong-score').textContent()).includes(`First to ${points}`))
    // Exercise both player seats through actual mouse/touch events and the complete transport path.
    for (const [user, p] of Object.entries(pages)) {
      const canvas = p.locator('.game-board--pong canvas'), b = await canvas.boundingBox(), start = events.length
      if (width === 360) {
        const cdp = await p.context().newCDPSession(p)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + 35, y: b.y + 40 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + 95, y: b.y + 130 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach()
      } else {
        await p.mouse.move(b.x + 35, b.y + 40); await p.mouse.down()
        await p.mouse.move(b.x + 120, b.y + 135, { steps: 8 }); await p.mouse.up()
      }
      await wait(() => events.slice(start).some(([e, v, from]) => e === 'match:paddle' && from === user && v.released && v.n > 0))
      const packets = events.slice(start).filter(([e, , from]) => e === 'match:paddle' && from === user).map(([, v]) => v)
      assert(packets.some((v) => v.touch?.length === 2)); assert(packets.some((v) => v.samples?.length > 0))
      for (const v of packets) {
        assert(Number.isSafeInteger(v.ct) && Number.isSafeInteger(v.n) && Number.isFinite(v.v))
        assert((v.samples?.length ?? 0) <= 32)
      }
    }
    await reconnect('me'); assert.equal(current().points, points)
    // Simulate a background visibility transition; recovery must sync and resume the authoritative serve.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
    await wait(() => current().paused)
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })
    await wait(() => !current().paused)
    for (const [sender, receiver, text] of [[page, other, `Play to ${points}`], [other, page, '🔥']]) {
      await sender.getByRole('button', { name: 'React to game' }).click(); await sender.getByRole('textbox', { name: 'Comment', exact: true }).fill(text)
      await sender.getByRole('button', { name: 'Send comment', exact: true }).click()
      await wait(async () => await receiver.locator('.game-name small').textContent() === text)
    }
    // Drive the real simulation using its existing test hook; never manufacture scores/outcomes.
    const match = manager.matches.get(ids.connection), sim = match.pong
    let beyondSeven = false
    while (!sim.outcome) {
      sim.paddle(1, -.26, 2.5, true); sim.paddle(2, 1.26, -.7, true)
      manager.advancePong(ids.connection, 3100)
      const serving = sim.frame().serve
      if (serving) { sim.paddle(serving, sim.x, sim.y, true); manager.advancePong(ids.connection, 8); sim.paddle(serving, -.26, serving === 1 ? 2.5 : -.7, true) }
      manager.advancePong(ids.connection, 2800)
      if (Math.max(...sim.score) >= 8 && !sim.outcome) { beyondSeven = true; assert.equal(current().status, 'playing', 'must continue beyond seven') }
    }
    assert(beyondSeven)
    assert.equal(Math.max(...sim.score), points); assert.equal(current().outcome.reason, 'first_to_points')
    for (const p of [page, other]) await wait(async () => (await p.locator('.pong-score').textContent()).includes(`First to ${points}`))
    for (const p of [page, other]) await p.getByText('Target score reached', { exact: true }).waitFor()
    await shot(page, `${width}-target-${points}`)
    await page.getByRole('button', { name: 'Rematch', exact: true }).click()
    await other.getByRole('button', { name: 'Accept rematch', exact: true }).click()
    await wait(() => current().status === 'playing'); assert.equal(current().points, points); assert.equal(current().board.target, points)
    await resign()
  }
  for (const p of [page, other]) {
    const samples = await p.evaluate(() => window.__whiteBalls)
    assert(samples.length > 0); assert(samples.every((v) => v === 1), 'main ball stays opaque')
  }
  console.log(`PASS ${width}px parity: presets/custom/increments, server timeout, both-way comments, 11/21/13 beyond seven/rematch, timed mouse/touch, reconnect/background, opaque white ball, native capitalization`)
}

// Historical/coalesced samples and focus/capture loss use the real browser event path.
async function verifyPointerAndSounds(page) {
  await page.evaluate(async () => {
    const { PongClient } = await import('/src/features/games/pong.ts')
    const { mountPongCanvas } = await import('/src/features/games/pongCanvas.ts')
    const audio = window.AudioContext, notes = [], samples = []
    window.AudioContext = class {
      state = 'running'; currentTime = 0; destination = {}
      resume() { return Promise.resolve() } close() { return Promise.resolve() }
      createOscillator() { const o = { frequency: {}, connect(target) { return target }, start() { notes.push(o.frequency.value) }, stop() {} }; return o }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} } }
    }
    const grid = document.createElement('div'); grid.className = 'game-board game-board--pong'
    grid.style.cssText = 'position:fixed;z-index:100000;left:15px;top:15px;width:300px;height:650px;background:#123'
    document.body.append(grid)
    const game = new PongClient(1), now = performance.now()
    const frame = { id: 'probe', t: 1000, b: [.5, 1.6, 0, 1], p: [.5, .5], r: [2.4, -.08], s: [0, 0], c: 0, h: 1, z: [.033, 0], l: true, drift: 0, ack: [0, 0] }
    game.receive(frame, 'probe', now); game.advance(now)
    const stop = mountPongCanvas(grid, game, 'Fixture', () => false, (...args) => { samples.push(args); game.paddle(...args) })
    grid.querySelector('canvas').addEventListener('pointerdown', (e) => { window.__pongProbe.pointer = e.pointerId })
    window.__pongProbe = { grid, game, samples, notes, frame, stop: () => { stop(); grid.remove(); window.AudioContext = audio }, pointer: 0 }
  })
  const canvas = page.locator('body > .game-board--pong canvas'), b = await canvas.boundingBox()
  await page.mouse.move(b.x + 30, b.y + 50); await page.mouse.down()
  const historical = await page.evaluate(() => {
    const p = window.__pongProbe, canvas = p.grid.querySelector('canvas'), b = canvas.getBoundingClientRect(), at = performance.now()
    const event = new PointerEvent('pointermove', { pointerId: p.pointer, clientX: b.x + 100, clientY: b.y + 100 })
    const history = [60, 80].map((x, i) => {
      const sample = new PointerEvent('pointermove', { pointerId: p.pointer, clientX: b.x + x, clientY: b.y + x })
      Object.defineProperty(sample, 'timeStamp', { value: at - 4 + i * 2 }); return sample
    })
    Object.defineProperty(event, 'getCoalescedEvents', { value: () => history })
    const start = p.samples.length; canvas.dispatchEvent(event)
    const touches = p.samples.slice(start).map((s) => s[4])
    canvas.releasePointerCapture(p.pointer)
    return touches
  })
  assert(historical.length >= 2); assert.notDeepEqual(historical[0], historical[1])
  await page.mouse.up()
  await page.waitForFunction(() => window.__pongProbe.samples.some((s) => s[2] === true))
  await page.mouse.down(); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up()
  const before = await page.evaluate(() => window.__pongProbe.samples.length)
  await page.mouse.move(b.x + 40, b.y + 60); await page.mouse.down(); await page.mouse.move(b.x + 70, b.y + 90); await page.mouse.up()
  assert(await page.evaluate(() => window.__pongProbe.samples.length) > before)
  const notes = await page.evaluate(async () => {
    const p = window.__pongProbe
    const draw = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await draw()
    const predictedNotes = p.notes.length, authority = p.game.hits
    p.game.receive({ ...p.frame, t: 1100, h: 2, b: [.5, 1.6, 0, -1], ack: [p.game.sampleN, 0] }, 'probe', performance.now())
    await draw()
    p.game.receive({ ...p.frame, t: 1133, h: 2, b: [.5, 1.6, 0, -1] }, 'probe', performance.now())
    await draw()
    const result = { predictedNotes, authority, notes: [...p.notes] }; p.stop(); delete window.__pongProbe; return result
  })
  assert.equal(notes.predictedNotes, 0); assert.equal(notes.authority, 1); assert.deepEqual(notes.notes, [620])
}
