import { openModal, type Modal } from '../../components/Modal'
import { pushBackHandler } from '../../state/backHandlers'
import type { GameEvent, GameEventName, GamePacket } from '../../services/transport/Transport'
import { ChessGame, ConnectFourGame, DotsGame, gameTitles, PADDLE_HALF, PongGame, TicTacToeGame, type GameKind } from './engines'
import { GameSession } from './session'

const svg = (shape: string) => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`
const pieceShapes: Record<string, string> = {
  p: '<circle cx="24" cy="13" r="6"/><path d="M20 20l-3 16h14l-3-16M14 40h20"/>',
  r: '<path d="M13 8v10h22V8h-6v5h-10V8zM17 18v18h14V18M13 40h22"/>',
  n: '<path d="M15 36V24l-5-2 8-12 9-3 6 12v17M18 17h1M14 40h22M16 25l9-4"/>',
  b: '<path d="M24 5c-16 13-12 19 0 22 12-3 16-9 0-22zM24 11l-6 8M20 28l-4 9h16l-4-9M13 41h22"/>',
  q: '<path d="M11 13l7 8 6-13 6 13 7-8-6 23H17zM13 41h22"/><circle cx="10" cy="10" r="2"/><circle cx="24" cy="5" r="2"/><circle cx="38" cy="10" r="2"/>',
  k: '<path d="M24 5v12M19 10h10M24 18c-15-9-18 5-8 11l2 8h12l2-8c10-6 7-20-8-11zM14 42h20"/>',
}
const names: Record<string, string> = { p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king' }
const gameIcons: Record<GameKind, string> = {
  chess: svg(pieceShapes.k), pong: svg('<path d="M12 32l-7 9M15 9c15-14 38 9 24 24-10 10-34-14-24-24zM15 10l23 23"/><circle cx="9" cy="10" r="4"/>'),
  connect4: svg('<rect x="6" y="8" width="36" height="32" rx="4"/><circle cx="16" cy="18" r="3"/><circle cx="32" cy="18" r="3"/><circle cx="16" cy="30" r="3"/><circle cx="32" cy="30" r="3"/>'),
  tictactoe: svg('<path d="M18 5v38M30 5v38M5 18h38M5 30h38M7 7l7 7M14 7l-7 7"/><circle cx="36" cy="36" r="4"/>'),
  dots: svg('<path d="M8 8h32v32H8zM24 8v32M8 24h32"/><circle cx="8" cy="8" r="2"/><circle cx="24" cy="24" r="2"/><circle cx="40" cy="40" r="2"/>'),
}

export function mountGames(chat: HTMLElement, nickname: string, relay: (event: GameEventName, packet: GamePacket) => Promise<void>, notice: (text: string) => void) {
  const banner = document.createElement('div'), surface = document.createElement('section')
  banner.className = 'game-invite'; banner.hidden = true; banner.setAttribute('aria-live', 'polite')
  surface.className = 'game-surface'; surface.hidden = true; surface.setAttribute('aria-label', 'Game')
  chat.querySelector('.chat__log')?.before(banner)
  chat.append(surface)
  let hub: Modal | null = null, confirm: Modal | null = null, promotion: Modal | null = null
  let selected = '', frame = 0, previousFrame = 0, disposed = false
  let cancelDrag = () => {}
  surface.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return
    const buttons = [...surface.querySelectorAll<HTMLElement>('button, input')]
    const first = buttons[0], last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  })
  const session = new GameSession(relay, nickname, render, notice)
  const button = (label: string, click: () => void, primary = false) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label
    if (primary) b.className = 'primary'
    b.addEventListener('click', click); return b
  }
  const closeHub = () => { const old = hub; hub = null; old?.close() }
  const confirmLeave = (resign = false) => {
    if (confirm || session.stage !== 'playing') return
    const box = document.createElement('div')
    box.innerHTML = `<h2>${resign ? 'Resign this game?' : 'Leave this game?'}</h2><p>The game will end for both of you.</p>`
    confirm = openModal(box, { onClose: () => { confirm = null } })
    box.append(button('Keep playing', () => confirm?.close()), button(resign ? 'Resign' : 'Leave game', () => { confirm?.close(); session.leave(resign) }))
  }
  const back = pushBackHandler(() => {
    if (surface.hidden) return false
    if (session.stage === 'playing') confirmLeave(); else session.done()
    return true
  })
  function render() {
    if (disposed) return
    if (session.stage !== 'hub') closeHub()
    banner.replaceChildren(); banner.hidden = !['incoming','outgoing'].includes(session.stage)
    if (!banner.hidden) {
      const label = document.createElement('span')
      label.textContent = session.stage === 'incoming' ? `${nickname} wants to play ${gameTitles[session.kind]}` : `Waiting for ${nickname}… Invitation expires in 30 seconds.`
      banner.append(label)
      if (session.stage === 'incoming') banner.append(button('Accept', () => session.accept(), true), button('Decline', () => session.decline()))
      else banner.append(button('Cancel invite', () => session.cancel()))
    }
    if (session.stage === 'hub' && !hub) {
      const box = document.createElement('div'); box.className = 'game-hub'
      box.innerHTML = '<h2>A little time together</h2><p>Choose a game</p>'
      for (const [kind, title] of Object.entries(gameTitles)) {
        const b = button(title, () => { selected = ''; session.invite(kind as GameKind) })
        const icon = document.createElement('span'); icon.innerHTML = gameIcons[kind as GameKind]; b.prepend(icon); box.append(b)
      }
      hub = openModal(box, { onClose: () => { hub = null; if (session.stage === 'hub') session.done() } })
      hub.panel.setAttribute('aria-label', 'Games')
    }
    const active = ['playing','result'].includes(session.stage), opening = surface.hidden && active
    surface.hidden = !active
    if (!active) { cancelAnimationFrame(frame); frame = previousFrame = 0; return }
    if (session.stage === 'playing' && session.pong && surface.dataset.gameId === session.id && surface.querySelector('[data-ball]')) {
      if (session.paused) surface.querySelector('.game-status')!.textContent = `Waiting for ${nickname}… We'll wait up to 15 seconds.`
      return
    }
    surface.dataset.gameId = session.id
    const focus = surface.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined
    surface.replaceChildren()
    const header = document.createElement('header'), title = document.createElement('h2'), status = document.createElement('p')
    title.textContent = gameTitles[session.kind]; status.className = 'game-status'; status.setAttribute('role', 'status')
    header.append(button('Back', () => session.stage === 'playing' ? confirmLeave() : session.done()), title)
    if (session.stage === 'playing') header.append(button('Resign', () => confirmLeave(true)))
    surface.append(header, status)
    if (session.stage === 'result') {
      cancelAnimationFrame(frame); frame = previousFrame = 0
      const result = session.result!, heading = document.createElement('h3'), detail = document.createElement('p')
      heading.textContent = result.winner === session.player ? 'You won' : result.winner ? `${nickname} won` : /draw|stalemate|material|board is full/i.test(result.detail) ? 'A draw' : 'Game ended'
      detail.textContent = result.detail; surface.append(heading, detail)
      if (session.kind === 'tictactoe') {
        const tally = document.createElement('p'); tally.textContent = `You ${session.myWins} · ${nickname} ${session.theirWins}${session.bestOfThree ? session.myWins >= 2 || session.theirWins >= 2 ? ' · Best of 3 complete' : ' · Best of 3' : ''}`; surface.append(tally)
        if (!session.bestOfThree) surface.append(button('Play best of 3', () => { session.bestOfThree = true; session.invite(session.kind) }))
      }
      surface.append(button('Rematch', () => { selected = ''; session.invite(session.kind) }, true), button('Done', () => session.done()))
      return
    }
    const board = session.board
    status.textContent = session.paused ? `Waiting for ${nickname}… We'll wait up to 15 seconds.` : board?.result?.detail || (session.pong ? `${session.pong.hostScore} : ${session.pong.guestScore}` : `${board?.turn === session.player ? 'Your turn' : `${nickname}'s turn`}${board instanceof ChessGame && board.board.isCheck() ? ' · Check' : ''}`)
    const enabled = !session.paused && !session.busy && board?.turn === session.player && !board.result
    const grid = document.createElement('div'); grid.className = `game-board game-board--${session.kind}`
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', `${gameTitles[session.kind]} board`)
    const cell = (label: string, key: string, content: string, click: () => void, available = true) => {
      const b = button('', click); b.dataset.key = key; b.setAttribute('aria-label', label); b.setAttribute('aria-disabled', String(!enabled || !available)); b.innerHTML = content
      b.addEventListener('click', (event) => { if (!enabled || !available) event.stopImmediatePropagation() }, { capture: true })
      grid.append(b); return b
    }
    if (board instanceof TicTacToeGame || board instanceof ConnectFourGame) {
      const cols = board instanceof TicTacToeGame ? 3 : 7
      board.cells.forEach((value, i) => {
        const mark = !value ? '' : board instanceof ConnectFourGame || value === 2 ? svg('<circle cx="24" cy="24" r="14"/>') : svg('<path d="M10 10l28 28M38 10L10 38"/>')
        const b = cell(`Row ${Math.floor(i / cols) + 1}, column ${i % cols + 1}, ${value ? value === session.player ? 'your piece' : 'partner piece' : 'empty'}`, String(i), mark, () => session.move(board instanceof TicTacToeGame ? { cell: i } : { col: i % 7 }), board instanceof TicTacToeGame ? !value : board.landing(i % 7) >= 0)
        b.classList.toggle('game-cell--mine', value === session.player); b.classList.toggle('game-cell--other', !!value && value !== session.player); b.classList.toggle('game-cell--winning', board.winning.includes(i))
      })
    } else if (board instanceof ChessGame) {
      const squares = board.board.board().flat(), oriented = session.player === 1 ? squares : squares.slice().reverse()
      const square = (i: number) => { const n = session.player === 1 ? i : 63 - i; return 'abcdefgh'[n % 8] + (8 - Math.floor(n / 8)) }
      const destination = (to: string) => {
        if (!enabled) return
        const moves = board.legal.filter((m) => m.startsWith(selected + to))
        if (selected && moves.length) {
          selected = ''
          if (moves.length === 1) session.move({ uci: moves[0] })
          else {
            const box = document.createElement('div'); box.innerHTML = '<h2>Promote your pawn</h2>'
            promotion = openModal(box, { onClose: () => { promotion = null } })
            for (const uci of moves) box.append(button(names[uci[4]], () => { promotion?.close(); session.move({ uci }) }))
          }
        } else { selected = selected === to ? '' : to; render() }
      }
      oriented.forEach((piece, i) => {
        const sq = square(i), own = piece?.color === (session.player === 1 ? 'w' : 'b')
        const legal = !!selected && board.legal.some((m) => m.startsWith(selected + sq))
        const b = cell(`${sq}, ${piece ? `${piece.color === 'w' ? 'white' : 'black'} ${names[piece.type]}` : 'empty'}${legal ? ', legal destination' : ''}`, sq, piece ? svg(pieceShapes[piece.type]) : '', () => destination(sq), own || legal)
        b.classList.toggle('game-cell--dark', (Math.floor(i / 8) + i % 8) % 2 === 1); b.classList.toggle('game-cell--selected', sq === selected); b.classList.toggle('game-cell--legal', legal)
        if (piece) b.classList.add(own ? 'game-cell--mine' : 'game-cell--other')
        if (own && enabled) b.addEventListener('pointerdown', (event) => {
          cancelDrag()
          const x = event.clientX, y = event.clientY
          const up = (end: PointerEvent) => {
            cancelDrag()
            if (end.pointerId !== event.pointerId || !grid.isConnected) return
            if (Math.hypot(end.clientX - x, end.clientY - y) < 8) return
            const target = document.elementFromPoint(end.clientX, end.clientY)?.closest<HTMLElement>('[data-key]')
            if (target && grid.contains(target)) { selected = sq; destination(target.dataset.key!); end.preventDefault() }
          }
          cancelDrag = () => { document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancelDrag) }
          document.addEventListener('pointerup', up)
          document.addEventListener('pointercancel', cancelDrag, { once: true })
        })
      })
      const captured = document.createElement('p'); captured.className = 'game-captured'; captured.textContent = `Captured: ${board.captured.map((p) => `${p === p.toUpperCase() ? 'white' : 'black'} ${names[p.toLowerCase()]}`).join(', ') || 'None'}`; surface.append(captured)
    } else if (board instanceof DotsGame) {
      for (let r = 0; r < 11; r++) for (let c = 0; c < 11; c++) {
        if (r % 2 === 0 && c % 2 === 0) { const dot = document.createElement('span'); dot.className = 'game-dot'; grid.append(dot) }
        else if (r % 2 && c % 2) {
          const owner = board.boxes[Math.floor(r / 2) * 5 + Math.floor(c / 2)], box = document.createElement('span'); box.className = `game-box ${owner === session.player ? 'game-cell--mine' : 'game-cell--other'}`; box.textContent = owner ? owner === session.player ? 'Y' : nickname.slice(0, 1) : ''; grid.append(box)
        } else {
          const h = r % 2 === 0, row = Math.floor(r / 2), col = Math.floor(c / 2), value = (h ? board.horizontal : board.vertical)[row * (h ? 5 : 6) + col]
          const b = cell(`${h ? 'Horizontal' : 'Vertical'} line, row ${row + 1}, column ${col + 1}, ${value ? 'taken' : 'empty'}`, `${h}-${row}-${col}`, svg(h ? '<path d="M2 24h44"/>' : '<path d="M24 2v44"/>'), () => session.move({ h, r: row, c: col }), !value)
          b.classList.add('game-line'); if (value) b.classList.add(value === session.player ? 'game-cell--mine' : 'game-cell--other')
        }
      }
      const score = document.createElement('p'); score.textContent = `You ${board.score(session.player)} · ${nickname} ${board.score(3 - session.player)} ? Close a box to play again`; surface.append(score)
    } else if (session.pong) mountPong(grid, session.pong, status)
    grid.addEventListener('keydown', (event) => {
      const cols = session.kind === 'chess' ? 8 : session.kind === 'connect4' ? 7 : 3
      const buttons = [...grid.querySelectorAll<HTMLButtonElement>('button')], index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const offset = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols } as Record<string, number>)[event.key]
      if (offset && index >= 0) { event.preventDefault(); buttons[(index + offset + buttons.length) % buttons.length].focus() }
    })
    surface.append(grid)
    if (focus) [...grid.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.dataset.key === focus)?.focus()
    else if (opening) surface.querySelector('button')?.focus()
  }
  function mountPong(grid: HTMLElement, pong: PongGame, status: HTMLElement) {
    grid.innerHTML = '<svg viewBox="0 0 600 600" role="img" aria-label="Table tennis court"><path d="M300 0v600" stroke="var(--border)" stroke-dasharray="10 10"/><rect data-host width="10" height="126" rx="5" fill="var(--accent-you)"/><rect data-guest width="10" height="126" rx="5" fill="var(--accent-other)"/><circle data-ball r="8.4" fill="var(--text)"/></svg>'
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = String(PADDLE_HALF); slider.max = String(1 - PADDLE_HALF); slider.step = '.01'; slider.value = String(session.player === 1 ? pong.hostY : pong.guestY); slider.setAttribute('aria-label', 'Your paddle position'); slider.className = 'game-paddle'
    slider.addEventListener('input', () => { if (!session.paused) pong.paddle(session.player, Number(slider.value)) }); grid.append(slider)
    grid.addEventListener('pointerdown', (event) => { grid.setPointerCapture(event.pointerId); paddle(event) })
    grid.addEventListener('pointermove', (event) => { if (grid.hasPointerCapture(event.pointerId)) paddle(event) })
    const paddle = (event: PointerEvent) => { if (!session.paused) { const bounds = grid.getBoundingClientRect(); pong.paddle(session.player, (event.clientY - bounds.top) / bounds.height); slider.value = String(session.player === 1 ? pong.hostY : pong.guestY) } }
    cancelAnimationFrame(frame); previousFrame = 0
    const loop = (now: number) => {
      if (disposed || session.stage !== 'playing' || session.pong !== pong || !grid.isConnected) return
      if (!session.paused) pong.tick(previousFrame ? (now - previousFrame) / 1000 : 0, session.player === 1)
      previousFrame = now
      grid.querySelector('[data-host]')!.setAttribute('x', '28'); grid.querySelector('[data-host]')!.setAttribute('y', String((pong.hostY - PADDLE_HALF) * 600))
      grid.querySelector('[data-guest]')!.setAttribute('x', '562'); grid.querySelector('[data-guest]')!.setAttribute('y', String((pong.guestY - PADDLE_HALF) * 600))
      grid.querySelector('[data-ball]')!.setAttribute('cx', String(pong.x * 600)); grid.querySelector('[data-ball]')!.setAttribute('cy', String(pong.y * 600))
      if (!session.paused) status.textContent = `${pong.hostScore} : ${pong.guestScore}${pong.countdown > 0 ? ` · ${Math.ceil(pong.countdown)}` : ''} · First to 7`
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
  }
  return {
    open: () => session.hub(),
    receive: (event: GameEvent) => session.receive(event),
    availability: (online: boolean, partner?: string) => session.availability(online, partner),
    dispose: () => { disposed = true; session.dispose(); cancelAnimationFrame(frame); cancelDrag(); back(); closeHub(); confirm?.close(); promotion?.close(); banner.remove(); surface.remove() },
  }
}
