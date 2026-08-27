import type { Page } from '../state/router'
import { formatClock, formatDateSeparator, formatFullTimestamp, isSameDay } from '../utils/formatTime'
import { mountMenuDropdown } from '../components/MenuDropdown'
import { applyAppearance, openAppearance } from '../features/appearancePreview'
import { openLetter, openLetterComposer, type LetterPayload } from '../features/letters'
import { mountSlashCommands, runIfCommand } from '../features/slashCommands'
import { getCurrentConnection, getMessages, markRead, type CurrentConnection } from '../services/connectionsApi'
import { connectMessaging, type IncomingMessage, type MessageType } from '../services/messageService'
import type { Transport } from '../services/transport/Transport'
import { linkifyInto } from '../utils/linkify'

interface ChatMessage {
  senderId: string
  content: string
  createdAt: string
  type: MessageType
  payload: unknown | null
}

interface Pending {
  content: string
  row: HTMLElement
  sent: boolean
  type: MessageType
  payload: unknown
}

export const ChatPage: Page = (root, go) => {
  let transport: Transport | null = null
  let unsubscribe: (() => void) | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let focusHandler: (() => void) | null = null
  let disposed = false

  const cleanup = (): void => {
    disposed = true
    unsubscribe?.()
    transport?.disconnect()
    if (pollTimer) clearInterval(pollTimer)
    if (focusHandler) window.removeEventListener('focus', focusHandler)
  }

  root.innerHTML = `<div class="screen"><div class="screen__subtitle">Loading...</div></div>`

  ;(async () => {
    const current = await getCurrentConnection()
    if (!current || (current.status !== 'active' && current.status !== 'leave_pending')) {
      go('connection-id')
      return
    }

    const otherName = (current.otherNickname ?? 'them').toUpperCase()
    const myUserId = current.myUserId
    const connectionId = current.id

    renderChat(root, otherName)
    const log = root.querySelector<HTMLDivElement>('#chat-log')!

    // --- Search: highlight every match, jump between them with the arrows --
    const searchBar = root.querySelector<HTMLDivElement>('#chat-search')!
    const searchInput = root.querySelector<HTMLInputElement>('#search-input')!
    const searchCount = root.querySelector<HTMLSpanElement>('#search-count')!
    let matches: HTMLElement[] = []
    let currentMatch = -1

    const clearHighlights = (): void => {
      for (const el of log.querySelectorAll<HTMLElement>('.chat__message-text')) {
        if (el.querySelector('mark')) linkifyInto(el, el.textContent ?? '') // drop <mark>s, restore links
      }
      for (const row of log.querySelectorAll('.chat__message--current')) row.classList.remove('chat__message--current')
    }

    const focusCurrent = (): void => {
      matches.forEach((row, k) => row.classList.toggle('chat__message--current', k === currentMatch))
      matches[currentMatch]?.scrollIntoView({ block: 'center' })
      searchCount.textContent = matches.length ? `${currentMatch + 1}/${matches.length}` : '0/0'
    }

    const runSearch = (raw: string): void => {
      clearHighlights()
      matches = []
      currentMatch = -1
      const q = raw.trim().toLowerCase()
      if (q) {
        for (const el of log.querySelectorAll<HTMLElement>('.chat__message-text')) {
          const content = el.textContent ?? ''
          const lower = content.toLowerCase()
          if (!lower.includes(q)) continue
          el.textContent = ''
          let i = 0
          while (i < content.length) {
            const idx = lower.indexOf(q, i)
            if (idx === -1) {
              el.appendChild(document.createTextNode(content.slice(i)))
              break
            }
            if (idx > i) el.appendChild(document.createTextNode(content.slice(i, idx)))
            const mark = document.createElement('mark')
            mark.textContent = content.slice(idx, idx + q.length)
            el.appendChild(mark)
            i = idx + q.length
          }
          const row = el.closest<HTMLElement>('.chat__message')
          if (row) matches.push(row)
        }
        if (matches.length) currentMatch = matches.length - 1 // start on the most recent match
      }
      focusCurrent()
    }

    // ▲ = older match, ▼ = newer match (matches are in oldest→newest order).
    const stepMatch = (dir: number): void => {
      if (!matches.length) return
      currentMatch = (currentMatch + dir + matches.length) % matches.length
      focusCurrent()
    }

    searchInput.addEventListener('input', () => runSearch(searchInput.value))
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        stepMatch(e.shiftKey ? 1 : -1)
      }
    })
    root.querySelector<HTMLButtonElement>('#search-prev')!.addEventListener('click', () => stepMatch(-1))
    root.querySelector<HTMLButtonElement>('#search-next')!.addEventListener('click', () => stepMatch(1))
    root.querySelector<HTMLButtonElement>('#search-close')!.addEventListener('click', () => {
      searchInput.value = ''
      runSearch('')
      searchBar.style.display = 'none'
    })

    const nav = root.querySelector<HTMLElement>('.chat__nav')!
    const menuBtn = root.querySelector<HTMLButtonElement>('#menu-btn')!
    const chatEl = root.querySelector<HTMLElement>('.chat')!
    applyAppearance(chatEl) // TEMPORARY premium preview
    mountMenuDropdown(
      nav,
      menuBtn,
      go,
      () => {
        searchBar.style.display = 'flex'
        searchInput.focus()
      },
      () => openAppearance(nav, chatEl),
    )

    // --- Presence: the other side marks read every ~4s while the chat is on
    // screen, so a fresh last_read_at means they're actually here right now.
    const navStatus = root.querySelector<HTMLDivElement>('#nav-status')!
    const PRESENCE_WINDOW_MS = 15000
    const updatePresence = (otherLastReadAt: string | null): void => {
      const active = !!otherLastReadAt && Date.now() - new Date(otherLastReadAt).getTime() < PRESENCE_WINDOW_MS
      navStatus.textContent = active ? 'in chat' : 'away'
      navStatus.classList.toggle('chat__nav-status--away', !active)
    }

    // --- Message rendering -------------------------------------------------
    let lastDate: Date | null = null

    // A letter renders as a folded card in the chat; tapping opens the full letter.
    const letterCard = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as Partial<LetterPayload>
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'letter-card'
      const icon = document.createElement('span')
      icon.className = 'letter-card__icon'
      icon.textContent = '✉'
      const txt = document.createElement('span')
      txt.className = 'letter-card__text'
      txt.textContent = `A letter — to ${p.to ?? ''}, from ${p.from ?? ''}`
      const hint = document.createElement('span')
      hint.className = 'letter-card__hint'
      hint.textContent = 'tap to open'
      txt.append(document.createElement('br'), hint)
      card.append(icon, txt)
      card.addEventListener('click', (e) => {
        e.stopPropagation() // don't also toggle the row's timestamp
        openLetter(message.content, p)
      })
      return card
    }

    const appendMessage = (message: ChatMessage, pending = false): HTMLElement => {
      const at = new Date(message.createdAt)
      if (!lastDate || !isSameDay(lastDate, at)) {
        const sep = document.createElement('div')
        sep.className = 'chat__date-separator'
        sep.textContent = formatDateSeparator(at)
        log.appendChild(sep)
        lastDate = at
      }

      const isMine = message.senderId === myUserId
      const row = document.createElement('div')
      row.className = 'chat__message' + (pending ? ' chat__message--pending' : '')
      row.dataset.at = message.createdAt

      const time = document.createElement('div')
      time.className = 'chat__message-time'
      time.textContent = formatClock(at)

      const body = document.createElement('div')
      body.className = 'chat__message-body'

      const sender = document.createElement('div')
      sender.className = `chat__message-sender chat__message-sender--${isMine ? 'you' : 'other'}`
      sender.textContent = isMine ? 'YOU' : otherName

      const text = document.createElement('div')
      text.className = 'chat__message-text'
      linkifyInto(text, message.content)

      const fullTime = document.createElement('div')
      fullTime.className = 'chat__message-full-time'
      fullTime.textContent = formatFullTimestamp(at)

      body.append(sender)
      body.append(message.type === 'letter' ? letterCard(message) : text)
      if (isMine) {
        row.dataset.mine = '1' // keyed by the bubble-mode preview
        if (!pending) row.dataset.delivered = '1'
        const receipt = document.createElement('span')
        receipt.className = 'chat__receipt'
        body.append(receipt) // sits at the end of the message
      }
      body.append(fullTime)
      row.append(time, body)
      row.addEventListener('click', () => row.classList.toggle('chat__message--expanded'))
      log.appendChild(row)
      log.scrollTop = log.scrollHeight

      if (isMine) {
        myRows.push(row)
        applyReceipt(row)
      }
      return row
    }

    // --- Read receipts: a small per-message indicator on my own messages, at
    // the end of the message. Line mode renders it as a dot (green = seen,
    // hollow = unseen); bubble mode renders WhatsApp ticks (✓ sent, blue ✓✓
    // read) — both driven by these classes, styled in global.css.
    const myRows: HTMLElement[] = []
    let otherLastRead: string | null = current.otherLastReadAt

    const applyReceipt = (row: HTMLElement): void => {
      const receipt = row.querySelector<HTMLElement>('.chat__receipt')
      if (!receipt) return
      const at = row.dataset.at
      const delivered = row.dataset.delivered === '1'
      const seen = delivered && !!otherLastRead && !!at && new Date(at) <= new Date(otherLastRead)
      receipt.classList.toggle('chat__receipt--pending', !delivered)
      receipt.classList.toggle('chat__receipt--seen', seen)
    }

    const refreshReceipts = (): void => {
      for (const row of myRows) applyReceipt(row)
    }

    // --- System lines (leave events) --------------------------------------
    const appendSystemLine = (line: string): void => {
      const el = document.createElement('div')
      el.className = 'chat__system-line'
      el.textContent = line
      log.appendChild(el)
      log.scrollTop = log.scrollHeight
    }
    const dayWord = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'} remaining`

    const banner = root.querySelector<HTMLDivElement>('#leave-banner')!
    const renderBanner = (c: CurrentConnection): void => {
      if (c.status !== 'leave_pending') {
        banner.style.display = 'none'
        return
      }
      if (c.bothLeaving) banner.textContent = "You're both leaving. Open the menu to end now."
      else if (c.myLeaveStep > 0) banner.textContent = `You're leaving — ${dayWord(c.daysRemaining ?? 0)}.`
      else banner.textContent = `${otherName} is leaving — ${dayWord(5 - c.otherLeaveStep)}.`
      banner.style.display = 'block'
    }

    // Leave system-lines must survive navigation (the actor leaves chat to press
    // OK, then returns), so the last-announced steps live in sessionStorage.
    const leaveKey = `leaveSeen:${connectionId}`
    let prevMine = current.myLeaveStep
    let prevOther = current.otherLeaveStep
    try {
      const saved = JSON.parse(sessionStorage.getItem(leaveKey) ?? 'null') as { mine: number; other: number } | null
      if (saved) {
        prevMine = saved.mine
        prevOther = saved.other
      }
    } catch {
      /* ignore */
    }

    const reconcileLeave = (c: CurrentConnection): void => {
      if (c.myLeaveStep !== prevMine) {
        appendSystemLine(
          c.myLeaveStep === 0 ? 'You kept the connection.' : `You moved to leave — ${dayWord(5 - c.myLeaveStep)}.`,
        )
        prevMine = c.myLeaveStep
      }
      if (c.otherLeaveStep !== prevOther) {
        appendSystemLine(
          c.otherLeaveStep === 0
            ? `${otherName} kept the connection.`
            : `${otherName} moved to leave — ${dayWord(5 - c.otherLeaveStep)}.`,
        )
        prevOther = c.otherLeaveStep
      }
      try {
        sessionStorage.setItem(leaveKey, JSON.stringify({ mine: prevMine, other: prevOther }))
      } catch {
        /* ignore */
      }
    }

    // --- Load history ------------------------------------------------------
    const history = await getMessages(connectionId)
    if (disposed) return
    for (const message of history) appendMessage(message)
    refreshReceipts()
    renderBanner(current)
    reconcileLeave(current)
    updatePresence(current.otherLastReadAt)
    void markRead(connectionId).catch(() => {})

    // --- Outgoing (optimistic) --------------------------------------------
    const pending: Pending[] = []

    const trySend = (entry: Pending): void => {
      if (!transport) return // stays queued; flushed on connect
      entry.sent = true
      transport.sendMessage(entry.content, entry.type, entry.payload).catch(() => {
        entry.sent = false
        entry.row.classList.add('chat__message--failed')
      })
    }

    const input = root.querySelector<HTMLTextAreaElement>('#message-input')!
    const composer = root.querySelector<HTMLFormElement>('#composer')!

    // Auto-grow the composer (a textarea, so blank-line paragraph gaps survive)
    // up to a few lines, then it scrolls internally.
    const MAX_INPUT_HEIGHT = 120
    const autoGrow = (): void => {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`
    }
    input.addEventListener('input', autoGrow)
    autoGrow()

    const sendMessage = (content: string, type: MessageType = 'text', payload: unknown = null): void => {
      const row = appendMessage({ senderId: myUserId, content, createdAt: new Date().toISOString(), type, payload }, true)
      const entry: Pending = { content, row, sent: false, type, payload }
      pending.push(entry)
      trySend(entry)
    }

    const send = (): void => {
      const content = input.value.trim()
      if (!content) return
      input.value = ''
      autoGrow()
      sendMessage(content)
    }

    const slashCtx = {
      input,
      writeLetter: () =>
        openLetterComposer({
          toName: current.otherNickname ?? 'them',
          onSend: (letterBody, letterPayload) => sendMessage(letterBody, 'letter', letterPayload),
        }),
    }

    // Form submit fires for the send button and the iOS keyboard's Go/Send key.
    // A phone's soft keyboard can submit "/letter" as literal text without ever
    // producing a catchable Enter keydown, so check for an exact command match
    // here too before falling back to a normal send.
    composer.addEventListener('submit', (e) => {
      e.preventDefault()
      if (runIfCommand(input.value, slashCtx)) {
        input.value = ''
        autoGrow()
        return
      }
      send()
    })

    // Slash commands ("/letter" opens the letter composer; others insert text).
    mountSlashCommands(composer, input, slashCtx)

    // Desktop: Enter sends, Shift+Enter inserts a newline (default textarea
    // behavior). Touch devices leave Enter alone — it inserts a newline, and
    // sending happens via the button — which is what lets paragraph gaps work
    // from a phone keyboard. Registered after mountSlashCommands so an open
    // slash-menu's own Enter handling (stopImmediatePropagation) takes priority.
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !isCoarsePointer) {
        e.preventDefault()
        composer.requestSubmit()
      }
    })
    input.focus()

    // --- Incoming ----------------------------------------------------------
    const onIncoming = (message: IncomingMessage): void => {
      if (message.senderId === myUserId) {
        const idx = pending.findIndex((p) => p.content === message.content && p.type === message.type)
        if (idx >= 0) {
          const [entry] = pending.splice(idx, 1)
          entry.row.classList.remove('chat__message--pending', 'chat__message--failed')
          entry.row.dataset.at = message.createdAt
          entry.row.dataset.delivered = '1'
          applyReceipt(entry.row)
          return
        }
      }
      appendMessage(message)
      if (message.senderId !== myUserId) {
        void markRead(connectionId).catch(() => {})
      }
    }

    // --- Connect (non-blocking: chat is already usable) --------------------
    connectMessaging()
      .then((t) => {
        if (disposed) {
          t.disconnect()
          return
        }
        transport = t
        unsubscribe = t.onMessage(onIncoming)
        for (const entry of pending) if (!entry.sent) trySend(entry)
        void markRead(connectionId).catch(() => {})
      })
      .catch(() => {
        /* keep chat usable; messages stay queued and flush on a later poll-triggered reconnect */
      })

    focusHandler = () => void markRead(connectionId).catch(() => {})
    window.addEventListener('focus', focusHandler)

    // --- Poll: leave state, termination, seen ------------------------------
    const poll = async (): Promise<void> => {
      let next: CurrentConnection | null
      try {
        next = await getCurrentConnection()
      } catch {
        return
      }
      if (disposed) return
      if (!next) {
        // Connection was terminated (excluded from getCurrentConnection).
        cleanup()
        go('connection-id')
        return
      }
      reconcileLeave(next)
      renderBanner(next)
      otherLastRead = next.otherLastReadAt
      refreshReceipts()
      updatePresence(next.otherLastReadAt)
      // Keep marking read while the chat is actually on screen — makes the
      // other side's "seen" tick reliable even if a discrete event was missed.
      if (document.visibilityState === 'visible') void markRead(connectionId).catch(() => {})
    }

    pollTimer = setInterval(() => void poll(), 4000)
  })().catch(() => {
    if (!disposed) go('connection-id')
  })

  return cleanup
}

function renderChat(root: HTMLElement, displayName: string): void {
  root.innerHTML = `
    <div class="chat">
      <div class="chat__nav">
        <div>
          <div class="chat__nav-title" id="nav-title"></div>
          <div class="chat__nav-status" id="nav-status">connecting…</div>
        </div>
        <button class="chat__menu-btn" id="menu-btn">&bull;&bull;&bull;</button>
      </div>
      <div class="chat__search" id="chat-search" style="display: none;">
        <input id="search-input" placeholder="Search messages…" autocomplete="off" />
        <span class="chat__search-count" id="search-count">0/0</span>
        <button type="button" class="chat__search-nav" id="search-prev" title="Older match">▲</button>
        <button type="button" class="chat__search-nav" id="search-next" title="Newer match">▼</button>
        <button type="button" class="chat__search-close" id="search-close">✕</button>
      </div>
      <div class="chat__leave-banner" id="leave-banner" style="display: none;"></div>
      <div class="chat__log" id="chat-log"></div>
      <form class="chat__input-bar" id="composer">
        <textarea id="message-input" placeholder="Type a message..." autocomplete="off" enterkeyhint="send" rows="1"></textarea>
        <button class="primary" id="send-btn" type="submit">&uarr;</button>
      </form>
    </div>
  `

  root.querySelector<HTMLDivElement>('#nav-title')!.textContent = displayName
}
