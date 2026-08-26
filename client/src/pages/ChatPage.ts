import type { Page } from '../state/router'
import { formatClock, formatDateSeparator, formatFullTimestamp, isSameDay } from '../utils/formatTime'
import { mountMenuDropdown } from '../components/MenuDropdown'
import { getCurrentConnection, getMessages, markRead, type CurrentConnection } from '../services/connectionsApi'
import { connectMessaging, type IncomingMessage } from '../services/messageService'
import type { Transport } from '../services/transport/Transport'

interface ChatMessage {
  senderId: string
  content: string
  createdAt: string
}

interface Pending {
  content: string
  row: HTMLElement
  sent: boolean
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
        if (el.querySelector('mark')) el.textContent = el.textContent // flatten <mark>s back to plain text
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
    mountMenuDropdown(nav, menuBtn, go, () => {
      searchBar.style.display = 'flex'
      searchInput.focus()
    })

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
      text.textContent = message.content

      const fullTime = document.createElement('div')
      fullTime.className = 'chat__message-full-time'
      fullTime.textContent = formatFullTimestamp(at)

      body.append(sender, text)
      if (isMine) {
        const tick = document.createElement('span')
        tick.className = 'chat__tick'
        body.append(tick)
        row.dataset.mine = '1'
        if (!pending) row.dataset.delivered = '1'
        myRows.push(row)
        applyTick(row)
      }
      body.append(fullTime)
      row.append(time, body)
      row.addEventListener('click', () => row.classList.toggle('chat__message--expanded'))
      log.appendChild(row)
      log.scrollTop = log.scrollHeight
      return row
    }

    // --- Read receipts (delivery / read ticks, WhatsApp-style) ------------
    // dim ✓ = sending, grey ✓ = delivered (saved server-side), blue ✓✓ = seen.
    const myRows: HTMLElement[] = []
    let otherLastRead: string | null = current.otherLastReadAt

    const applyTick = (row: HTMLElement): void => {
      const tick = row.querySelector<HTMLElement>('.chat__tick')
      if (!tick) return
      const at = row.dataset.at
      let state: 'sending' | 'delivered' | 'seen' = row.dataset.delivered === '1' ? 'delivered' : 'sending'
      if (otherLastRead && at && new Date(at) <= new Date(otherLastRead)) state = 'seen'
      tick.className = `chat__tick chat__tick--${state}`
      tick.textContent = state === 'seen' ? '✓✓' : '✓'
    }

    const refreshTicks = (): void => {
      for (const row of myRows) applyTick(row)
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
    refreshTicks()
    renderBanner(current)
    reconcileLeave(current)
    updatePresence(current.otherLastReadAt)
    void markRead(connectionId).catch(() => {})

    // --- Outgoing (optimistic) --------------------------------------------
    const pending: Pending[] = []

    const trySend = (entry: Pending): void => {
      if (!transport) return // stays queued; flushed on connect
      entry.sent = true
      transport.sendMessage(entry.content).catch(() => {
        entry.sent = false
        entry.row.classList.add('chat__message--failed')
      })
    }

    const input = root.querySelector<HTMLInputElement>('#message-input')!
    const composer = root.querySelector<HTMLFormElement>('#composer')!

    const send = (): void => {
      const content = input.value.trim()
      if (!content) return
      input.value = ''
      const row = appendMessage({ senderId: myUserId, content, createdAt: new Date().toISOString() }, true)
      const entry: Pending = { content, row, sent: false }
      pending.push(entry)
      trySend(entry)
    }

    // Form submit fires for Enter (desktop) and the iOS keyboard's Go/Send key.
    composer.addEventListener('submit', (e) => {
      e.preventDefault()
      send()
    })
    input.focus()

    // --- Incoming ----------------------------------------------------------
    const onIncoming = (message: IncomingMessage): void => {
      if (message.senderId === myUserId) {
        const idx = pending.findIndex((p) => p.content === message.content)
        if (idx >= 0) {
          const [entry] = pending.splice(idx, 1)
          entry.row.classList.remove('chat__message--pending', 'chat__message--failed')
          entry.row.dataset.at = message.createdAt
          entry.row.dataset.delivered = '1'
          applyTick(entry.row)
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
      refreshTicks()
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
        <input id="message-input" placeholder="Type a message..." autocomplete="off" enterkeyhint="send" />
        <button class="primary" id="send-btn" type="submit">&uarr;</button>
      </form>
    </div>
  `

  root.querySelector<HTMLDivElement>('#nav-title')!.textContent = displayName
}
