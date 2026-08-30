import type { Page } from '../state/router'
import { formatClock, formatDateSeparator, formatFullTimestamp, isSameDay } from '../utils/formatTime'
import { mountMenuDropdown } from '../components/MenuDropdown'
import { openModal } from '../components/Modal'
import { applyAppearance, closeAppearance, openAppearance } from '../features/appearancePreview'
import { openLetter, openLetterComposer, type LetterPayload } from '../features/letters'
import { mountSlashCommands, runIfCommand } from '../features/slashCommands'
import { isPushSubscribed, isPushSupported, subscribeToPush, unsubscribeFromPush } from '../features/pushNotifications'
import {
  getCurrentConnection,
  getMessages,
  markRead,
  reportMessage,
  setWallpaper,
  type CurrentConnection,
  type ReactionSummary,
} from '../services/connectionsApi'
import { connectMessaging, type IncomingMessage, type MessageType } from '../services/messageService'
import type { ReactionUpdate, Transport } from '../services/transport/Transport'
import { linkifyInto } from '../utils/linkify'

const ALLOWED_EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🙏']

// CSS.escape is absent on older Safari; message ids are UUIDs, so a minimal
// attribute-value escape is enough for the `[data-id="…"]` selectors below.
const cssEsc = (s: string): string =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\\]]/g, '\\$&')

interface ChatMessage {
  id?: string
  senderId: string
  content: string
  createdAt: string
  type: MessageType
  payload: unknown | null
  replyTo?: string | null
  reactions?: ReactionSummary[]
}

interface Pending {
  tempId: string
  content: string
  row: HTMLElement
  sent: boolean
  type: MessageType
  payload: unknown
  replyTo: string | null
}

// Minimal record kept per rendered message so a reply can show a "sender +
// snippet" preview without re-fetching. Keyed by the message's server id.
interface QuotableMessage {
  id: string
  senderId: string
  content: string
  type: MessageType
}

export const ChatPage: Page = (root, go) => {
  let transport: Transport | null = null
  let unsubscribe: (() => void) | null = null
  let unsubscribeReactions: (() => void) | null = null
  let unsubscribeEnded: (() => void) | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let searchDebounce: ReturnType<typeof setTimeout> | null = null
  let focusHandler: (() => void) | null = null
  let disposed = false

  // Modals/popovers/menus append to document.body, which the router's
  // `root.innerHTML = ''` does not touch — so their teardown must be tracked
  // and run here or they (and their global listeners) outlive the page.
  const overlays = new Set<() => void>()
  let disposeMenuDropdown: (() => void) | null = null
  let disposePopover: (() => void) | null = null

  const cleanup = (): void => {
    if (disposed) return
    disposed = true
    disposePopover?.()
    disposeMenuDropdown?.()
    closeAppearance()
    for (const dispose of overlays) dispose()
    overlays.clear()
    unsubscribe?.()
    unsubscribe = null
    unsubscribeReactions?.()
    unsubscribeReactions = null
    unsubscribeEnded?.()
    unsubscribeEnded = null
    transport?.disconnect()
    transport = null
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
    if (searchDebounce) clearTimeout(searchDebounce)
    searchDebounce = null
    if (focusHandler) window.removeEventListener('focus', focusHandler)
    focusHandler = null
  }

  root.innerHTML = `<div class="screen"><div class="screen__subtitle">Loading...</div></div>`

  ;(async () => {
    const current = await getCurrentConnection()
    if (disposed) return
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
        const marks = el.querySelectorAll('mark')
        if (!marks.length) continue
        for (const m of marks) m.replaceWith(document.createTextNode(m.textContent ?? ''))
        el.normalize() // merge the split text nodes back; linkified <a> children are untouched
      }
      for (const row of log.querySelectorAll('.chat__message--current')) row.classList.remove('chat__message--current')
    }

    // Wrap every occurrence of `q` in <mark>, splitting only text nodes so any
    // linkified <a> children survive the highlight (was: el.textContent = '' + rebuild).
    const highlightMatches = (el: HTMLElement, q: string): boolean => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const textNodes: Text[] = []
      for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text)
      let found = false
      for (const node of textNodes) {
        const content = node.nodeValue ?? ''
        const lower = content.toLowerCase()
        if (!lower.includes(q)) continue
        found = true
        const frag = document.createDocumentFragment()
        let i = 0
        while (i < content.length) {
          const idx = lower.indexOf(q, i)
          if (idx === -1) {
            frag.appendChild(document.createTextNode(content.slice(i)))
            break
          }
          if (idx > i) frag.appendChild(document.createTextNode(content.slice(i, idx)))
          const mark = document.createElement('mark')
          mark.textContent = content.slice(idx, idx + q.length)
          frag.appendChild(mark)
          i = idx + q.length
        }
        node.replaceWith(frag)
      }
      return found
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
          if (!highlightMatches(el, q)) continue
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

    searchInput.addEventListener('input', () => {
      if (searchDebounce) clearTimeout(searchDebounce)
      searchDebounce = setTimeout(() => runSearch(searchInput.value), 120)
    })
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (searchDebounce) {
          clearTimeout(searchDebounce)
          searchDebounce = null
          runSearch(searchInput.value) // flush a pending debounce before stepping
        }
        stepMatch(e.shiftKey ? 1 : -1)
      }
    })
    root.querySelector<HTMLButtonElement>('#search-prev')!.addEventListener('click', () => stepMatch(-1))
    root.querySelector<HTMLButtonElement>('#search-next')!.addEventListener('click', () => stepMatch(1))
    root.querySelector<HTMLButtonElement>('#search-close')!.addEventListener('click', () => {
      if (searchDebounce) clearTimeout(searchDebounce)
      searchDebounce = null
      searchInput.value = ''
      runSearch('')
      searchBar.style.display = 'none'
    })

    const nav = root.querySelector<HTMLElement>('.chat__nav')!
    const menuBtn = root.querySelector<HTMLButtonElement>('#menu-btn')!
    const chatEl = root.querySelector<HTMLElement>('.chat')!

    // Wallpaper is shared per-connection (either member's pick applies to
    // both); style/theme stay per-device. Synced via the poll below.
    let currentWallpaper = current.wallpaper
    applyAppearance(chatEl, currentWallpaper)

    const onWallpaperChange = (value: string): void => {
      currentWallpaper = value
      applyAppearance(chatEl, currentWallpaper) // optimistic
      void setWallpaper(connectionId, value).catch(() => {
        showNotice('Could not update the wallpaper — try again.')
      })
    }

    // Push notifications: a menu toggle rather than an automatic prompt-on-load
    // (unsolicited permission prompts get auto-denied by browsers/users alike).
    // Feedback is a popup, not the quiet in-chat system line — a subscribe
    // failure is easy to miss otherwise, and the user needs to actually see it.
    // Track every body-level overlay so cleanup() can tear it (and its
    // document listeners) down on navigation.
    const openTrackedModal = (content: HTMLElement): void => {
      const dispose = (): void => modal.close()
      const modal = openModal(content, { onClose: () => overlays.delete(dispose) })
      overlays.add(dispose)
    }

    const showNotice = (message: string): void => {
      const content = document.createElement('div')
      content.className = 'notice-popup'
      content.textContent = message
      openTrackedModal(content)
    }

    const toggleNotifications = async (): Promise<void> => {
      try {
        if (await isPushSubscribed()) {
          await unsubscribeFromPush()
          showNotice('Notifications turned off.')
          return
        }
        await subscribeToPush()
        showNotice("Notifications turned on — you'll be notified when a message arrives and the app is closed.")
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown error'
        showNotice(`Could not update notifications: ${reason}`)
      }
    }

    disposeMenuDropdown = mountMenuDropdown(
      nav,
      menuBtn,
      go,
      () => {
        searchBar.style.display = 'flex'
        searchInput.focus()
      },
      () => openAppearance(nav, chatEl, currentWallpaper, onWallpaperChange),
      isPushSupported() ? () => void toggleNotifications() : undefined,
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
    const messagesById = new Map<string, QuotableMessage>()

    // --- Reactions: rendered as chips under the message body, updated live
    // via reaction:update from the transport. sendReaction() below is defined
    // after `transport` is populated by connectMessaging().
    const reactionsByMessage = new Map<string, ReactionSummary[]>()

    const renderReactionChips = (messageId: string): void => {
      const row = log.querySelector<HTMLElement>(`[data-id="${cssEsc(messageId)}"]`)
      const body = row?.querySelector<HTMLElement>('.chat__message-body')
      if (!body) return
      const list = reactionsByMessage.get(messageId) ?? []
      let container = body.querySelector<HTMLElement>('.chat__reactions')
      if (!list.length) {
        container?.remove()
        return
      }
      if (!container) {
        container = document.createElement('div')
        container.className = 'chat__reactions'
        body.append(container)
      }
      container.innerHTML = ''
      for (const r of list) {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'chat__reaction-chip' + (r.userIds.includes(myUserId) ? ' chat__reaction-chip--mine' : '')
        chip.textContent = r.userIds.length > 1 ? `${r.emoji} ${r.userIds.length}` : r.emoji
        chip.addEventListener('click', (e) => {
          e.stopPropagation()
          toggleReaction(messageId, r.emoji)
        })
        container.append(chip)
      }
    }

    const applyReactionUpdate = (update: ReactionUpdate): void => {
      const list = reactionsByMessage.get(update.messageId) ?? []
      let entry = list.find((r) => r.emoji === update.emoji)
      if (update.op === 'add') {
        if (!entry) {
          entry = { emoji: update.emoji, userIds: [] }
          list.push(entry)
        }
        if (!entry.userIds.includes(update.userId)) entry.userIds.push(update.userId)
      } else if (entry) {
        entry.userIds = entry.userIds.filter((id) => id !== update.userId)
      }
      reactionsByMessage.set(
        update.messageId,
        list.filter((r) => r.userIds.length > 0),
      )
      renderReactionChips(update.messageId)
    }

    const toggleReaction = (messageId: string, emoji: string): void => {
      const entry = (reactionsByMessage.get(messageId) ?? []).find((r) => r.emoji === emoji)
      const alreadyReacted = entry?.userIds.includes(myUserId) ?? false
      const op = alreadyReacted ? 'remove' : 'add'
      applyReactionUpdate({ messageId, emoji, userId: myUserId, op }) // optimistic; server echo reconciles
      transport?.sendReaction(messageId, emoji, op).catch(() => {
        applyReactionUpdate({ messageId, emoji, userId: myUserId, op: alreadyReacted ? 'add' : 'remove' }) // revert
      })
    }

    // A reply renders as a small quoted block above the message text; tapping
    // it scrolls to (and briefly flashes) the original.
    const quoteBlock = (replyTo: string): HTMLElement => {
      const original = messagesById.get(replyTo)
      const q = document.createElement('div')
      q.className = 'chat__quote'
      const name = document.createElement('div')
      name.className = 'chat__quote-name'
      name.textContent = original ? (original.senderId === myUserId ? 'You' : otherName) : otherName
      const snippet = document.createElement('div')
      snippet.className = 'chat__quote-snippet'
      snippet.textContent = original ? (original.type === 'letter' ? 'A letter' : original.content) : 'Original message'
      q.append(name, snippet)
      q.addEventListener('click', (e) => {
        e.stopPropagation()
        const target = log.querySelector<HTMLElement>(`[data-id="${cssEsc(replyTo)}"]`)
        if (!target) return
        target.scrollIntoView({ block: 'center' })
        target.classList.add('chat__message--flash')
        setTimeout(() => target.classList.remove('chat__message--flash'), 900)
      })
      return q
    }

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

    const dateSeparator = (at: Date): HTMLElement => {
      const sep = document.createElement('div')
      sep.className = 'chat__date-separator'
      sep.textContent = formatDateSeparator(at)
      return sep
    }

    // Pure row build (no DOM insertion, no side effects) so both the forward
    // append and the "load older" prepend can share it.
    const buildMessageRow = (message: ChatMessage, pending: boolean): HTMLElement => {
      const at = new Date(message.createdAt)
      const isMine = message.senderId === myUserId
      const row = document.createElement('div')
      row.className = 'chat__message' + (pending ? ' chat__message--pending' : '')
      row.dataset.at = message.createdAt
      if (message.id) row.dataset.id = message.id

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

      const content = message.type === 'letter' ? letterCard(message) : text

      body.append(sender)
      if (message.replyTo) body.append(quoteBlock(message.replyTo))
      body.append(content)
      if (isMine) {
        row.dataset.mine = '1' // keyed by the bubble-mode preview
        if (!pending) row.dataset.delivered = '1'
        const receipt = document.createElement('span')
        receipt.className = 'chat__receipt'
        body.append(receipt) // sits at the end of the message
      }
      body.append(fullTime)
      row.append(time, body)
      // Scoped to the message content itself, not the row/body — .chat__message-body
      // stretches to fill the row (flex: 1) in line mode, so listening on it would
      // still toggle on clicks in the empty space beside a short message.
      content.addEventListener('click', () => row.classList.toggle('chat__message--expanded'))
      return row
    }

    // Side effects after a row is in the DOM (receipts, id map, reaction chips).
    const registerMessageRow = (message: ChatMessage, row: HTMLElement): void => {
      if (message.senderId === myUserId) {
        myRows.push(row)
        applyReceipt(row)
      }
      if (message.id) {
        messagesById.set(message.id, { id: message.id, senderId: message.senderId, content: message.content, type: message.type })
        if (message.reactions?.length) reactionsByMessage.set(message.id, message.reactions)
        if (reactionsByMessage.has(message.id)) renderReactionChips(message.id)
      }
    }

    // animate: true only for a message arriving live (sent or received) this
    // session — never for history/pagination, or every past message would
    // cascade-animate in on load.
    const appendMessage = (message: ChatMessage, pending = false, animate = false): HTMLElement => {
      const at = new Date(message.createdAt)
      const isMine = message.senderId === myUserId
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80
      if (!Number.isNaN(at.getTime()) && (!lastDate || !isSameDay(lastDate, at))) {
        log.appendChild(dateSeparator(at))
        lastDate = at
      }
      const row = buildMessageRow(message, pending)
      if (animate) row.classList.add('chat__message--enter')
      log.appendChild(row)
      if (atBottom || isMine) log.scrollTop = log.scrollHeight
      registerMessageRow(message, row)
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
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80
      const el = document.createElement('div')
      el.className = 'chat__system-line'
      el.textContent = line
      log.appendChild(el)
      if (atBottom) log.scrollTop = log.scrollHeight
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

    // --- Load history (paginated newest-first; "load older" pages back) -----
    const HISTORY_PAGE = 50
    let oldestLoadedAt: string | null = null
    let loadingOlder = false

    const loadOlderBtn = document.createElement('button')
    loadOlderBtn.type = 'button'
    loadOlderBtn.className = 'chat__load-older'
    loadOlderBtn.textContent = 'Load older messages'

    const loadOlder = async (): Promise<void> => {
      if (loadingOlder || !oldestLoadedAt) return
      loadingOlder = true
      loadOlderBtn.disabled = true
      let older: Awaited<ReturnType<typeof getMessages>> = []
      try {
        older = (await getMessages(connectionId, oldestLoadedAt))
          .slice()
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      } catch {
        loadingOlder = false
        loadOlderBtn.disabled = false
        return
      }
      if (disposed) return
      if (!older.length) {
        loadOlderBtn.remove()
        return
      }
      const prevHeight = log.scrollHeight
      const prevTop = log.scrollTop
      const firstSep = loadOlderBtn.nextSibling // the original leading date separator
      let batchDate: Date | null = null
      for (const m of older) {
        const at = new Date(m.createdAt)
        if (!Number.isNaN(at.getTime()) && (!batchDate || !isSameDay(batchDate, at))) {
          log.insertBefore(dateSeparator(at), firstSep)
          batchDate = at
        }
        const row = buildMessageRow(m, false)
        log.insertBefore(row, firstSep)
        registerMessageRow(m, row)
      }
      // Drop the pre-existing leading separator if the batch already ended on that day.
      if (
        firstSep instanceof HTMLElement &&
        firstSep.classList.contains('chat__date-separator') &&
        batchDate &&
        isSameDay(batchDate, new Date(older[older.length - 1].createdAt))
      ) {
        firstSep.remove()
      }
      oldestLoadedAt = older[0].createdAt
      log.scrollTop = prevTop + (log.scrollHeight - prevHeight)
      if (older.length < HISTORY_PAGE) loadOlderBtn.remove()
      else {
        loadingOlder = false
        loadOlderBtn.disabled = false
      }
    }
    loadOlderBtn.addEventListener('click', () => void loadOlder())

    const history = (await getMessages(connectionId))
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    if (disposed) return
    for (const message of history) appendMessage(message)
    if (!history.length) appendSystemLine('Say hello — this is the start of your one-on-one.')
    oldestLoadedAt = history[0]?.createdAt ?? null
    if (history.length >= HISTORY_PAGE) log.prepend(loadOlderBtn)
    refreshReceipts()
    renderBanner(current)
    reconcileLeave(current)
    updatePresence(current.otherLastReadAt)
    void markRead(connectionId).catch(() => {})

    // --- Outgoing (optimistic) --------------------------------------------
    const pending: Pending[] = []

    const trySend = (entry: Pending): void => {
      if (!transport) return // stays queued; flushed on (re)connect
      entry.sent = true
      entry.row.classList.remove('chat__message--failed')
      transport.sendMessage(entry.content, entry.type, entry.payload, entry.replyTo, entry.tempId).catch(() => {
        entry.sent = false
        entry.row.classList.add('chat__message--failed')
      })
    }

    const flushPending = (): void => {
      for (const entry of pending) if (!entry.sent) trySend(entry)
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

    const sendMessage = (
      content: string,
      type: MessageType = 'text',
      payload: unknown = null,
      replyTo: string | null = null,
    ): void => {
      const tempId = crypto.randomUUID()
      const row = appendMessage(
        { senderId: myUserId, content, createdAt: new Date().toISOString(), type, payload, replyTo },
        true,
        true,
      )
      const entry: Pending = { tempId, content, row, sent: false, type, payload, replyTo }
      pending.push(entry)
      trySend(entry)
    }

    // --- Reply: swipe (phone) or right-click "Reply" (desktop) sets a target;
    // the next send carries it as replyTo and clears the bar.
    const replyBar = root.querySelector<HTMLDivElement>('#reply-bar')!
    const replyBarName = root.querySelector<HTMLDivElement>('#reply-bar-name')!
    const replyBarSnippet = root.querySelector<HTMLDivElement>('#reply-bar-snippet')!
    let replyTarget: QuotableMessage | null = null

    const renderReplyBar = (): void => {
      if (!replyTarget) {
        replyBar.classList.remove('chat__reply-bar--visible')
        return
      }
      replyBarName.textContent = replyTarget.senderId === myUserId ? 'You' : otherName
      replyBarSnippet.textContent = replyTarget.type === 'letter' ? 'A letter' : replyTarget.content
      replyBar.classList.add('chat__reply-bar--visible')
    }

    const startReply = (id: string): void => {
      const target = messagesById.get(id)
      if (!target) return
      replyTarget = target
      renderReplyBar()
      input.focus()
    }

    const cancelReply = (): void => {
      replyTarget = null
      renderReplyBar()
    }

    root.querySelector<HTMLButtonElement>('#reply-bar-cancel')!.addEventListener('click', cancelReply)

    const send = (): void => {
      const content = input.value.trim()
      if (!content) return
      input.value = ''
      autoGrow()
      const replyTo = replyTarget?.id ?? null
      cancelReply()
      sendMessage(content, 'text', null, replyTo)
    }

    const slashCtx = {
      input,
      writeLetter: () =>
        openLetterComposer({
          toName: current.otherNickname ?? 'them',
          onSend: (letterBody, letterPayload) => {
            sendMessage(letterBody, 'letter', letterPayload)
            cancelReply() // letters don't carry reply context; don't leave the bar stuck open
          },
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

    // --- Popover shared by the desktop context menu and the phone emoji
    // picker — a small `.menu` clone anchored to a message (or a click point)
    // and clamped so it can never leave the visible viewport.
    let ctxMenu: HTMLElement | null = null
    let menuCleanup: (() => void) | null = null
    // After a long-press opens the menu, the browser still fires a synthetic
    // click on touchend — swallow clicks for a moment so it doesn't
    // immediately dismiss the menu it just opened (or toggle the row).
    let suppressClickUntil = 0
    const closeCtxMenu = (): void => {
      menuCleanup?.()
      menuCleanup = null
      ctxMenu?.remove()
      ctxMenu = null
    }

    const swallowGhostClick = (e: MouseEvent): void => {
      if (Date.now() < suppressClickUntil) {
        e.stopImmediatePropagation()
        e.preventDefault()
      }
    }
    document.addEventListener('click', swallowGhostClick, { capture: true })
    disposePopover = () => {
      closeCtxMenu()
      document.removeEventListener('click', swallowGhostClick, { capture: true })
    }

    type Anchor = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>

    const openPopover = (anchor: Anchor, build: (menu: HTMLElement) => void): void => {
      closeCtxMenu()
      const M = 8 // safe margin from every viewport edge
      const menu = document.createElement('div')
      menu.className = 'menu chat__ctx-menu'
      menu.style.visibility = 'hidden'
      menu.style.left = '0'
      menu.style.top = '0'
      build(menu)
      document.body.append(menu)

      const place = (): void => {
        const vv = window.visualViewport
        const vw = vv?.width ?? document.documentElement.clientWidth
        const vh = vv?.height ?? document.documentElement.clientHeight
        const ox = vv?.offsetLeft ?? 0
        const oy = vv?.offsetTop ?? 0
        menu.style.maxWidth = `${vw - 2 * M}px`
        const r = menu.getBoundingClientRect()
        let left = anchor.left + anchor.width / 2 - r.width / 2
        left = Math.max(ox + M, Math.min(left, ox + vw - r.width - M))
        let top = anchor.top - r.height - M // prefer above the message
        if (top < oy + M) top = anchor.top + anchor.height + M // not enough room — flip below
        top = Math.max(oy + M, Math.min(top, oy + vh - r.height - M))
        menu.style.left = `${left}px`
        menu.style.top = `${top}px`
        menu.style.visibility = ''
      }
      place()

      ctxMenu = menu
      const onScroll = (): void => closeCtxMenu()
      const onResize = (): void => place()
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') closeCtxMenu()
      }
      const onDocClick = (): void => closeCtxMenu()
      log.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onResize)
      window.visualViewport?.addEventListener('resize', onResize)
      window.visualViewport?.addEventListener('scroll', onScroll)
      document.addEventListener('keydown', onKey)
      const armTimer = setTimeout(() => document.addEventListener('click', onDocClick, { once: true }), 0)
      menuCleanup = () => {
        clearTimeout(armTimer)
        log.removeEventListener('scroll', onScroll)
        window.removeEventListener('resize', onResize)
        window.visualViewport?.removeEventListener('resize', onResize)
        window.visualViewport?.removeEventListener('scroll', onScroll)
        document.removeEventListener('keydown', onKey)
        document.removeEventListener('click', onDocClick)
      }
    }

    const buildEmojiRow = (menu: HTMLElement, messageId: string): void => {
      const row = document.createElement('div')
      row.className = 'chat__emoji-picker'
      for (const emoji of ALLOWED_EMOJI) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'chat__emoji-picker-btn'
        btn.textContent = emoji
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          toggleReaction(messageId, emoji)
          closeCtxMenu()
        })
        row.append(btn)
      }
      menu.append(row)
    }

    const menuItem = (label: string, danger: boolean, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'menu__item' + (danger ? ' menu__item--danger' : '')
      btn.textContent = label
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        onClick()
      })
      return btn
    }

    // The message menu: emoji row + Copy + Report everywhere; Reply only on
    // desktop (phone replies via the right-swipe gesture).
    const buildMessageMenu = (menu: HTMLElement, messageId: string, isDesktop: boolean): void => {
      buildEmojiRow(menu, messageId)
      const message = messagesById.get(messageId)
      if (isDesktop) {
        menu.append(
          menuItem('Reply', false, () => {
            startReply(messageId)
            closeCtxMenu()
          }),
        )
      }
      if (message?.type === 'text') {
        menu.append(
          menuItem('Copy', false, () => {
            closeCtxMenu()
            const text = message.content
            if (navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(text).catch(() => showNotice('Could not copy.'))
            } else {
              showNotice('Copy is not available in this browser.')
            }
          }),
        )
      }
      menu.append(
        menuItem('Report', true, () => {
          closeCtxMenu()
          openReportModal(messageId)
        }),
      )
    }

    const openReportModal = (messageId: string): void => {
      const box = document.createElement('div')
      box.className = 'notice-popup'

      const heading = document.createElement('div')
      heading.className = 'letter-compose__title'
      heading.textContent = 'Report this message?'

      const explain = document.createElement('div')
      explain.className = 'letter-compose__to'
      explain.textContent = "We'll review it. Add a note if you'd like (optional)."

      const reason = document.createElement('textarea')
      reason.className = 'letter-compose__body'
      reason.rows = 3
      reason.placeholder = 'What’s wrong with this message?'

      const actions = document.createElement('div')
      actions.className = 'letter-view__actions'
      const cancelBtn = document.createElement('button')
      cancelBtn.type = 'button'
      cancelBtn.textContent = 'Cancel'
      const reportBtn = document.createElement('button')
      reportBtn.type = 'button'
      reportBtn.className = 'primary'
      reportBtn.textContent = 'Report'
      actions.append(cancelBtn, reportBtn)

      box.append(heading, explain, reason, actions)
      const dispose = (): void => modal.close()
      const modal = openModal(box, { onClose: () => overlays.delete(dispose) })
      overlays.add(dispose)

      cancelBtn.addEventListener('click', () => modal.close())
      reportBtn.addEventListener('click', () => {
        reportBtn.disabled = true
        void reportMessage(messageId, reason.value.trim())
          .then(() => {
            modal.close()
            showNotice('Thanks — this message has been reported.')
          })
          .catch(() => {
            reportBtn.disabled = false
            showNotice('Could not send the report — try again.')
          })
      })
    }

    // --- Reply / react gestures: right-swipe = reply, long-press = react on
    // phone; right-click opens Reply/React on desktop.
    const SWIPE_TRIGGER = 60
    const SWIPE_MAX = 80
    const LONG_PRESS_MS = 450
    let swipeRow: HTMLElement | null = null
    let swipeStartX = 0
    let swipeStartY = 0
    let swiping = false
    let swipeIcon: HTMLElement | null = null
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    // Android fires a native contextmenu ~right after the long-press timer;
    // this dedupes so the menu isn't built twice for the same message.
    let lastMenuFor: string | null = null

    const cancelLongPress = (): void => {
      if (longPressTimer) clearTimeout(longPressTimer)
      longPressTimer = null
    }

    const ensureSwipeIcon = (): HTMLElement => {
      if (!swipeIcon) {
        swipeIcon = document.createElement('div')
        swipeIcon.className = 'chat__swipe-icon'
        // A plain reply-arrow glyph, not an emoji-style character.
        swipeIcon.innerHTML =
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>'
        log.appendChild(swipeIcon)
      }
      return swipeIcon
    }

    log.addEventListener(
      'touchstart',
      (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.chat__message')
        if (!row?.dataset.id) return
        swipeRow = row
        swipeStartX = e.touches[0].clientX
        swipeStartY = e.touches[0].clientY
        swiping = false
        const id = row.dataset.id
        longPressTimer = setTimeout(() => {
          longPressTimer = null
          swipeRow = null // cancel any in-progress reply-swipe tracking
          suppressClickUntil = Date.now() + 600 // eat the trailing touchend->click
          lastMenuFor = id
          const bubble = row.querySelector<HTMLElement>('.chat__message-body') ?? row
          openPopover(bubble.getBoundingClientRect(), (menu) => buildMessageMenu(menu, id, false))
        }, LONG_PRESS_MS)
      },
      { passive: true },
    )

    log.addEventListener(
      'touchmove',
      (e) => {
        if (!swipeRow) return
        const dx = e.touches[0].clientX - swipeStartX
        const dy = e.touches[0].clientY - swipeStartY
        if (!swiping) {
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
          cancelLongPress()
          if (Math.abs(dy) > Math.abs(dx)) {
            swipeRow = null // vertical scroll — let it through, not a reply swipe
            return
          }
          swiping = true
        }
        // Axis committed horizontal — block native scroll for the rest of this
        // gesture so a diagonal swipe can't scroll the page and reply at once.
        // Needs { passive: false } on this listener to have any effect; the
        // touch-action: pan-y on .chat__log keeps vertical scroll native/smooth
        // for gestures that never reach here.
        e.preventDefault()
        if (dx <= 0) {
          swipeRow.style.transform = ''
          return
        }
        const clamped = Math.min(dx, SWIPE_MAX)
        swipeRow.style.transform = `translateX(${clamped}px)`
        const ready = clamped >= SWIPE_TRIGGER
        swipeRow.classList.toggle('chat__message--swipe-ready', ready)

        const icon = ensureSwipeIcon()
        const rowRect = swipeRow.getBoundingClientRect()
        const logRect = log.getBoundingClientRect()
        icon.style.top = `${rowRect.top - logRect.top + log.scrollTop + rowRect.height / 2 - 8}px`
        icon.style.opacity = String(Math.min(clamped / SWIPE_TRIGGER, 1))
        icon.classList.toggle('chat__swipe-icon--ready', ready)
      },
      { passive: false },
    )

    log.addEventListener('touchend', () => {
      cancelLongPress()
      if (!swipeRow) return
      const triggered = swipeRow.classList.contains('chat__message--swipe-ready')
      const id = swipeRow.dataset.id!
      swipeRow.style.transform = ''
      swipeRow.classList.remove('chat__message--swipe-ready')
      swipeIcon?.remove()
      swipeIcon = null
      swipeRow = null
      if (triggered) startReply(id)
    })

    log.addEventListener('contextmenu', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.chat__message')
      if (!row?.dataset.id) return
      e.preventDefault()
      const id = row.dataset.id
      // The long-press timer already opened this menu on touch — don't rebuild.
      if (Date.now() < suppressClickUntil && lastMenuFor === id) return
      // Anchor to the bubble, not the cursor (e.clientX/Y), so the menu opens
      // in the same place relative to the message every time — not shifted
      // left/right depending on where inside it you happened to right-click.
      const bubble = row.querySelector<HTMLElement>('.chat__message-body') ?? row
      openPopover(bubble.getBoundingClientRect(), (menu) => buildMessageMenu(menu, id, true))
    })

    // --- Incoming ----------------------------------------------------------
    const onIncoming = (message: IncomingMessage): void => {
      // Reconcile our own optimistic row by the client tempId echoed back —
      // never by content (server may normalise it) which duplicated rows.
      if (message.senderId === myUserId && message.tempId) {
        const idx = pending.findIndex((p) => p.tempId === message.tempId)
        if (idx >= 0) {
          const [entry] = pending.splice(idx, 1)
          entry.row.classList.remove('chat__message--pending', 'chat__message--failed')
          entry.row.dataset.at = message.createdAt
          entry.row.dataset.id = message.id
          entry.row.dataset.delivered = '1'
          messagesById.set(message.id, { id: message.id, senderId: message.senderId, content: message.content, type: message.type })
          applyReceipt(entry.row)
          return
        }
      }
      // Dedup: a reconnect can re-deliver recent message:new events.
      if (message.id && messagesById.has(message.id)) return

      appendMessage(message, false, true)
      if (message.senderId !== myUserId) {
        void markRead(connectionId).catch(() => {})
      }
    }

    // --- Connect (non-blocking: chat is already usable) --------------------
    let connecting = false
    const attachTransport = (t: Transport): void => {
      transport = t
      unsubscribe = t.onMessage(onIncoming)
      unsubscribeReactions = t.onReaction(applyReactionUpdate)
      unsubscribeEnded = t.onConnectionEnded(() => {
        if (!disposed) go('connection-id')
      })
      flushPending()
      void markRead(connectionId).catch(() => {})
    }
    const ensureConnected = async (): Promise<void> => {
      if (transport || connecting || disposed) return
      connecting = true
      try {
        const t = await connectMessaging()
        if (disposed) {
          t.disconnect()
          return
        }
        attachTransport(t)
      } catch {
        /* chat stays usable; retried on the next poll tick */
      } finally {
        connecting = false
      }
    }
    void ensureConnected()

    focusHandler = () => void markRead(connectionId).catch(() => {})
    window.addEventListener('focus', focusHandler)

    // --- Poll: leave state, termination, seen, reconnect ------------------
    const poll = async (): Promise<void> => {
      void ensureConnected() // recover a failed initial transport
      if (transport && pending.some((p) => !p.sent)) flushPending() // retry stuck sends

      let next: CurrentConnection | null
      try {
        next = await getCurrentConnection()
      } catch {
        return
      }
      if (disposed) return
      if (!next) {
        go('connection-id') // terminated; router runs cleanup
        return
      }
      reconcileLeave(next)
      renderBanner(next)
      otherLastRead = next.otherLastReadAt
      refreshReceipts()
      updatePresence(next.otherLastReadAt)
      if (next.wallpaper !== currentWallpaper) {
        currentWallpaper = next.wallpaper
        applyAppearance(chatEl, currentWallpaper)
      }
      // Keep marking read while the chat is actually on screen — makes the
      // other side's "seen" tick reliable even if a discrete event was missed.
      if (document.visibilityState === 'visible') void markRead(connectionId).catch(() => {})
    }

    // Self-scheduling so a slow tick can't stack overlapping polls.
    const schedulePoll = (): void => {
      if (disposed) return
      pollTimer = setTimeout(() => {
        void poll().finally(schedulePoll)
      }, 4000)
    }
    if (!disposed) schedulePoll()
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
      <div class="chat__reply-bar" id="reply-bar">
        <div class="chat__reply-bar-info">
          <div class="chat__reply-bar-name" id="reply-bar-name"></div>
          <div class="chat__reply-bar-snippet" id="reply-bar-snippet"></div>
        </div>
        <button type="button" class="chat__reply-bar-cancel" id="reply-bar-cancel">✕</button>
      </div>
      <form class="chat__input-bar" id="composer">
        <textarea id="message-input" placeholder="Type a message..." autocomplete="off" enterkeyhint="send" rows="1"></textarea>
        <button class="primary" id="send-btn" type="submit">&uarr;</button>
      </form>
    </div>
  `

  root.querySelector<HTMLDivElement>('#nav-title')!.textContent = displayName
}
