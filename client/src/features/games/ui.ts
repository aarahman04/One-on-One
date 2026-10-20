import { openModal, type Modal } from '../../components/Modal'
import { pushBackHandler } from '../../state/backHandlers'
import {
  gameTitles,
  type ChessBoard,
  type DotsBoard,
  type GameKind,
  type GridBoard,
  type MatchAck,
  type MatchAction,
  type PongFrame,
} from '../../services/transport/MatchTransport'
import { mountChess, playerBar } from './chess'
import { mountPongCanvas } from './pongCanvas'
import { GameSession } from './session'

const svg = (shape: string) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`
const icons: Record<GameKind, string> = {
  chess: svg('<path d="M24 5v12M19 10h10M24 18c-15-9-18 5-8 11l2 8h12l2-8c10-6 7-20-8-11zM14 42h20"/>'),
  pong: svg(
    '<path d="M12 32l-7 9M15 9c15-14 38 9 24 24-10 10-34-14-24-24zM15 10l23 23"/><circle cx="9" cy="10" r="4"/>',
  ),
  connect4: svg(
    '<rect x="6" y="8" width="36" height="32" rx="4"/><circle cx="16" cy="18" r="3"/><circle cx="32" cy="18" r="3"/><circle cx="16" cy="30" r="3"/><circle cx="32" cy="30" r="3"/>',
  ),
  tictactoe: svg('<path d="M18 5v38M30 5v38M5 18h38M5 30h38M7 7l7 7M14 7l-7 7"/><circle cx="36" cy="36" r="4"/>'),
  dots: svg(
    '<path d="M8 8h32v32H8zM24 8v32M8 24h32"/><circle cx="8" cy="8" r="2"/><circle cx="24" cy="24" r="2"/><circle cx="40" cy="40" r="2"/>',
  ),
}
const descriptions: Record<GameKind, string> = {
  chess: 'A little strategy, a worthy opponent',
  pong: 'Keep the rally going · first to 7',
  connect4: 'Drop a disc, connect four',
  tictactoe: 'Three in a row, one good move',
  dots: 'Close a box, take another turn',
}
const reasons: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  insufficient_material: 'Insufficient material',
  fivefold_repetition: 'Fivefold repetition',
  seventy_five_moves: '75-move rule',
  threefold_repetition: 'Threefold repetition',
  fifty_moves: '50-move rule',
  agreement: 'Draw agreed',
  three_in_a_row: 'Three in a row',
  four_connected: 'Four connected',
  most_boxes: 'Most boxes',
  board_full: 'Board full',
  first_to_7: 'First to 7',
  resigned: 'Resigned',
  left: 'Left the game',
  abandoned: 'Did not come back in time',
  inactive: 'No moves for 30 minutes',
  connection_ended: 'The connection has ended',
}

export function mountGames(
  chat: HTMLElement,
  nickname: string,
  me: string,
  call: (event: MatchAction, payload?: Record<string, unknown>) => Promise<MatchAck>,
  paddle: (id: string, x: number) => void,
  notice: (text: string) => void,
) {
  const banner = document.createElement('div'),
    surface = document.createElement('section')
  banner.className = 'game-invite'
  banner.hidden = true
  banner.setAttribute('aria-live', 'polite')
  surface.className = 'game-surface'
  surface.hidden = true
  surface.setAttribute('aria-label', 'Game')
  surface.setAttribute('role', 'dialog')
  surface.setAttribute('aria-modal', 'true')
  chat.querySelector('.chat__log')?.before(banner)
  chat.append(surface)
  let hub: Modal | null = null,
    confirm: Modal | null = null,
    disposed = false,
    boardId = '',
    chess: ReturnType<typeof mountChess> | null = null,
    stopBoard = () => {}
  let header: HTMLElement,
    status: HTMLElement,
    identity: HTMLElement,
    grid: HTMLElement,
    above: HTMLElement,
    below: HTMLElement,
    footer: HTMLElement
  let soundPosition = '',
    soundMatch = '',
    soundOutcome = '',
    soundSeq = 0,
    wake: WakeLockSentinel | null = null,
    wakeRequest = false,
    returnFocus: HTMLElement | null = null
  let backgroundingId = ''
  const sounds = new Map<string, HTMLAudioElement>()
  const sound = (name: string) => {
    let audio = sounds.get(name)
    if (!audio) {
      audio = new Audio(`/games/${name}.ogg`)
      sounds.set(name, audio)
    }
    audio.currentTime = 0
    void audio.play().catch(() => {})
  }
  const session = new GameSession(me, call, paddle, render, notice)
  const button = (label: string, click: () => void, primary = false) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    if (primary) b.className = 'primary'
    b.onclick = click
    return b
  }
  const text = (value: string, tag = 'p') => {
    const p = document.createElement(tag)
    p.textContent = value
    return p
  }
  const closeHub = () => {
    const old = hub
    hub = null
    old?.close()
  }
  const confirmLeave = (resign = false) => {
    if (confirm || session.stage !== 'playing') return
    const box = document.createElement('div')
    box.append(text(resign ? 'Resign this game?' : 'Leave this game?', 'h2'), text(`${nickname} wins this game.`))
    confirm = openModal(box, {
      onClose: () => {
        confirm = null
      },
    })
    box.append(
      button('Keep playing', () => confirm?.close()),
      button(resign ? 'Resign' : 'Leave game', () => {
        confirm?.close()
        void session.action(resign ? 'match:resign' : 'match:leave')
      }),
    )
  }
  const back = pushBackHandler(() => {
    if (surface.hidden) return false
    if (session.stage === 'playing') confirmLeave()
    else session.done()
    return true
  })
  surface.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (session.stage === 'playing') confirmLeave()
      else session.done()
    }
    if (e.key === 'Tab') {
      const buttons = [...surface.querySelectorAll<HTMLElement>('button:not(:disabled),input')],
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
  const visibility = () => {
    if (!document.hidden && session.connected) void session.sync()
    if (document.hidden) {
      void wake?.release()
      wake = null
    }
    render()
  }
  document.addEventListener('visibilitychange', visibility)
  function render() {
    if (disposed) return
    const m = session.match,
      stage = session.stage
    if (
      document.hidden &&
      session.connected &&
      m?.game === 'pong' &&
      m.status === 'playing' &&
      !m.away.includes(me) &&
      backgroundingId !== m.id
    ) {
      const id = m.id
      backgroundingId = id
      void session.action('match:away', { away: true }).finally(() => {
        if (backgroundingId === id) backgroundingId = ''
      })
    }
    if (stage !== 'hub') closeHub()
    banner.replaceChildren()
    banner.hidden = !['incoming', 'outgoing'].includes(stage)
    if (!banner.hidden && m) {
      banner.append(
        text(
          stage === 'incoming'
            ? `${nickname} wants to play ${gameTitles[m.game]}`
            : `Waiting for ${nickname}… Invitation expires in 30 seconds.`,
          'span',
        ),
      )
      if (stage === 'incoming')
        banner.append(
          button(
            'Accept',
            () => {
              void session.action('match:accept')
            },
            true,
          ),
          button('Decline', () => {
            void session.action('match:decline')
          }),
        )
      else
        banner.append(
          button('Cancel invite', () => {
            void session.action('match:decline')
          }),
        )
    }
    if (stage === 'hub' && !hub) {
      const box = document.createElement('div')
      box.className = 'game-hub'
      box.append(text('A little time together', 'h2'), text('Choose a game'))
      for (const [kind, title] of Object.entries(gameTitles)) {
        const b = button(title, () => {
            void session.invite(kind as GameKind)
          }),
          icon = document.createElement('span')
        icon.innerHTML = icons[kind as GameKind]
        const label = document.createElement('span'),
          name = text(title, 'strong'),
          description = text(descriptions[kind as GameKind], 'small')
        label.className = 'game-hub-label'
        description.id = `game-description-${kind}`
        label.append(name, description)
        b.setAttribute('aria-label', title)
        b.setAttribute('aria-describedby', description.id)
        b.replaceChildren(icon, label)
        box.append(b)
      }
      hub = openModal(box, {
        onClose: () => {
          hub = null
          if (session.stage === 'hub') session.done()
        },
      })
    }
    const active = !!m && ['playing', 'result'].includes(stage),
      opening = surface.hidden && active
    if (opening) returnFocus = document.activeElement as HTMLElement
    surface.hidden = !active
    if (stage === 'playing' && !document.hidden && !wake && !wakeRequest && navigator.wakeLock) {
      wakeRequest = true
      void navigator.wakeLock
        .request('screen')
        .then((lock) => {
          if (disposed || session.stage !== 'playing' || document.hidden) void lock.release()
          else {
            wake = lock
            lock.addEventListener('release', () => {
              wake = null
            })
          }
        })
        .catch(() => {})
        .finally(() => {
          wakeRequest = false
        })
    }
    if (stage !== 'playing') {
      void wake?.release()
      wake = null
    }
    if (!active || !m) {
      stopBoard()
      stopBoard = () => {}
      chess = null
      boardId = ''
      if (returnFocus?.isConnected) {
        returnFocus.focus()
        returnFocus = null
      }
      return
    }
    if (boardId !== m.id) {
      stopBoard()
      chess = null
      boardId = m.id
      surface.replaceChildren()
      header = document.createElement('header')
      status = text('')
      status.className = 'game-status'
      status.setAttribute('role', 'status')
      identity = text('')
      identity.className = 'game-identity'
      above = document.createElement('div')
      above.className = 'game-above'
      below = document.createElement('div')
      below.className = 'game-below'
      footer = document.createElement('div')
      footer.className = 'game-footer'
      grid = document.createElement('div')
      grid.className = `game-board game-board--${m.game}`
      grid.setAttribute('role', 'group')
      grid.setAttribute('aria-label', `${gameTitles[m.game]} board`)
      header.append(
        button('Back', () => (session.stage === 'playing' ? confirmLeave() : session.done())),
        text(nickname, 'h2'),
        text(gameTitles[m.game], 'span'),
      )
      surface.append(header, identity, status, above, grid, below, footer)
      if (m.game === 'chess') {
        chess = mountChess(grid, session.player, (uci) => {
          void session.move({ uci })
        })
        stopBoard = chess.dispose
      } else if (m.game === 'pong' && session.pong) {
        const scoreboard = text('')
        scoreboard.className = 'pong-score'
        above.append(scoreboard)
        stopBoard = mountPongCanvas(
          grid,
          session.pong,
          nickname,
          () => !session.connected || !!session.match?.paused || document.hidden || session.stage !== 'playing',
          (x) => session.paddle(x),
        )
      } else stopBoard = () => {}
      if (opening) header.querySelector('button')?.focus()
    }
    const myTurn = m.turn === me,
      enabled = stage === 'playing' && session.connected && !m.paused && !session.busy && myTurn
    identity.hidden = m.game === 'pong'
    status.hidden = m.game === 'pong' && session.connected && !m.paused && !m.away.some((u) => u !== me)
    status.textContent = !session.connected
      ? 'Reconnecting…'
      : m.paused || m.away.some((u) => u !== me)
        ? `Waiting for ${nickname} to come back…`
        : stage === 'result'
          ? ''
          : m.game === 'pong'
            ? 'First to 7'
            : session.busy
              ? 'Sending your move…'
              : myTurn
                ? 'Your move'
                : `${nickname} is thinking…`
    identity.textContent =
      m.game === 'chess'
        ? `Playing as ${session.player === 1 ? 'White' : 'Black'}`
        : m.game === 'tictactoe'
          ? `You are ${session.player === 1 ? 'X' : 'O'} · X moves first`
          : m.game === 'connect4'
            ? `${session.player === 1 ? 'You drop' : nickname + ' drops'} first · connect four in any direction`
            : m.game === 'dots'
              ? 'Close a box to go again'
              : 'Drag left and right to move your racket'
    if (m.game === 'chess' && m.board && chess) {
      const board = session.predicted || (m.board as ChessBoard)
      chess.update(board, enabled)
      below.replaceChildren(
        playerBar(
          board,
          session.player === 1,
          'You',
          stage === 'playing' && myTurn ? (board.check ? 'Check · your move' : 'Your move') : '',
        ),
      )
      const moves = document.createElement('div')
      moves.className = 'chess-history'
      moves.setAttribute('aria-label', 'Move history')
      for (let i = 0; i < board.history.length; i += 2) {
        const pair = text(`${i / 2 + 1}. ${board.history[i]} ${board.history[i + 1] || ''}`, 'span')
        moves.append(pair)
      }
      above.replaceChildren(
        moves,
        playerBar(board, session.player !== 1, nickname, stage === 'playing' && !myTurn ? 'Thinking…' : ''),
      )
      moves.scrollLeft = moves.scrollWidth
      const pos = board.fen.split(' ').slice(0, 2).join(' ')
      if (soundMatch === m.id && soundPosition !== pos && board.last && (session.predicted || m.seq > soundSeq))
        sound(board.check ? 'chess_check' : board.last.captured ? 'chess_capture' : 'chess_move')
      if (!session.predicted) soundSeq = m.seq
      soundMatch = m.id
      soundPosition = pos
    } else if (m.game !== 'pong') renderGrid(m.game, m.board as GridBoard | DotsBoard, enabled)
    const focusedAction = footer.contains(document.activeElement) ? document.activeElement?.textContent : null
    footer.replaceChildren()
    if (stage === 'result') {
      if (m.game === 'pong') {
        const score = (m.board as { score: number[] }).score,
          scoreboard = above.querySelector('.pong-score')
        if (scoreboard)
          scoreboard.textContent = `You ${score[session.player - 1]} · ${nickname} ${score[2 - session.player]} · First to 7`
        stopBoard()
        stopBoard = () => {}
        grid.querySelector('.pong-countdown')?.remove()
      }
      const outcome = m.outcome
      if (soundOutcome !== m.id) {
        soundOutcome = m.id
        sound('game_end')
      }
      footer.classList.add('game-result')
      footer.append(
        text(outcome?.winner === me ? 'You won' : outcome?.winner ? `${nickname} won` : 'A draw', 'h3'),
        text(reasons[outcome?.reason || ''] || 'The game has ended'),
      )
      const partner = m.players.find((u) => u !== me)!,
        mine = m.rematch.includes(me),
        theirs = m.rematch.includes(partner)
      footer.append(text(`Series · You ${m.series[me] || 0} · ${nickname} ${m.series[partner] || 0}`))
      if (theirs) footer.append(text(`${nickname} wants a rematch`))
      if (outcome?.reason !== 'connection_ended') {
        const rematch = button(
          mine ? `Waiting for ${nickname}…` : theirs ? 'Accept rematch' : 'Rematch',
          () => {
            void session.action('match:rematch')
          },
          true,
        )
        rematch.disabled = mine
        footer.append(
          rematch,
          button('New game', () => session.hub()),
        )
      }
      footer.append(button('Done', () => session.done()))
    } else {
      footer.classList.remove('game-result')
      if (m.game === 'pong') footer.append(text('Drag left and right to move your racket'))
      if (m.game === 'chess') {
        if (m.drawOffer && m.drawOffer !== me)
          footer.append(
            text(`${nickname} offers a draw`),
            button('Accept', () => {
              void session.action('match:draw', { action: 'accept' })
            }),
            button('Decline', () => {
              void session.action('match:draw', { action: 'decline' })
            }),
          )
        else {
          const offer = button(m.drawOffer ? 'Draw offered' : 'Offer draw', () => {
            void session.action('match:draw', { action: 'offer' })
          })
          offer.disabled = !!m.drawOffer
          footer.append(offer)
        }
        if ((m.board as ChessBoard)?.claim && myTurn)
          footer.append(
            button(
              (m.board as ChessBoard).claim === 'fifty_moves' ? 'Claim draw (50 moves)' : 'Claim draw (repetition)',
              () => {
                void session.action('match:draw', { action: 'claim' })
              },
            ),
          )
      }
      footer.append(
        button('Resign', () => confirmLeave(true)),
        button('Leave game', () => confirmLeave()),
      )
    }
    if (focusedAction) {
      const actions = [...footer.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      ;(actions.find((b) => b.textContent === focusedAction) || actions[0])?.focus()
    }
  }
  function renderGrid(kind: GameKind, board: GridBoard | DotsBoard, enabled: boolean) {
    if (!board) return
    const focus = surface.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.key
      : undefined
    grid.replaceChildren()
    const cell = (label: string, key: string, content: string, click: () => void, available: boolean) => {
      const b = button('', () => {
        if (enabled && available) click()
      })
      b.dataset.key = key
      b.setAttribute('aria-label', label)
      b.setAttribute('aria-disabled', String(!enabled || !available))
      b.innerHTML = content
      grid.append(b)
      return b
    }
    if (kind === 'tictactoe' || kind === 'connect4') {
      const b = board as GridBoard,
        cols = kind === 'tictactoe' ? 3 : 7
      b.cells.forEach((value, i) => {
        const mark =
            kind === 'connect4' || value === 2
              ? svg('<circle cx="24" cy="24" r="14"/>')
              : svg('<path d="M10 10l28 28M38 10L10 38"/>'),
          c = cell(
            `Row ${Math.floor(i / cols) + 1}, column ${(i % cols) + 1}, ${value ? (value === session.player ? 'your piece' : 'partner piece') : 'empty'}`,
            String(i),
            value ? mark : '',
            () => {
              void session.move(kind === 'tictactoe' ? { cell: i } : { col: i % 7 })
            },
            kind === 'tictactoe' ? !value : !b.cells[i % 7],
          )
        c.classList.toggle('game-cell--mine', value === session.player)
        c.classList.toggle('game-cell--other', !!value && value !== session.player)
        c.classList.toggle('game-cell--winning', b.line.includes(i))
        c.classList.toggle('game-cell--last', b.last === i)
        if (kind === 'connect4' && b.line.includes(i))
          c.querySelector('svg')?.insertAdjacentHTML('beforeend', '<circle class="win-ring" cx="24" cy="24" r="14"/>')
      })
      if (kind === 'tictactoe' && b.line.length) {
        const first = b.line[0],
          last = b.line.at(-1)!,
          line = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        line.setAttribute('viewBox', '0 0 100 100')
        line.classList.add('game-win-line')
        line.style.color = b.cells[first] === session.player ? 'var(--accent-you)' : 'var(--accent-other)'
        line.innerHTML = `<path d="M${(((first % 3) + 0.5) * 100) / 3} ${((Math.floor(first / 3) + 0.5) * 100) / 3} L${(((last % 3) + 0.5) * 100) / 3} ${((Math.floor(last / 3) + 0.5) * 100) / 3}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`
        grid.append(line)
      }
    } else if (kind === 'dots') {
      const b = board as DotsBoard
      for (let r = 0; r < 11; r++)
        for (let c = 0; c < 11; c++) {
          if (!(r % 2) && !(c % 2)) {
            const dot = document.createElement('span')
            dot.className = 'game-dot'
            grid.append(dot)
          } else if (r % 2 && c % 2) {
            const value = b.boxes[Math.floor(r / 2) * 5 + Math.floor(c / 2)],
              box = text(value ? (value === session.player ? 'You' : nickname.slice(0, 1).toUpperCase()) : '', 'span')
            box.className = `game-box ${value ? (value === session.player ? 'game-cell--mine' : 'game-cell--other') : ''}`
            grid.append(box)
          } else {
            const h = r % 2 === 0,
              row = Math.floor(r / 2),
              col = Math.floor(c / 2),
              value = (h ? b.h : b.v)[row * (h ? 5 : 6) + col],
              line = cell(
                `${h ? 'Horizontal' : 'Vertical'} line, row ${row + 1}, column ${col + 1}, ${value ? 'taken' : 'available'}`,
                `${h}-${row}-${col}`,
                '',
                () => {
                  void session.move({ h, r: row, c: col })
                },
                !value,
              )
            line.classList.add('game-line')
            line.dataset.horizontal = String(h)
            if (value) line.classList.add(value === session.player ? 'game-cell--mine' : 'game-cell--other')
            line.classList.toggle('game-cell--last', b.last?.h === h && b.last.r === row && b.last.c === col)
          }
        }
      identity.textContent = `You ${b.boxes.filter((v) => v === session.player).length} · ${nickname} ${b.boxes.filter((v) => v === 3 - session.player).length} boxes`
    }
    grid.onkeydown = (event) => {
      const buttons = [...grid.querySelectorAll<HTMLButtonElement>('button')],
        i = buttons.indexOf(document.activeElement as HTMLButtonElement),
        cols = kind === 'connect4' ? 7 : kind === 'dots' ? 5 : 3,
        delta = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols } as Record<string, number>)[event.key]
      if (delta && i >= 0) {
        event.preventDefault()
        buttons[(i + delta + buttons.length) % buttons.length].focus()
      }
    }
    if (focus) [...grid.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.dataset.key === focus)?.focus()
  }
  return {
    open: () => session.hub(),
    receive: (match: unknown) => session.receive(match),
    frame: (f: PongFrame) => {
      if (session.match?.status === 'playing') session.pong?.receive(f, session.match.id)
    },
    availability: (connected: boolean, online: boolean) => session.availability(connected, online),
    dispose: () => {
      disposed = true
      session.dispose()
      stopBoard()
      back()
      closeHub()
      confirm?.close()
      document.removeEventListener('visibilitychange', visibility)
      void wake?.release()
      for (const audio of sounds.values()) {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      banner.remove()
      surface.remove()
    },
  }
}
