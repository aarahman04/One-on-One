import type { PongClient } from './pong'

export function mountPongCanvas(
  grid: HTMLElement,
  game: PongClient,
  nickname: string,
  paused: () => boolean,
  paddle: (x: number, y: number, released?: boolean) => void,
) {
  const canvas = document.createElement('canvas'),
    slider = document.createElement('input'),
    hud = document.createElement('p')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', 'Table tennis court. Your racket is at the bottom.')
  slider.type = 'range'
  slider.min = '-.26'
  slider.max = '1.26'
  slider.step = '.01'
  slider.value = String(game.myX)
  slider.setAttribute('aria-label', 'Your racket position')
  slider.addEventListener('input', () => {
    if (!paused()) paddle(Number(slider.value), game.myY, true)
  })
  hud.className = 'pong-countdown'
  hud.setAttribute('role', 'status')
  const depth = slider.cloneNode() as HTMLInputElement
  depth.min = '1.3'; depth.max = '2.5'; depth.value = String(game.myY)
  depth.setAttribute('aria-label', 'Your racket depth')
  depth.oninput = () => { if (!paused()) paddle(game.myX, Number(depth.value), true) }
  grid.append(canvas, slider, depth, hud)
  let audio: AudioContext | null = null
  const sound = (bounce: boolean) => {
    if (!audio || audio.state !== 'running') return
    const oscillator = audio.createOscillator(), gain = audio.createGain()
    oscillator.type = 'sine'; oscillator.frequency.value = bounce ? 320 : 620
    gain.gain.setValueAtTime(.08, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .07)
    oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .08)
  }
  const unlock = () => { audio ??= new AudioContext(); void audio.resume().catch(() => {}) }
  slider.addEventListener('pointerdown', unlock); depth.addEventListener('pointerdown', unlock)
  let hits = game.hits, bounces = game.bounceAt

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
  let pointer = -1, anchorX = 0, anchorY = 0, fingerX = 0, fingerY = 0
  canvas.addEventListener('pointerdown', (e) => {
    if (paused() || pointer !== -1) return
    unlock(); bounds = canvas.getBoundingClientRect(); pointer = e.pointerId
    anchorX = game.myX; anchorY = game.myY; fingerX = e.clientX; fingerY = e.clientY
    canvas.setPointerCapture(e.pointerId); e.preventDefault()
  })
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer || paused()) return
    const unit = bounds.width / 1.56, dx = (e.clientX - fingerX) / unit, dy = (e.clientY - fingerY) / unit
    const x = anchorX + dx, y = anchorY + dy, cx = Math.max(-.26, Math.min(1.26, x)), cy = Math.max(1.3, Math.min(2.5, y))
    if (x !== cx || y !== cy) { anchorX = cx - dx; anchorY = cy - dy }
    paddle(cx, cy); slider.value = String(game.myX); depth.value = String(game.myY)
  })
  const release = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return
    pointer = -1
    if (!paused()) paddle(game.myX, game.myY, true)
  }
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release); canvas.addEventListener('lostpointercapture', release)
  paddle(game.myX, game.myY, true)
  const circle = (x: number, y: number, r: number, fill: string, stroke?: string) => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = 0.006 * width / 1.56
      ctx.stroke()
    }
  }
  const racket = (x: number, y: number, up: boolean, color: string, angle: number) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle * Math.PI / 180); x = y = 0
    const u = width / 1.56,
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
    ctx.restore()
  }
  let lastHud = ''
  const draw = (now: number) => {
    if (!paused()) game.advance(now)
    const u = width / 1.56,
      top = 0.42 * u,
      tableH = 1.8 * u
    ctx.clearRect(0, 0, width, height)
    ctx.save(); ctx.translate(.28 * u, 0)
    const gradient = ctx.createLinearGradient(0, top, 0, top + tableH)
    gradient.addColorStop(0, '#17294a'); gradient.addColorStop(.5, '#0e1a31'); gradient.addColorStop(1, '#17294a')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.roundRect(0, top, u, tableH, 0.035 * u)
    ctx.fill()
    ctx.strokeStyle = '#ffffffcc'
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
      const height = Math.max(0, Math.min(1, game.height / (6 / 12.16)))
      circle(
        (game.x + 0.12 * height) * u,
        top + (game.y + 0.025 * height) * u,
        0.033 * u * (1 - 0.15 * height),
        '#0004',
      )
      const age = (now - game.bounceAt) / 300
      if (game.bounceAt && age < 1) {
        ctx.globalAlpha = 1 - age
        circle(game.bounceX * u, top + game.bounceY * u, 0.03 * u * (1 + 1.4 * age), 'transparent', colors.text)
        ctx.globalAlpha = 1
      }
    }
    const razor = Math.abs(game.spin) > .6
    for (let i = 1; i < game.trail.length; i++) {
      const a = game.trail[i - 1], b = game.trail[i], k = i / game.trail.length
      ctx.strokeStyle = razor ? '#ff8a3d' : game.spin ? colors.you : '#fff'; ctx.globalAlpha = k * (razor ? .6 : .35)
      ctx.lineWidth = .04 * u * k; ctx.lineCap = 'round'; ctx.beginPath()
      ctx.moveTo(a.x * u, top + a.y * u); ctx.lineTo(b.x * u, top + b.y * u); ctx.stroke()
    }
    ctx.globalAlpha = 1
    racket(game.theirX * u, top + game.theirY * u, true, colors.other, game.theirAngle)
    racket(game.myX * u, top + game.myY * u, false, colors.you, game.myAngle)
    if (game.live && (game.height >= 0 || game.x < 0 || game.x > 1 || game.y < 0 || game.y > 1.8)) {
      const r = .033 * u * (1 + .35 * Math.max(-1, Math.min(1, game.height / (6 / 12.16))))
      circle(game.x * u, top + game.y * u, r * 2, razor ? '#ff8a3d66' : '#ffffff22')
      circle(game.x * u, top + game.y * u, r, '#fff', '#0007')
    }
    ctx.restore()
    if (!paused() && game.hits !== hits) { hits = game.hits; sound(false) }
    if (!paused() && game.bounceAt !== bounces) { bounces = game.bounceAt; sound(true) }
    const text = paused() ? 'Paused' : game.countdown > 0 ? String(Math.ceil(game.countdown / 1000)) : game.waitingServe ? (game.myServe ? 'Your serve · move into the ball' : `${nickname} is serving`) : ''
    if (text !== lastHud) {
      hud.textContent = text
      hud.hidden = !text
      lastHud = text
    }
    const score = `You ${game.myScore} · ${nickname} ${game.theirScore} · First to ${game.target}`
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
    void audio?.close()
  }
}
