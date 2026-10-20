import { Chess } from 'chess.js'
import type { ChessBoard } from '../../services/transport/MatchTransport'

const names: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
export const pieceUrl = (piece: string) =>
  `/games/chess/svg/${piece === piece.toUpperCase() ? 'w' : 'b'}${piece.toUpperCase()}.svg`
const letter = (p: { color: string; type: string }) => (p.color === 'w' ? p.type.toUpperCase() : p.type)
const position = (board: Chess) =>
  Object.fromEntries(
    board
      .board()
      .flat()
      .filter((p) => p !== null)
      .map((p) => [p.square, letter(p)]),
  )

export function mountChess(grid: HTMLElement, seat: number, move: (uci: string) => void) {
  let selected = '',
    current: ChessBoard,
    enabled = false,
    previous: Record<string, string> = {},
    previousPosition = ''
  let sprites = new Map<string, HTMLImageElement>(),
    promotion: HTMLElement | null = null,
    cancelDrag = () => {},
    dropped = ''
  const squareAt = (i: number) => {
    const n = seat === 1 ? i : 63 - i
    return 'abcdefgh'[n % 8] + (8 - Math.floor(n / 8))
  }
  const index = (sq: string) => {
    const n = (8 - Number(sq[1])) * 8 + 'abcdefgh'.indexOf(sq[0])
    return seat === 1 ? n : 63 - n
  }
  const locate = (img: HTMLElement, sq: string) => {
    const i = index(sq)
    img.style.left = `${(i % 8) * 12.5}%`
    img.style.top = `${Math.floor(i / 8) * 12.5}%`
  }
  const cells = Array.from({ length: 64 }, (_, i) => {
    const sq = squareAt(i),
      b = document.createElement('button')
    b.type = 'button'
    b.dataset.key = sq
    b.className = (Math.floor(i / 8) + (i % 8)) % 2 ? 'chess-square dark' : 'chess-square'
    if (i >= 56) {
      const f = document.createElement('span')
      f.className = 'chess-file'
      f.textContent = sq[0]
      b.append(f)
    }
    if (i % 8 === 0) {
      const r = document.createElement('span')
      r.className = 'chess-rank'
      r.textContent = sq[1]
      b.append(r)
    }
    b.addEventListener('click', () => destination(sq))
    b.addEventListener('pointerdown', (event) => drag(event, sq))
    grid.append(b)
    return b
  })
  grid.addEventListener('keydown', (event) => {
    const i = cells.indexOf(document.activeElement as HTMLButtonElement),
      delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 } as Record<string, number>)[event.key]
    if (i >= 0 && delta) {
      event.preventDefault()
      cells[(i + delta + 64) % 64].focus()
    }
    if (event.key === 'Escape' && promotion) {
      event.stopPropagation()
      event.preventDefault()
      promotion.remove()
      promotion = null
      selected = ''
      highlight()
      cells[0].focus()
    }
  })
  function legal() {
    try {
      return new Chess(current.fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''))
    } catch {
      return []
    }
  }
  function highlight() {
    const moves = selected ? legal().filter((m) => m.startsWith(selected)) : []
    for (const [i, b] of cells.entries()) {
      const sq = squareAt(i),
        piece = previous[sq],
        hint = moves.some((m) => m.slice(2, 4) === sq)
      b.classList.toggle('selected', sq === selected)
      b.classList.toggle('last', sq === current.last?.from || sq === current.last?.to)
      b.classList.toggle('hint', hint)
      b.classList.toggle('capture-hint', hint && !!piece)
      b.classList.toggle('check', current.check && piece === (current.fen.split(' ')[1] === 'w' ? 'K' : 'k'))
      b.setAttribute('aria-disabled', String(!enabled))
      b.inert = !!promotion
      b.setAttribute(
        'aria-label',
        `${sq}, ${piece ? `${piece === piece.toUpperCase() ? 'white' : 'black'} ${names[piece.toLowerCase()]}` : 'empty'}${hint ? ', legal destination' : ''}`,
      )
    }
  }
  function destination(to: string) {
    if (!enabled || promotion) return
    const moves = selected ? legal().filter((m) => m.startsWith(selected + to)) : []
    if (moves.length) {
      selected = ''
      if (moves.length === 1) {
        move(moves[0])
        return
      }
      const scrim = document.createElement('div'),
        strip = document.createElement('div')
      promotion = scrim
      scrim.className = 'chess-promotion-scrim'
      strip.className = 'chess-promotion'
      scrim.setAttribute('role', 'dialog')
      scrim.setAttribute('aria-modal', 'true')
      scrim.setAttribute('aria-label', 'Promote your pawn')
      const close = () => {
        scrim.remove()
        promotion = null
        highlight()
        cells[index(to)].focus()
      }
      scrim.addEventListener('click', (e) => {
        if (e.target === scrim) close()
      })
      scrim.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          const buttons = [...strip.querySelectorAll('button')],
            first = buttons[0],
            last = buttons.at(-1)
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last?.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first?.focus()
          }
        }
      })
      strip.style.left = `${(index(to) % 8) * 12.5}%`
      for (const piece of ['q', 'n', 'r', 'b']) {
        const uci = moves.find((m) => m[4] === piece)
        if (!uci) continue
        const b = document.createElement('button'),
          img = document.createElement('img')
        b.type = 'button'
        b.setAttribute('aria-label', `Promote to ${names[uci[4]]}`)
        img.alt = ''
        img.src = pieceUrl(seat === 1 ? uci[4].toUpperCase() : uci[4])
        b.append(img)
        b.onclick = () => {
          close()
          move(uci)
        }
        strip.append(b)
      }
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.textContent = '×'
      cancel.setAttribute('aria-label', 'Cancel promotion')
      cancel.onclick = close
      strip.append(cancel)
      scrim.append(strip)
      grid.append(scrim)
      highlight()
      strip.querySelector('button')?.focus()
      return
    }
    const p = previous[to]
    selected = p && (p === p.toUpperCase()) === (seat === 1) && selected !== to ? to : ''
    highlight()
  }
  function drag(event: PointerEvent, sq: string) {
    const piece = previous[sq]
    if (!enabled || promotion || !piece || (piece === piece.toUpperCase()) !== (seat === 1) || event.button !== 0)
      return
    cancelDrag()
    const startX = event.clientX,
      startY = event.clientY,
      bounds = grid.getBoundingClientRect(),
      size = bounds.width / 8,
      img = sprites.get(sq)
    if (!img) return
    let dragging = false,
      target = ''
    const end = () => {
      document.removeEventListener('pointermove', moving)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', end)
      img.classList.remove('dragging')
      img.style.transform = ''
      locate(img, sq)
      cells.forEach((b) => b.classList.remove('hover'))
    }
    const moving = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return
      if (!dragging) {
        dragging = true
        selected = sq
        highlight()
      }
      e.preventDefault()
      img.classList.add('dragging')
      img.style.left = `${e.clientX - bounds.left - size / 2}px`
      img.style.top = `${e.clientY - bounds.top - size * 0.85}px`
      const col = Math.floor((e.clientX - bounds.left) / size),
        row = Math.floor((e.clientY - bounds.top) / size)
      target = col >= 0 && col < 8 && row >= 0 && row < 8 ? squareAt(row * 8 + col) : ''
      cells.forEach((b) => b.classList.toggle('hover', b.dataset.key === target))
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return
      end()
      if (dragging) {
        e.preventDefault()
        grid.addEventListener(
          'click',
          (e) => {
            e.stopPropagation()
            e.preventDefault()
          },
          { once: true, capture: true },
        )
        dropped = target
        if (target) destination(target)
        else {
          selected = ''
          highlight()
        }
      }
    }
    cancelDrag = end
    document.addEventListener('pointermove', moving, { passive: false })
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', end)
  }
  function update(board: ChessBoard, canMove: boolean) {
    current = board
    enabled = canMove
    if (!canMove) {
      cancelDrag()
      promotion?.remove()
      promotion = null
    }
    let chess: Chess
    try {
      chess = new Chess(board.fen)
    } catch {
      grid.setAttribute('aria-label', 'Board unavailable. Reconnect to restore the game.')
      return
    }
    const next = position(chess),
      key = JSON.stringify(next)
    if (key !== previousPosition) {
      cancelDrag()
      promotion?.remove()
      promotion = null
      const last = board.last,
        tracked = new Map(sprites)
      if (last && previous[last.from]) {
        const mover = tracked.get(last.from)
        tracked.delete(last.from)
        const capture = tracked.get(last.to)
        tracked.delete(last.to)
        if (capture) {
          capture.classList.add('captured')
          capture.addEventListener('animationend', () => capture.remove(), { once: true })
        }
        if (mover) {
          mover.dataset.piece = next[last.to] || mover.dataset.piece
          tracked.set(last.to, mover)
        }
        if (previous[last.from].toLowerCase() === 'p' && last.from[0] !== last.to[0] && !previous[last.to]) {
          const ep = last.to[0] + last.from[1],
            img = tracked.get(ep)
          img?.classList.add('captured')
          img?.addEventListener('animationend', () => img.remove(), { once: true })
          tracked.delete(ep)
        }
        if (
          previous[last.from].toLowerCase() === 'k' &&
          Math.abs(last.from.charCodeAt(0) - last.to.charCodeAt(0)) === 2
        ) {
          const rank = last.to[1],
            from = (last.to[0] === 'g' ? 'h' : 'a') + rank,
            to = (last.to[0] === 'g' ? 'f' : 'd') + rank,
            rook = tracked.get(from)
          tracked.delete(from)
          if (rook) tracked.set(to, rook)
        }
      }
      const consistent =
        [...tracked.keys()].length === Object.keys(next).length &&
        [...tracked].every(([sq, img]) => next[sq] && img.dataset.piece?.toLowerCase() === next[sq].toLowerCase())
      if (!consistent) {
        for (const img of sprites.values()) img.remove()
        tracked.clear()
      }
      for (const [sq, p] of Object.entries(next)) {
        let img = tracked.get(sq)
        if (!img) {
          img = document.createElement('img')
          img.className = 'chess-piece'
          img.alt = ''
          img.draggable = false
          grid.append(img)
          tracked.set(sq, img)
        }
        img.src = pieceUrl(p)
        img.dataset.piece = p
        if (dropped === sq) {
          img.style.transition = 'none'
          locate(img, sq)
          requestAnimationFrame(() => {
            img!.style.transition = ''
          })
        } else locate(img, sq)
      }
      sprites = tracked
      previous = next
      previousPosition = key
      selected = ''
      dropped = ''
    }
    highlight()
  }
  return {
    update,
    dispose: () => {
      cancelDrag()
      promotion?.remove()
    },
  }
}

export function playerBar(board: ChessBoard, white: boolean, label: string, status = ''): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'chess-player'
  const avatar = document.createElement('span')
  avatar.className = `chess-avatar ${white ? 'white' : 'black'}`
  avatar.textContent = label.slice(0, 1).toUpperCase()
  bar.append(avatar)
  const name = document.createElement('strong')
  name.textContent = label
  bar.append(name)
  let pieces: string[] = []
  try {
    pieces = Object.values(position(new Chess(board.fen)))
  } catch {
    return bar
  }
  const captured = document.createElement('span')
  captured.className = 'chess-captured'
  for (const [type, start] of Object.entries({ Q: 1, R: 2, B: 2, N: 2, P: 8 })) {
    const p = white ? type.toLowerCase() : type
    for (let n = pieces.filter((x) => x === p).length; n < start; n++) {
      const img = document.createElement('img')
      img.src = pieceUrl(p)
      img.alt = `Captured ${white ? 'black' : 'white'} ${names[type.toLowerCase()]}`
      captured.append(img)
    }
  }
  bar.append(captured)
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 },
    balance =
      pieces.reduce((s, p) => s + (p === p.toUpperCase() ? 1 : -1) * (values[p.toLowerCase()] || 0), 0) *
      (white ? 1 : -1)
  if (balance > 0) {
    const lead = document.createElement('span')
    lead.textContent = `+${balance}`
    bar.append(lead)
  }
  if (status) {
    const state = document.createElement('span')
    state.className = 'chess-player-status'
    state.textContent = status
    bar.append(state)
  }
  return bar
}
