import type { Page, Screen } from '../state/router'
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

    renderChat(root, go, otherName)
    const log = root.querySelector<HTMLDivElement>('#chat-log')!

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

      body.append(sender, text, fullTime)
      row.append(time, body)
      row.addEventListener('click', () => row.classList.toggle('chat__message--expanded'))
      log.appendChild(row)
      log.scrollTop = log.scrollHeight
      return row
    }

    // --- Read receipts ("Seen") -------------------------------------------
    const seenLabel = document.createElement('div')
    seenLabel.className = 'chat__seen'
    seenLabel.textContent = 'Seen'
    let myLastRow: HTMLElement | null = null
    let myLastAt: string | null = null

    const updateSeen = (otherLastReadAt: string | null): void => {
      if (!myLastRow || !myLastAt || !otherLastReadAt || new Date(otherLastReadAt) < new Date(myLastAt)) {
        seenLabel.remove()
        return
      }
      myLastRow.insertAdjacentElement('afterend', seenLabel)
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

    // --- Load history ------------------------------------------------------
    const history = await getMessages(connectionId)
    if (disposed) return
    for (const message of history) {
      const row = appendMessage(message)
      if (message.senderId === myUserId) {
        myLastRow = row
        myLastAt = message.createdAt
      }
    }
    renderBanner(current)
    updateSeen(current.otherLastReadAt)

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
      myLastRow = row
      myLastAt = row.dataset.at!
      seenLabel.remove()
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
          if (myLastRow === entry.row) myLastAt = message.createdAt
          return
        }
      }
      const row = appendMessage(message)
      if (message.senderId === myUserId) {
        myLastRow = row
        myLastAt = message.createdAt
        seenLabel.remove()
      } else {
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
    let prevMine = current.myLeaveStep
    let prevOther = current.otherLeaveStep

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
      if (next.myLeaveStep !== prevMine) {
        appendSystemLine(
          next.myLeaveStep === 0 ? 'You kept the connection.' : `You moved to leave — ${dayWord(next.daysRemaining ?? 0)}.`,
        )
        prevMine = next.myLeaveStep
      }
      if (next.otherLeaveStep !== prevOther) {
        appendSystemLine(
          next.otherLeaveStep === 0
            ? `${otherName} kept the connection.`
            : `${otherName} moved to leave — ${dayWord(5 - next.otherLeaveStep)}.`,
        )
        prevOther = next.otherLeaveStep
      }
      renderBanner(next)
      updateSeen(next.otherLastReadAt)
    }

    pollTimer = setInterval(() => void poll(), 4000)
  })().catch(() => {
    if (!disposed) go('connection-id')
  })

  return cleanup
}

function renderChat(root: HTMLElement, go: (screen: Screen) => void, displayName: string): void {
  root.innerHTML = `
    <div class="chat">
      <div class="chat__nav">
        <div>
          <div class="chat__nav-title" id="nav-title"></div>
          <div class="chat__nav-status">connected</div>
        </div>
        <button class="chat__menu-btn" id="menu-btn">&bull;&bull;&bull;</button>
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

  const nav = root.querySelector<HTMLElement>('.chat__nav')!
  const menuBtn = root.querySelector<HTMLButtonElement>('#menu-btn')!
  mountMenuDropdown(nav, menuBtn, go)
}
