import type { PongClient } from './pong'

export function mountPongCanvas(
  grid: HTMLElement,
  game: PongClient,
  nickname: string,
  paused: () => boolean,
  paddle: (x: number) => void,
) {
  const canvas = document.createElement('canvas'),
    slider = document.createElement('input'),
    hud = document.createElement('p')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', 'Table tennis court. Your racket is at the bottom.')
  slider.type = 'range'
  slider.min = '.078'
  slider.max = '.922'
  slider.step = '.01'
  slider.value = String(game.myX)
  slider.setAttribute('aria-label', 'Your racket position')
  slider.addEventListener('input', () => {
    if (!paused()) paddle(Number(slider.value))
  })
  hud.className = 'pong-countdown'
  hud.setAttribute('role', 'status')
  grid.append(canvas, slider, hud)
  let frame = 0,
    width = 1,
    height = 1,
    bounds: DOMRect,
    colors: { table: string; line: string; net: string; you: string; other: string; text: string }
  const ctx = canvas.getContext('2d')!
  const measure = () => {
    bounds = canvas.getBoundingClientRect()
    width = bounds.width
    height = bounds.height
    const dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const style = getComputedStyle(grid),
      get = (n: string) => style.getPropertyValue(n).trim()
    colors = {
      table: get('--pong-table'),
      line: get('--pong-line'),
      net: get('--text-dim'),
      you: get('--accent-you'),
      other: get('--accent-other'),
      text: get('--text'),
    }
  }
  const resize = new ResizeObserver(measure)
  resize.observe(canvas)
  const theme = new MutationObserver(measure),
    chat = grid.closest('.chat')
  if (chat) theme.observe(chat, { attributes: true, attributeFilter: ['data-theme'] })
  const drag = (e: PointerEvent) => {
    if (!paused()) {
      paddle((e.clientX - bounds.left) / bounds.width)
      slider.value = String(game.myX)
    }
  }
  canvas.addEventListener('pointerdown', (e) => {
    bounds = canvas.getBoundingClientRect()
    canvas.setPointerCapture(e.pointerId)
    e.preventDefault()
    drag(e)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (canvas.hasPointerCapture(e.pointerId)) drag(e)
  })
  canvas.addEventListener('pointerup', (e) => {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
  })
  const circle = (x: number, y: number, r: number, fill: string, stroke?: string) => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = 0.006 * width
      ctx.stroke()
    }
  }
  const racket = (x: number, y: number, up: boolean, color: string) => {
    const u = width,
      r = 0.13 * u,
      hw = 0.075 * u,
      top = up ? y - r - 0.15 * u : y + r * 0.6
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(x - hw / 2, top, hw, 0.202 * u, hw * 0.35)
    ctx.fill()
    circle(x, y, r, color, '#0006')
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = '#ffffff4d'
    ctx.fillRect(x - r, up ? y - r : y + r * 0.55, 2 * r, r * 0.45)
    ctx.restore()
    ctx.strokeStyle = '#0006'
    ctx.lineWidth = 0.01 * u
    ctx.beginPath()
    ctx.moveTo(x - r * 0.84, y + (up ? -1 : 1) * r * 0.55)
    ctx.lineTo(x + r * 0.84, y + (up ? -1 : 1) * r * 0.55)
    ctx.stroke()
  }
  let lastHud = ''
  const draw = (now: number) => {
    if (!paused()) game.advance(now)
    const u = width,
      top = 0.31 * u,
      tableH = 1.8 * u
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = colors.table
    ctx.beginPath()
    ctx.roundRect(0, top, u, tableH, 0.035 * u)
    ctx.fill()
    ctx.strokeStyle = colors.line
    ctx.lineWidth = 0.012 * u
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(u / 2, top + 0.03 * u)
    ctx.lineTo(u / 2, top + tableH - 0.03 * u)
    ctx.stroke()
    ctx.strokeStyle = colors.net
    ctx.lineWidth = 0.022 * u
    ctx.beginPath()
    ctx.moveTo(0, top + tableH / 2)
    ctx.lineTo(u, top + tableH / 2)
    ctx.stroke()
    if (game.live) {
      circle(
        (game.x + 0.04 * game.height) * u,
        top + (game.y + 0.05 * game.height) * u,
        0.03 * u * (1 - 0.15 * game.height),
        '#0004',
      )
      const age = (now - game.bounceAt) / 260
      if (game.bounceAt && age < 1) {
        ctx.globalAlpha = 1 - age
        circle(game.bounceX * u, top + game.bounceY * u, 0.03 * u * (1 + 1.4 * age), 'transparent', colors.text)
        ctx.globalAlpha = 1
      }
    }
    racket(game.theirX * u, top, true, colors.other)
    racket(game.myX * u, top + tableH, false, colors.you)
    if (game.live) circle(game.x * u, top + game.y * u, 0.03 * u * (1 + 0.28 * game.height), '#fff', '#0007')
    const text = paused() ? 'Paused' : game.countdown > 0 ? String(Math.ceil(game.countdown / 1000)) : ''
    if (text !== lastHud) {
      hud.textContent = text
      hud.hidden = !text
      lastHud = text
    }
    const score = `You ${game.myScore} · ${nickname} ${game.theirScore} · First to 7`
    const scoreboard = grid.parentElement?.querySelector('.pong-score')
    if (scoreboard && scoreboard.textContent !== score) scoreboard.textContent = score
    frame = requestAnimationFrame(draw)
  }
  measure()
  frame = requestAnimationFrame(draw)
  return () => {
    cancelAnimationFrame(frame)
    resize.disconnect()
    theme.disconnect()
  }
}
