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
  type ReversiBoard,
  type MatchReaction,
  type MatchTransport,
} from '../../services/transport/MatchTransport'
import { mountChess, playerBar } from './chess'
import { mountPongCanvas } from './pongCanvas'
import { GameSession } from './session'
import { clockFace, clockLabel, clockPresets, clockPresetLabels, defaultClock, validClock, reactionLength, limitReaction } from './options'
import { renderAvatar } from '../profileSettings'

const svg = (shape: string) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`
const icons: Record<GameKind, string> = {
  chess: svg('<path d="M24 5v12M19 10h10M24 18c-15-9-18 5-8 11l2 8h12l2-8c10-6 7-20-8-11zM14 42h20"/>'),
  pong: '<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M9 5C17 0 27 9 22 18C19 24 12 25 7 20C2 15 3 9 9 5ZM11.5 21H16.5V31H11.5ZM28 3C33 3 33 10 28 10C23 10 23 3 28 3Z"/></svg>',
  connect4: svg(
    '<rect x="6" y="8" width="36" height="32" rx="4"/><circle cx="16" cy="18" r="3"/><circle cx="32" cy="18" r="3"/><circle cx="16" cy="30" r="3"/><circle cx="32" cy="30" r="3"/>',
  ),
  tictactoe: '<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M4 4H6L14 12V14H12L4 6ZM12 4H14V6L6 14H4V12ZM22 17A6.5 6.5 0 0 1 22 30A6.5 6.5 0 0 1 22 17ZM22 20A3.5 3.5 0 0 0 22 27A3.5 3.5 0 0 0 22 20Z"/></svg>',
  dots: svg(
    '<path d="M8 8h32v32H8zM24 8v32M8 24h32"/><circle cx="8" cy="8" r="2"/><circle cx="24" cy="24" r="2"/><circle cx="40" cy="40" r="2"/>',
  ),
  reversi: svg('<circle cx="17" cy="17" r="11" fill="currentColor"/><circle cx="31" cy="31" r="11"/>'),
}
export const gameIcon = (kind: GameKind): string => icons[kind]
const descriptions: Record<GameKind, string> = {
  chess: 'A little strategy, a worthy opponent',
  pong: 'Swipe, spin and rally',
  connect4: 'Drop a disc, connect four',
  tictactoe: 'Three in a row, one good move',
  dots: 'Close a box, take another turn',
  reversi: 'Outflank and flip · most discs wins',
}
const reasons: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  insufficient_material: 'Insufficient material',
  fivefold_repetition: 'Fivefold repetition',
  seventy_five_moves: '75-move rule',
  threefold_repetition: 'Threefold repetition',
  fifty_moves: '50-move rule',
  agreement: 'Draw by agreement',
  equal_discs: 'Equal discs',
  most_discs: 'Most discs',
  timeout: 'Time ran out',
  first_to_points: 'Target score reached',
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
  paddle: MatchTransport['sendPaddle'],
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
    incoming: Modal | null = null,
    incomingId = '',
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
  let subtitle: HTMLElement, tray: HTMLElement, info: HTMLElement
  let photo: string | null = null, gridKey = '', gridEnabled = false, trayOpen = false
  let gridMoveKey = '', gridMoveAt = 0
  const reactions = new Map<string, MatchReaction>()
  const reactionTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let gameNotice = '', noticeTimer: ReturnType<typeof setTimeout> | undefined
  const clocks: { node: HTMLElement; seat: number }[] = []
  const optionLabel = (m: NonNullable<typeof session.match>) => m.game === 'pong' ? `First to ${m.points || 7}` : m.clock ? clockLabel(m.clock.base, m.clock.inc) : 'No time limit'
  const updateClocks = () => {
    const m = session.match
    if (!m?.clock) return
    clocks.forEach(({ node, seat }) => {
      const running = m.status === 'playing' && !m.paused && m.turn === m.players[seat]
      const ms = Math.max(0, m.clock!.left[seat] - (running ? performance.now() - session.receivedAt : 0))
      node.textContent = clockFace(ms); node.classList.toggle('running', running); node.classList.toggle('low', running && ms < 10_000)
      node.setAttribute('aria-label', `${m.players[seat] === me ? 'Your' : nickname + "’s"} clock ${clockFace(ms)}`)
    })
  }
  const clockTimer = setInterval(updateClocks, 100)
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
  const session = new GameSession(me, call, paddle, render, (message) => {
    if (message === 'Your partner declined your draw offer.') {
      gameNotice = `${nickname} declined your draw offer.`
      clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { gameNotice = ''; render() }, 3500)
    } else notice(message)
  })
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
  const inviteOptions = (box: HTMLElement, kind: GameKind) => {
    box.replaceChildren(text(gameTitles[kind], 'h2'))
    const label = document.createElement('label'), select = document.createElement('select')
    const custom = document.createElement('div'), base = document.createElement('input'), inc = document.createElement('input')
    base.type = inc.type = 'number'; base.value = '180'; base.min = '10'; base.max = '10800'; base.step = '1'
    inc.value = '2'; inc.min = '0'; inc.max = '60'; inc.step = '1'
    base.setAttribute('aria-label', 'Time each in seconds'); inc.setAttribute('aria-label', 'Bonus per move in seconds')
    const baseLabel = document.createElement('label'), incLabel = document.createElement('label')
    baseLabel.append('Time each (10–10800 s)', base); incLabel.append('Added per move (0–60 s)', inc); custom.append(baseLabel, incLabel)
    let points: HTMLInputElement | null = null
    if (kind === 'pong') {
      label.append('Play to how many points? ', select)
      for (const n of ['7', '11', '21', 'Custom']) select.add(new Option(n, n))
      points = document.createElement('input'); points.type = 'number'; points.min = '1'; points.max = '99'; points.step = '1'; points.value = '7'; points.setAttribute('aria-label', 'Target score, 1 to 99')
      custom.replaceChildren(points)
    } else {
      label.append('How much time each? ', select)
      clockPresets.forEach((n, i) => select.add(new Option(clockPresetLabels[i], n === null ? '' : String(n))))
      select.add(new Option('Custom', 'Custom')); select.value = String(defaultClock(kind) ?? '')
      box.append(text('Run out of time and you lose.'))
    }
    custom.hidden = true; select.onchange = () => { custom.hidden = select.value !== 'Custom' }
    const error = text(''); error.setAttribute('role', 'status')
    box.append(label, custom, error, button(`Invite ${nickname}`, () => {
      let options: Record<string, unknown>
      if (kind === 'pong') {
        const n = Number(select.value === 'Custom' ? points!.value : select.value)
        if (!Number.isInteger(n) || n < 1 || n > 99) { error.textContent = 'Choose a score from 1 to 99.'; return }
        options = { points: n }
      } else {
        const b = Number(select.value === 'Custom' ? base.value : select.value), i = select.value === 'Custom' ? Number(inc.value) * 1000 : 0
        const ms = select.value === 'Custom' ? b * 1000 : b
        if (select.value !== '' && (!validClock(ms, i) || !base.value || !inc.value)) { error.textContent = 'Choose 10 seconds to 3 hours and a bonus from 0 to 60 seconds.'; return }
        options = { clock: select.value === '' ? null : { base: ms, inc: i } }
      }
      void session.invite(kind, options)
    }, true), button('Back', () => { closeHub(); session.hub() }))
    select.focus()
  }
  const reactionTray = () => {
    tray.replaceChildren()
    const send = (value: string) => {
      const content = limitReaction(value).trim()
      if (!content) return
      trayOpen = false; tray.hidden = true
      void session.action('match:react', { text: content })
    }
    const emojis = document.createElement('div'), lines = document.createElement('div'), form = document.createElement('form')
    for (const value of ['😂', '🔥', '😮', '👏', '😅', '😤', '❤️', '🎉']) emojis.append(button(value, () => send(value)))
    for (const value of ['Nice move!', 'Good game', 'Your turn 😄', 'Oops', 'So close!', 'Well played', 'Hurry up!', 'Rematch?']) lines.append(button(value, () => send(value)))
    const input = document.createElement('input'), counter = text('0/60', 'span')
    input.setAttribute('aria-label', 'Comment'); input.placeholder = 'Say something…'
    input.oninput = () => { input.value = limitReaction(input.value); counter.textContent = `${reactionLength(input.value)}/60` }
    const submit = button('Send comment', () => send(input.value)); submit.type = 'submit'; submit.onclick = null
    form.onsubmit = (e) => { e.preventDefault(); send(input.value) }
    form.append(input, submit, counter); tray.append(emojis, lines, form)
    input.focus()
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
    if (trayOpen) { trayOpen = false; tray.hidden = true; return true }
    if (session.stage === 'playing') confirmLeave()
    else session.done()
    return true
  })
  surface.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (trayOpen) { trayOpen = false; tray.hidden = true; return }
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
    if (incomingId && (stage !== 'incoming' || incomingId !== m?.id)) {
      incomingId = ''; incoming?.close(); incoming = null
    }
    if (stage === 'incoming' && m && !incoming && incomingId !== m.id) {
      incomingId = m.id
      const box = document.createElement('div'), icon = document.createElement('div')
      box.className = 'game-incoming'; icon.innerHTML = icons[m.game]
      box.append(icon, text(`${nickname} invites you to play`, 'h2'), text(gameTitles[m.game], 'h3'), text(optionLabel(m)))
      const decide = (accept: boolean) => { incoming?.close(); incoming = null; void session.action(accept ? 'match:accept' : 'match:decline') }
      box.append(button('Play', () => decide(true), true), button('Not now', () => decide(false)))
      incoming = openModal(box, { onClose: () => { incoming = null } })
    }
    banner.replaceChildren()
    banner.hidden = stage !== 'outgoing' && stage !== 'incoming'
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
        if (kind === 'dots') continue
        const b = button(title, () => {
            inviteOptions(box, kind as GameKind)
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
      gridKey = ''; gridMoveKey = ''; gameNotice = ''; reactions.clear(); clocks.length = 0; trayOpen = false
      reactionTimers.forEach(clearTimeout); reactionTimers.clear()
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
      info = text(''); info.className = 'game-info'; info.setAttribute('aria-live', 'polite')
      subtitle = text('', 'small'); subtitle.setAttribute('aria-live', 'polite')
      tray = document.createElement('div'); tray.className = 'game-reaction-tray'; tray.hidden = true
      grid = document.createElement('div')
      grid.className = `game-board game-board--${m.game}`
      grid.setAttribute('role', 'group')
      grid.setAttribute('aria-label', `${gameTitles[m.game]} board`)
      const avatar = document.createElement('span'); avatar.className = 'game-avatar'; renderAvatar(avatar, photo, nickname)
      const name = document.createElement('div'); name.className = 'game-name'; name.append(text(nickname, 'h2'), subtitle)
      const react = button('☺', () => { trayOpen = !trayOpen; tray.hidden = !trayOpen; if (trayOpen) reactionTray() })
      react.setAttribute('aria-label', 'React to game')
      header.append(
        button('Back', () => (session.stage === 'playing' ? confirmLeave() : session.done())),
        avatar, name, react,
      )
      const clockRow = document.createElement('div'); clockRow.className = 'game-clocks'
      if (m.clock) for (const seat of [0, 1]) {
        const node = text('', 'span'); node.className = 'game-clock'; clockRow.append(node); clocks.push({ node, seat })
      }
      surface.append(header, tray, identity, clockRow, above, grid, below, footer)
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
          (x, y, released, now, touch) => session.paddle(x, y, released, now, touch),
        )
      } else stopBoard = () => {}
      if (opening) header.querySelector('button')?.focus()
    }
    const myTurn = m.turn === me,
      enabled = stage === 'playing' && session.connected && !m.paused && !session.busy && myTurn
    subtitle.textContent = reactions.get(m.players.find((u) => u !== me)!)?.text || `${gameTitles[m.game]} · ${optionLabel(m)}`
    updateClocks()
    if (session.pong) session.pong.target = m.points || 7
    identity.hidden = m.game === 'pong'
    status.hidden = m.game === 'pong' && session.connected && !m.paused && !m.away.some((u) => u !== me)
    status.textContent = !session.connected
      ? 'Reconnecting…'
      : m.paused || m.away.some((u) => u !== me)
        ? `Waiting for ${nickname} to come back…`
        : stage === 'result'
          ? ''
          : m.game === 'pong'
            ? `First to ${m.points || 7}`
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
              : m.game === 'reversi'
                ? `You are ${session.player === 1 ? 'Black' : 'White'} · You ${(m.board as ReversiBoard).cells.filter((v) => v === session.player).length} · ${nickname} ${(m.board as ReversiBoard).cells.filter((v) => v === 3 - session.player).length} discs`
                : 'Move around your half; swipe through the ball'
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
    } else if (m.game !== 'pong') renderGrid(m.game, (session.predictedGrid || m.board) as GridBoard | DotsBoard | ReversiBoard, enabled)
    const focusedAction = footer.contains(document.activeElement) ? document.activeElement?.textContent : null
    footer.replaceChildren()
    if (stage === 'result') {
      if (m.game === 'pong') {
        const score = (m.board as { score: number[] }).score,
          scoreboard = above.querySelector('.pong-score')
        if (scoreboard)
          scoreboard.textContent = `You ${score[session.player - 1]} · ${nickname} ${score[2 - session.player]} · First to ${m.points || 7}`
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
      const resultIcon = document.createElement('div'); resultIcon.className = 'game-result-icon'; resultIcon.innerHTML = icons[m.game]
      footer.append(resultIcon)
      info.textContent = reactions.get(me)?.text || ''
      if (info.textContent) footer.append(info)
      footer.append(
        text(outcome?.winner === me ? 'You won' : outcome?.winner ? `${nickname} won` : 'A draw', 'h3'),
        text(outcome?.reason === 'most_discs' ? `${(m.board as ReversiBoard).cells.filter((v) => v === session.player).length}–${(m.board as ReversiBoard).cells.filter((v) => v === 3 - session.player).length} discs` : reasons[outcome?.reason || ''] || 'The game has ended'),
      )
      const partner = m.players.find((u) => u !== me)!,
        mine = m.rematch.includes(me),
        theirs = m.rematch.includes(partner)
      footer.append(text(`Series · You ${m.series[me] || 0} · ${nickname} ${m.series[partner] || 0}`))
      const partnerLeft = m.away.includes(partner)
      if (partnerLeft) footer.append(text(`${nickname} has left the game`))
      else if (theirs) footer.append(text(`${nickname} wants a rematch`))
      if (outcome?.reason !== 'connection_ended' && !partnerLeft) {
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
      const how = m.game === 'pong' ? 'Move around your half; swipe through the ball. A sideways brush adds spin.'
        : m.game === 'reversi' ? 'Tap a dotted square to outflank'
        : m.game === 'chess' ? 'Tap or drag a piece to move' : m.game === 'connect4' ? 'Drop a disc to connect four' : 'Take your turn'
      info.replaceChildren()
      info.classList.toggle('game-info--draw', !!m.drawOffer && m.drawOffer !== me)
      if (m.drawOffer && m.drawOffer !== me) {
        info.append(text(`${nickname} offers a draw`, 'span'), button('Decline', () => { void session.action('match:draw', { action: 'decline' }) }), button('Accept', () => { void session.action('match:draw', { action: 'accept' }) }))
      } else {
        const passed = m.game === 'reversi' && (m.board as ReversiBoard).passed
        info.textContent = gameNotice || reactions.get(me)?.text || (passed ? (myTurn ? `${nickname} has no move · your turn again` : `You have no move · ${nickname} plays again`) : !session.connected || m.paused || m.away.some((u) => u !== me) ? status.textContent : m.drawOffer ? 'Draw offered' : how)
      }
      footer.append(info)
      if (m.game === 'chess' && (m.board as ChessBoard)?.claim && myTurn) {
        const claim = button((m.board as ChessBoard).claim === 'fifty_moves' ? 'Claim draw (50 moves)' : 'Claim draw (repetition)', () => { void session.action('match:draw', { action: 'claim' }) }, true)
        claim.classList.add('game-claim'); footer.append(claim)
      }
      const actions = document.createElement('div'); actions.className = 'game-actions'
      const offer = button('Offer draw', () => { void session.action('match:draw', { action: 'offer' }) })
      offer.disabled = !!m.drawOffer || !session.connected
      actions.append(offer, button('Resign', () => confirmLeave(true)), button('Leave', () => confirmLeave()))
      footer.append(actions)
    }
    if (focusedAction) {
      const actions = [...footer.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      ;(actions.find((b) => b.textContent === focusedAction) || actions[0])?.focus()
    }
  }
  function renderGrid(kind: GameKind, board: GridBoard | DotsBoard | ReversiBoard, enabled: boolean) {
    if (!board) return
    gridEnabled = enabled
    const key = JSON.stringify(board)
    if (gridKey === key) {
      for (const b of grid.querySelectorAll<HTMLElement>('button')) {
        b.setAttribute('aria-disabled', String(!enabled || b.dataset.available !== 'true'))
        if (kind === 'reversi') b.classList.toggle('reversi-legal', enabled && b.dataset.available === 'true')
      }
      return
    }
    gridKey = key
    const moveKey = JSON.stringify('cells' in board ? [board.cells, board.last] : board)
    if (moveKey !== gridMoveKey) { gridMoveKey = moveKey; gridMoveAt = performance.now() }
    const elapsed = performance.now() - gridMoveAt
    const focus = surface.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.key
      : undefined
    grid.replaceChildren()
    const cell = (label: string, key: string, content: string, click: () => void, available: boolean) => {
      const b = button('', () => {
        if (gridEnabled && available) click()
      })
      b.dataset.key = key
      b.dataset.available = String(available)
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
        const duration = kind === 'connect4' && b.last >= 0 ? Math.round(90 + 110 * Math.sqrt(Math.floor(b.last / 7) + 1)) : kind === 'tictactoe' ? 200 : 0
        grid.style.setProperty('--drop-ms', `${duration}ms`)
        if (b.last === i && kind === 'connect4') {
          c.style.setProperty('--drop-height', `${(Math.floor(i / 7) + 1) * -100}%`)
          c.style.setProperty('--drop-duration', `${duration}ms`)
          c.querySelector('svg')!.style.animationDelay = `-${elapsed}ms,${Math.max(0, duration - elapsed)}ms`
        }
        if (b.last === i && kind === 'tictactoe') for (const shape of c.querySelectorAll<SVGElement>('svg > *')) {
          shape.setAttribute('pathLength', '100'); shape.style.animationDelay = `-${elapsed}ms`
        }
        if (kind === 'connect4' && b.line.includes(i))
          c.querySelector('svg')?.insertAdjacentHTML('beforeend', '<circle class="win-ring" cx="24" cy="24" r="14"/>')
      })
      if (b.line.length) {
        grid.style.setProperty('--drop-ms', `${Math.max(0, Number.parseFloat(grid.style.getPropertyValue('--drop-ms')) - elapsed)}ms`)
        const first = b.line[0],
          last = b.line.at(-1)!,
          line = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        line.setAttribute('viewBox', '0 0 100 100')
        line.setAttribute('preserveAspectRatio', 'none')
        line.classList.add('game-win-line')
        line.style.color = b.cells[first] === session.player ? 'var(--accent-you)' : 'var(--accent-other)'
        line.innerHTML = `<path d="M${(((first % cols) + 0.5) * 100) / cols} ${((Math.floor(first / cols) + 0.5) * 100) / (kind === 'connect4' ? 6 : 3)} L${(((last % cols) + 0.5) * 100) / cols} ${((Math.floor(last / cols) + 0.5) * 100) / (kind === 'connect4' ? 6 : 3)}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`
        grid.append(line)
      }
    } else if (kind === 'reversi') {
      const b = board as ReversiBoard
      b.cells.forEach((value, i) => {
        const c = cell(`Row ${Math.floor(i / 8) + 1}, column ${i % 8 + 1}, ${value ? value === 1 ? 'black disc' : 'white disc' : b.legal.includes(i) ? 'legal move' : 'empty'}`, String(i), '', () => { void session.move({ cell: i }) }, b.legal.includes(i))
        if (value) {
          const disc = document.createElement('span'); disc.className = `reversi-disc reversi-disc--${value}`
          if (b.last === i) disc.classList.add('reversi-drop')
          else if (b.flipped.includes(i)) {
            disc.classList.add('reversi-flip')
            const distance = Math.max(Math.abs(i % 8 - b.last % 8), Math.abs(Math.floor(i / 8) - Math.floor(b.last / 8)))
            disc.style.animationDelay = `${120 + distance * 70}ms`
            disc.style.setProperty('--previous-disc', value === 1 ? '#f6f6f2' : '#111')
          }
          c.append(disc)
        } else if (enabled && b.legal.includes(i)) c.classList.add('reversi-legal')
        c.classList.toggle('reversi-last', b.last === i)
      })
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
        cols = kind === 'connect4' ? 7 : kind === 'dots' ? 5 : kind === 'reversi' ? 8 : 3,
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
    setPhoto: (url: string | null) => { photo = url; const avatar = surface.querySelector<HTMLElement>('.game-avatar'); if (avatar) renderAvatar(avatar, photo, nickname) },
    reaction: (value: unknown) => {
      const r = value as MatchReaction, m = session.match
      if (!r || !m || !['playing', 'over'].includes(m.status) || r.matchId !== m.id || !m.players.includes(r.from) || typeof r.id !== 'string' || !r.id || r.id.length > 64 || typeof r.text !== 'string' || !r.text.trim() || reactionLength(r.text) > 60 || /[\r\n]/.test(r.text)) return
      if (reactions.get(r.from)?.id === r.id) return
      clearTimeout(reactionTimers.get(r.from)); reactions.set(r.from, r)
      reactionTimers.set(r.from, setTimeout(() => { reactions.delete(r.from); render() }, 3500)); render()
    },
    frame: (f: PongFrame) => {
      if (session.match?.status === 'playing') session.pong?.receive(f, session.match.id)
    },
    availability: (connected: boolean, online: boolean) => session.availability(connected, online),
    dispose: () => {
      disposed = true
      clearInterval(clockTimer); clearTimeout(noticeTimer); reactionTimers.forEach(clearTimeout)
      incomingId = ''; incoming?.close()
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
