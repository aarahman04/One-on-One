import type { Page } from '../state/router'
import { pushBackHandler } from '../state/backHandlers'
import { openPanel } from '../state/activePanel'
import {
  formatDateSeparator,
  formatCallDuration,
  formatDuration,
  formatFullTimestamp,
  formatMessageTime,
  isSameDay,
} from '../utils/formatTime'
import { downloadFile, downloadFromUrl, formatFileSize } from '../utils/download'
import { loadingScreenHtml } from '../utils/loadingScreen'
import { mountMenuDropdown } from '../components/MenuDropdown'
import { openModal } from '../components/Modal'
import { showToast } from '../components/Toast'
import { applyAppearance, closeAppearance, openAppearance } from '../features/appearancePreview'
import { openLetter, openLetterComposer, type LetterPayload } from '../features/letters'
import { formatCountdown, openCountdownComposer, type CountdownPayload } from '../features/countdown'
import { moodEmoji, openCheckinComposer, type CheckinPayload } from '../features/checkin'
import { openAskAnswerModal, openAskComposer, type AskPayload } from '../features/ask'
import { openThisOrThatAnswerModal, openThisOrThatComposer, type ThisOrThatPayload } from '../features/thisorthat'
import { AUTO_CLEAR_MS as ALARM_AUTO_CLEAR_MS, confirmSendAlarm, createAlarmController, type AlarmController } from '../features/alarm'
import {
  getNativeAlarmState,
  isAlarmSilenced,
  maybePromptFullScreenIntent,
  setNativeChatActive,
} from '../features/alarmNative'
import { writeLocationFlow, type LocationPayload } from '../features/location'
import { mountSlashCommands, runIfCommand } from '../features/slashCommands'
import { getNotificationsLabel, isPushSubscribed, isPushSupported, subscribeToPush, unsubscribeFromPush } from '../features/pushNotifications'
import {
  getCurrentConnection,
  getMessages,
  markRead,
  reportConnectionUser,
  reportMessage,
  setWallpaper,
  setNickname,
  blockAndEnd,
  type CurrentConnection,
  type ReactionSummary,
} from '../services/connectionsApi'
import { openBlockConfirm } from '../features/blockUser'
import { openDeleteAccountDialog } from '../features/deleteAccount'
import { ensurePermissionRationale } from '../features/permissionRationale'
import {
  connectMessaging,
  getLinkPreview,
  getCallTransport,
  type IncomingMessage,
  type MessageType,
  type ReactionUpdate,
  type Transport,
  type TransportState,
  type PinState,
  type PresenceUpdate,
} from '../services/messageService'
import { mountCallBar, type CallBarHandle } from '../features/call/controller'
import {
  CALL_LOG_IN_ICON,
  CALL_LOG_OUT_ICON,
  CALL_LOG_VIDEO_IN_ICON,
  CALL_LOG_VIDEO_OUT_ICON,
  CALL_PHONE_ICON,
  CALL_VIDEO_ICON,
} from '../features/call/icons'
import { getSignedUrls, uploadAttachment } from '../services/attachmentsApi'
import { startRecording, type VoiceRecorderHandle } from '../features/voiceRecorder'
import { linkifyInto, messageLinks, safeWebUrl } from '../utils/linkify'
import { animateOutAndRemove } from '../utils/animateOut'
import { canDelete, canEdit, DELETED_MESSAGE, EDIT_WINDOW_MS, matchRanges, notificationReminderDue, previewImageUrl } from '../utils/chatRules'
import { openEmojiPicker } from '../features/emojiPicker'
import { isSticker, metaSide } from '../utils/stickerMath'
import { openMediaPicker } from '../features/mediaPicker'
import { stickerBlob } from '../features/stickerMaker'
import { privatePhoto } from '../features/stickerLibrary'
import { openProfileSettings, renderAvatar } from '../features/profileSettings'
import { getAvatars, prepareGif } from '../services/profileGifApi'
import { CAMERA_ICON, STICKER_ICON } from '../features/chatIcons'
import { ALARM_ICON, CHECK_ICON, CHOICE_ICON, CLOSE_ICON, COPY_ICON, COUNTDOWN_ICON, DELETE_ICON, EDIT_ICON, FILE_ICON, LETTER_ICON, LOCATION_ICON, LOCK_ICON, MORE_ICON, PIN_ICON, PLUS_ICON, REACT_ICON, REPLY_ICON } from '../features/chatIcons'

const ALLOWED_EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🙏']

interface ChatMessage {
  id?: string
  senderId: string
  content: string
  createdAt: string
  type: MessageType
  payload: unknown | null
  replyTo?: string | null
  reactions?: ReactionSummary[]
  editedAt?: string | null
  deletedAt?: string | null
}

// A real (server-issued, uuid) message id — never an optimistic placeholder.
const ALARM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
interface QuotableMessage extends ChatMessage {
  id: string
}

// payload shapes for the three attachment message types (validated
// server-side in messageService.validateMediaPayload; read defensively here).
interface ImagePayload {
  path: string
  mime: string
  size: number
  width: number
  height: number
  // Client-only, never sent to the server: an object URL over the local file,
  // set on your OWN just-picked photo so it renders instantly from the file
  // you already have instead of waiting on upload + a signed-URL fetch.
  localUrl?: string
  // Signed server-side at broadcast time (socketServer's message:send
  // handler) so both sides get a viewable URL in the same event, instead of
  // each one making its own follow-up signed-URL request to render it.
  url?: string
}
interface VoicePayload {
  path: string
  mime: string
  size: number
  duration: number
}
interface FilePayload {
  path: string
  mime: string
  size: number
  name: string
}

function mediaPathOf(message: ChatMessage): string | null {
  if (message.type !== 'image' && message.type !== 'voice' && message.type !== 'file') return null
  const p = message.payload as { path?: unknown } | null
  return typeof p?.path === 'string' ? p.path : null
}

// Short label standing in for a non-text message's content — used wherever a
// message is quoted rather than rendered in full (reply preview, reply bar).
function mediaLabel(type: MessageType): string | null {
  switch (type) {
    case 'letter':
      return 'A letter'
    case 'image':
      return 'Photo'
    case 'voice':
      return 'Voice message'
    case 'file':
      return 'File'
    case 'countdown':
      return 'Countdown'
    case 'checkin':
      return 'Check-in'
    case 'alarm':
      return 'Emergency alarm'
    default:
      return null
  }
}

export const ChatPage: Page = (root, go) => {
  let transport: Transport | null = null
  let unsubscribe: (() => void) | null = null
  let unsubscribeReactions: (() => void) | null = null
  let unsubscribeEnded: (() => void) | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let searchDebounce: ReturnType<typeof setTimeout> | null = null
  let focusHandler: (() => void) | null = null
  let viewportResizeHandler: (() => void) | null = null
  let viewportFrame = 0
  let rowRemovalObserver: MutationObserver | null = null
  const rowsById = new Map<string, HTMLElement>()
  const rowResources = new Map<HTMLElement, () => void>()
  let alarmController: AlarmController | null = null
  let disposed = false

  // Modals/popovers/menus append to document.body, which the router's
  // `root.innerHTML = ''` does not touch — so their teardown must be tracked
  // and run here or they (and their global listeners) outlive the page.
  const overlays = new Set<() => void>()
  let disposeMenuDropdown: (() => void) | null = null
  let disposePopover: (() => void) | null = null
  let callBar: CallBarHandle | null = null
  let unregisterSearchBack: (() => void) | null = null

  const cleanup = (): void => {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(viewportFrame)
    rowRemovalObserver?.disconnect()
    for (const dispose of rowResources.values()) dispose()
    rowResources.clear()
    rowsById.clear()
    disposePopover?.()
    disposeMenuDropdown?.()
    callBar?.dispose()
    callBar = null
    closeAppearance()
    for (const dispose of overlays) dispose()
    overlays.clear()
    unsubscribe?.()
    unsubscribe = null
    unsubscribeReactions?.()
    unsubscribeReactions = null
    unsubscribeEnded?.()
    unsubscribeEnded = null
    transport?.sendPresence(false)
    transport?.disconnect()
    transport = null
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
    if (searchDebounce) clearTimeout(searchDebounce)
    searchDebounce = null
    unregisterSearchBack?.()
    unregisterSearchBack = null
    if (focusHandler) window.removeEventListener('focus', focusHandler)
    focusHandler = null
    if (viewportResizeHandler) window.visualViewport?.removeEventListener('resize', viewportResizeHandler)
    viewportResizeHandler = null
    alarmController?.dispose()
    alarmController = null
    void setNativeChatActive(false)
  }

  root.innerHTML = loadingScreenHtml()

  ;(async () => {
    const current = await getCurrentConnection()
    if (disposed) return
    if (!current || (current.status !== 'active' && current.status !== 'leave_pending')) {
      go('connection-id')
      return
    }

    const otherName = current.otherNickname ?? 'them'
    const myUserId = current.myUserId
    const connectionId = current.id

    renderChat(root, otherName)
    const log = root.querySelector<HTMLDivElement>('#chat-log')!
    // Relocation removes/reinserts synchronously: only dispose truly removed rows.
    rowRemovalObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.removedNodes) {
        if (!(node instanceof HTMLElement)) continue
        const removed = [node, ...node.querySelectorAll<HTMLElement>('.chat__message, .chat__system-line, .countdown-card, .location-card, .voice-bubble')]
        for (const el of removed) {
          if (log.contains(el)) continue
          const id = el.dataset.id
          if (id && rowsById.get(id) === el) rowsById.delete(id)
          rowResources.get(el)?.()
          rowResources.delete(el)
        }
      }
    })
    rowRemovalObserver.observe(log, { childList: true })

    // Keyboard open/close shrinks/grows #app (main.ts pins its height to
    // visualViewport), which changes log's clientHeight without moving its
    // scrollTop — if the log was scrolled to the bottom, that alone reveals
    // older messages instead of staying on the latest one (the view "jumps
    // up" when the composer is focused). Re-pin to bottom on resize, but only
    // if it was already there — never yank the view while reading history.
    let stickToBottom = true
    log.addEventListener(
      'scroll',
      () => {
        stickToBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80
      },
      { passive: true },
    )
    viewportResizeHandler = (): void => {
      if (viewportFrame) return
      viewportFrame = requestAnimationFrame(() => {
        viewportFrame = 0
        if (!disposed && stickToBottom) log.scrollTop = log.scrollHeight
      })
    }
    window.visualViewport?.addEventListener('resize', viewportResizeHandler)

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
        const ranges = matchRanges(content, q)
        if (!ranges.length) continue
        found = true
        const frag = document.createDocumentFragment()
        let i = 0
        for (const { start: idx, end } of ranges) {
          if (idx > i) frag.appendChild(document.createTextNode(content.slice(i, idx)))
          const mark = document.createElement('mark')
          mark.textContent = content.slice(idx, end)
          frag.appendChild(mark)
          i = end
        }
        frag.appendChild(document.createTextNode(content.slice(i)))
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
      const q = raw.trim()
      if (q) {
        for (const el of log.querySelectorAll<HTMLElement>('.chat__message-text')) {
          if (el.closest<HTMLElement>('.chat__message')?.dataset.deleted || !highlightMatches(el, q)) continue
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
    const closeSearch = (): void => {
      if (searchDebounce) clearTimeout(searchDebounce)
      searchDebounce = null
      searchInput.value = ''
      runSearch('')
      reveal(searchBar, false)
      unregisterSearchBack?.()
      unregisterSearchBack = null
    }
    root.querySelector<HTMLButtonElement>('#search-close')!.addEventListener('click', closeSearch)

    const nav = root.querySelector<HTMLElement>('.chat__nav')!
    const menuBtn = root.querySelector<HTMLButtonElement>('#menu-btn')!
    const chatEl = root.querySelector<HTMLElement>('.chat')!
    const reveal = (element: HTMLElement, visible: boolean): void => {
      element.classList.toggle('chat__strip--visible', visible)
      element.inert = !visible
      element.setAttribute('aria-hidden', String(!visible))
    }

    // --- Alarm: pulsing red glow while an emergency alert is active. The
    // controller owns sound/vibration/the no-ack auto-clear timer; this page
    // owns the glow and when to (not) call it (see onIncoming/sendMessage/
    // history-resume below). Sound + glow both persist until the recipient
    // taps Acknowledge or the 2min auto-clear fires — focus/visibility no
    // longer silences the sound.
    alarmController = createAlarmController()
    const alarmBanner = root.querySelector<HTMLElement>('#alarm-banner')!
    const alarmAcknowledge = root.querySelector<HTMLButtonElement>('#alarm-acknowledge')!
    let incomingAlarmId: string | null = null
    const setAlarmGlow = (active: boolean): void => {
      chatEl.classList.toggle('chat--alarm', active)
      if (!active) incomingAlarmId = null
      reveal(alarmBanner, active && !!incomingAlarmId)
    }
    root.querySelector<HTMLElement>('#alarm-banner-label')!.textContent = `Emergency alarm from ${otherName}`
    alarmAcknowledge.addEventListener('click', () => {
      if (!incomingAlarmId) return
      alarmAcknowledge.disabled = true
      void sendAlarmAck(incomingAlarmId, false).catch((err) => showNotice(err instanceof Error ? err.message : 'Could not acknowledge. Try again.'))
        .finally(() => { alarmAcknowledge.disabled = false })
    })
    alarmController.onAutoClear(() => setAlarmGlow(false))
    // Single place that marks read. The poll below only calls it as a
    // presence heartbeat (see MARK_HEARTBEAT_MS), not on every 4s tick.
    let lastMarkAt = 0
    const markReadNow = (): void => {
      lastMarkAt = Date.now()
      void markRead(connectionId).catch(() => {})
    }
    // Native rings whenever the app is open on any screen EXCEPT this one.
    void setNativeChatActive(true)
    void maybePromptFullScreenIntent()
    // Raise ids that already have an ack/cancel (raise id -> cancelled?), so a
    // raise card renders as answered after a reload and can't be re-tapped.
    const ackedRaises = new Map<string, boolean>()
    const markRaiseAcked = (raiseId: string, cancelled: boolean): void => {
      ackedRaises.set(raiseId, cancelled)
      const card = chatEl.querySelector<HTMLButtonElement>(`.chat__message[data-id="${CSS.escape(raiseId)}"] .alarm-card--raise`)
      if (!card) return
      card.disabled = true
      const hint = card.querySelector('.alarm-card__hint')
      if (hint) hint.textContent = cancelled ? 'cancelled' : 'acknowledged'
    }

    // Wallpaper and message style are both shared per-connection (either
    // member's pick applies to both); theme stays per-device. Synced via the
    // poll below, and immediately on receipt of the other side's 'system'
    // notice (see onMessage).
    let currentWallpaper = current.wallpaper
    let currentStyle = current.messageStyle
    applyAppearance(chatEl, currentWallpaper, currentStyle)

    const onWallpaperChange = (value: string): void => {
      currentWallpaper = value
      applyAppearance(chatEl, currentWallpaper, currentStyle) // optimistic
      void setWallpaper(connectionId, value).catch(() => {
        showNotice('Could not update the wallpaper — try again.')
      })
    }

    // Push notifications: a menu toggle rather than an automatic prompt-on-load
    // (unsolicited permission prompts get auto-denied by browsers/users alike).
    // Feedback is a popup, not the quiet in-chat system line — a subscribe
    // failure is easy to miss otherwise, and the user needs to actually see it.
    // Transient status feedback (no decision required) — a toast, not a
    // modal, so it doesn't block the chat or need a body-level overlay
    // tracked for navigation cleanup.
    const showNotice = (message: string): void => {
      showToast(message)
    }
    let peerPhoto: string | null = null, privateUrl: string | null = null
    let avatarIds = `${current.myAvatarId}:${current.otherAvatarId}`, avatarsLoadedAt = 0, avatarSequence = 0
    const loadPhotos = async (): Promise<void> => {
      const sequence = ++avatarSequence
      const [avatars, photo] = await Promise.all([getAvatars().catch(() => ({ mine: null, other: null })), privatePhoto(myUserId, connectionId)])
      if (disposed || sequence !== avatarSequence) return
      if (privateUrl) URL.revokeObjectURL(privateUrl)
      privateUrl = photo ? URL.createObjectURL(photo) : null
      peerPhoto = privateUrl ?? avatars.other
      renderAvatar(root.querySelector('#nav-avatar')!, peerPhoto, otherName)
      callBar?.setPhoto(peerPhoto)
      avatarsLoadedAt = Date.now()
    }
    void loadPhotos().catch(() => {})
    overlays.add(() => { if (privateUrl) URL.revokeObjectURL(privateUrl) })

    const toggleNotifications = async (): Promise<void> => {
      try {
        if (await isPushSubscribed()) {
          await unsubscribeFromPush()
          showNotice('Notifications turned off.')
          return
        }
        if (!(await ensurePermissionRationale('notifications'))) return
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
        reveal(searchBar, true)
        searchInput.focus()
        unregisterSearchBack?.()
        unregisterSearchBack = pushBackHandler(() => {
          closeSearch()
          return true
        })
      },
      () => openAppearance(nav, menuBtn, chatEl, currentWallpaper, currentStyle, onWallpaperChange),
      isPushSupported() ? () => void toggleNotifications() : undefined,
      () =>
        openBlockConfirm({
          connectionId,
          peerName: otherName.toLowerCase(),
          onBlocked: () => go('connection-id'),
        }),
      () => openDeleteAccountDialog(),
      getNotificationsLabel,
      () => openReportModal({ person: true }),
      () => {
        const dispose = openProfileSettings(myUserId, connectionId, () => void loadPhotos().catch(() => {}))
        overlays.add(dispose)
      },
    )

    // Live presence wins; read receipts remain the fallback on older servers.
    const navStatus = root.querySelector<HTMLDivElement>('#nav-status')!
    const PRESENCE_WINDOW_MS = 15000
    // The one header status element shows connection trouble ("connecting…" /
    // "waiting for network") while the socket is down, else the other side's presence.
    let presenceActive = false
    let livePresence: PresenceUpdate | null = null
    let otherTyping = false
    let connLabel: string | null = null
    const renderStatus = (): void => {
      for (const button of nav.querySelectorAll<HTMLButtonElement>('.chat__call-btn')) button.disabled = !transport || connLabel !== null
      if (connLabel) {
        navStatus.textContent = connLabel
        navStatus.classList.add('chat__nav-status--connecting')
        navStatus.classList.remove('chat__nav-status--away')
        return
      }
      const lastSeen = livePresence?.lastSeenAt ?? otherLastRead
      navStatus.textContent = otherTyping ? 'typing…' : presenceActive ? 'in chat' : lastSeen ? `Last seen ${formatMessageTime(new Date(lastSeen))}` : 'away'
      navStatus.classList.remove('chat__nav-status--connecting')
      navStatus.classList.toggle('chat__nav-status--away', !presenceActive && !otherTyping)
    }
    const updatePresence = (otherLastReadAt: string | null): void => {
      presenceActive = livePresence?.online ?? (!!otherLastReadAt && Date.now() - new Date(otherLastReadAt).getTime() < PRESENCE_WINDOW_MS)
      renderStatus()
    }
    const setConnState = (state: TransportState): void => {
      connLabel = state === 'connected' ? null : state === 'offline' ? 'waiting for network' : 'connecting…'
      renderStatus()
    }

    // --- Message rendering -------------------------------------------------
    let lastDate: Date | null = null
    // Newest server createdAt we hold — the cursor for the reconnect resync.
    let newestServerAt: string | null = null
    const noteServerTime = (iso: string): void => {
      if (!newestServerAt || Date.parse(iso) > Date.parse(newestServerAt)) newestServerAt = iso
    }
    const resolvedTempIds = new Set<string>() // sends already reconciled — a late/duplicate echo is dropped
    const messagesById = new Map<string, QuotableMessage>()
    const selectedIds = new Set<string>()
    let pinState: PinState = { messageId: current.pinnedMessageId ?? null, pinnedBy: current.pinnedBy ?? null, pinnedAt: current.pinnedAt ?? null }
    let lastPinEvent = 0
    const pinBanner = root.querySelector<HTMLElement>('#pin-banner')!
    const snippetOf = (message: ChatMessage): string => message.deletedAt ? DELETED_MESSAGE : mediaLabel(message.type) ?? message.content
    const renderPin = (): void => {
      const message = pinState.messageId ? messagesById.get(pinState.messageId) : undefined
      root.querySelector<HTMLElement>('#pin-author')!.textContent = `Pinned by ${pinState.pinnedBy === myUserId ? 'you' : otherName}`
      root.querySelector<HTMLElement>('#pin-snippet')!.textContent = message ? snippetOf(message) : 'Pinned message'
      reveal(pinBanner, !!pinState.messageId)
    }
    const applyPin = (pin: PinState): void => { pinState = pin; lastPinEvent = Date.now(); renderPin() }
    const pinMessage = async (messageId: string | null): Promise<void> => {
      try {
        if (!transport) throw new Error('Connect to the internet to pin a message.')
        applyPin(await transport.pinMessage(messageId))
      } catch (err) { showNotice(err instanceof Error ? err.message : 'Could not update the pin.') }
    }
    root.querySelector<HTMLButtonElement>('#pin-unpin')!.addEventListener('click', () => void pinMessage(null))
    root.querySelector<HTMLButtonElement>('#pin-open')!.addEventListener('click', () => { if (pinState.messageId) void jumpToMessage(pinState.messageId) })
    renderPin()

    let typingExpiry: ReturnType<typeof setTimeout> | null = null
    let typingBubble: HTMLElement | null = null
    const setOtherTyping = (active: boolean): void => {
      if (typingExpiry) clearTimeout(typingExpiry)
      typingExpiry = null
      otherTyping = active
      renderStatus()
      if (active) {
        if (!typingBubble) {
          typingBubble = document.createElement('div')
          typingBubble.className = 'chat__typing chat__strip chat__strip--visible'
          typingBubble.setAttribute('role', 'status')
          typingBubble.setAttribute('aria-label', `${otherName} is typing`)
          typingBubble.innerHTML = '<div class="chat__strip-inner"><div class="chat__typing-body"><span></span><span></span><span></span></div></div>'
        }
        log.append(typingBubble)
        if (stickToBottom) log.scrollTop = log.scrollHeight
        typingExpiry = setTimeout(() => setOtherTyping(false), 6000)
      } else if (typingBubble) {
        animateOutAndRemove(typingBubble, 'chat__typing--closing')
        typingBubble = null
      }
    }
    overlays.add(() => { if (typingExpiry) clearTimeout(typingExpiry); typingBubble?.remove() })

    // --- Reactions: rendered as chips under the message body, updated live
    // via reaction:update from the transport. sendReaction() below is defined
    // after `transport` is populated by connectMessaging().
    const reactionsByMessage = new Map<string, ReactionSummary[]>()

    // Plain emoji, no badge box — sits below the bubble as its own line in
    // the message row (a child of `row`, NOT `.chat__message-body`, so it's
    // never drawn over the bubble's own background). One reaction per user
    // per message, so a 1:1 chat needs at most two emoji here (me + other).
    const renderReactionChips = (messageId: string): void => {
      const row = rowsById.get(messageId)
      if (!row) return
      const list = reactionsByMessage.get(messageId) ?? []
      let badge = row.querySelector<HTMLElement>('.chat__reaction-badge')
      if (!list.length && !badge) return
      if (!badge) {
        badge = document.createElement('div')
        badge.className = 'chat__reaction-badge'
        row.append(badge)
      }
      for (const chip of badge.querySelectorAll<HTMLElement>('.chat__reaction-chip')) {
        if (!list.some((r) => r.emoji === chip.dataset.emoji)) animateOutAndRemove(chip, 'chat__reaction-chip--closing')
      }
      for (const r of list) {
        let chip = [...badge.querySelectorAll<HTMLButtonElement>('.chat__reaction-chip:not(.chat__reaction-chip--closing)')].find((c) => c.dataset.emoji === r.emoji)
        const previousCount = chip?.dataset.count
        if (!chip) {
          chip = document.createElement('button')
          chip.dataset.emoji = r.emoji
          chip.innerHTML = '<span class="chat__reaction-emoji"></span><span class="chat__reaction-count"></span>'
          chip.querySelector('.chat__reaction-emoji')!.textContent = r.emoji
          chip.addEventListener('pointerdown', (e) => e.preventDefault())
          chip.addEventListener('click', (e) => { e.stopPropagation(); toggleReaction(messageId, r.emoji) })
          badge.append(chip)
        }
        chip.type = 'button'
        chip.className = 'chat__reaction-chip'
        chip.dataset.count = String(r.userIds.length)
        chip.setAttribute('aria-label', `${r.emoji}, ${r.userIds.length} reaction${r.userIds.length === 1 ? '' : 's'}`)
        chip.setAttribute('aria-pressed', String(r.userIds.includes(myUserId)))
        const count = chip.querySelector<HTMLElement>('.chat__reaction-count')!
        count.textContent = String(r.userIds.length)
        if (previousCount && previousCount !== chip.dataset.count && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) count.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 200 })
      }
    }

    // One reaction per user per message: adding an emoji replaces whatever
    // this user had on the message before (across all emoji), locally and
    // for every client — the server enforces the same via a unique
    // (message_id, user_id) upsert, so a single 'add' broadcast is enough.
    const applyReactionUpdate = (update: ReactionUpdate): void => {
      if (messagesById.get(update.messageId)?.deletedAt) return
      const list = reactionsByMessage.get(update.messageId) ?? []
      if (update.op === 'add') {
        for (const r of list) r.userIds = r.userIds.filter((id) => id !== update.userId)
        let entry = list.find((r) => r.emoji === update.emoji)
        if (!entry) {
          entry = { emoji: update.emoji, userIds: [] }
          list.push(entry)
        }
        entry.userIds.push(update.userId)
      } else {
        const entry = list.find((r) => r.emoji === update.emoji)
        if (entry) entry.userIds = entry.userIds.filter((id) => id !== update.userId)
      }
      reactionsByMessage.set(
        update.messageId,
        list.filter((r) => r.userIds.length > 0),
      )
      renderReactionChips(update.messageId)
    }

    const toggleReaction = (messageId: string, emoji: string): void => {
      if (messagesById.get(messageId)?.deletedAt) return
      if (!transport || transport.getState() !== 'connected') { showNotice('Connect to the internet to react.'); return }
      const list = reactionsByMessage.get(messageId) ?? []
      const mine = list.find((r) => r.userIds.includes(myUserId))
      const prevEmoji = mine?.emoji ?? null // one-per-user: at most one entry can include me
      const alreadyReacted = prevEmoji === emoji
      const op = alreadyReacted ? 'remove' : 'add'
      applyReactionUpdate({ messageId, emoji, userId: myUserId, op }) // optimistic; server echo reconciles
      transport.sendReaction(messageId, emoji, op).catch((err) => {
        // Revert to exactly what I had before — a plain inverse toggle isn't
        // enough for 'add', since applying it may have replaced a *different*
        // prior emoji of mine (one-per-user), not just added a fresh one.
        applyReactionUpdate({ messageId, emoji, userId: myUserId, op: 'remove' })
        if (prevEmoji) applyReactionUpdate({ messageId, emoji: prevEmoji, userId: myUserId, op: 'add' })
        showNotice(err instanceof Error ? err.message : 'Could not react. Try again.')
      })
    }

    // A reply renders as a small quoted block above the message text; tapping
    // it scrolls to (and briefly flashes) the original.
    const quoteBlock = (replyTo: string): HTMLElement => {
      const original = messagesById.get(replyTo)
      const q = document.createElement('button')
      q.type = 'button'
      q.className = 'chat__quote'
      q.dataset.replyTo = replyTo
      q.setAttribute('aria-label', 'Go to original message')
      const name = document.createElement('div')
      name.className = 'chat__quote-name'
      name.textContent = original ? (original.senderId === myUserId ? 'You' : otherName) : otherName
      const snippet = document.createElement('div')
      snippet.className = 'chat__quote-snippet'
      snippet.textContent = original ? snippetOf(original) : 'Original message'
      q.append(name, snippet)
      q.addEventListener('click', (e) => {
        e.stopPropagation()
        void jumpToMessage(replyTo)
      })
      return q
    }

    const linkPreviewCard = (url: string): HTMLElement => {
      const slot = document.createElement('div')
      slot.className = 'chat__preview-slot'
      void getLinkPreview(url).then((preview) => {
        if (disposed || !slot.isConnected || !preview) return
        const atBottom = stickToBottom
        const card = document.createElement('a')
        card.className = 'chat__link-preview'
        card.href = safeWebUrl(preview.url) ?? url
        card.target = '_blank'
        card.rel = 'noopener noreferrer'
        card.dataset.messageLink = '1'
        const info = document.createElement('div')
        info.className = 'chat__link-preview-info'
        for (const [className, value] of [['site', preview.siteName], ['title', preview.title], ['description', preview.description]]) {
          if (!value) continue
          const text = document.createElement('div')
          text.className = `chat__link-preview-${className}`
          text.textContent = value
          info.append(text)
        }
        const imageUrl = previewImageUrl(preview.image, preview.imageMime)
        if (imageUrl) {
          const image = document.createElement('img')
          image.alt = ''
          image.addEventListener('load', () => {
            card.classList.toggle('chat__link-preview--wide', preview.imageKind === 'cover' && image.naturalWidth >= image.naturalHeight * 1.4)
            if (atBottom && stickToBottom) log.scrollTop = log.scrollHeight
          }, { once: true })
          image.addEventListener('error', () => image.remove(), { once: true })
          image.src = imageUrl
          card.append(image)
        }
        card.append(info)
        slot.append(card)
        if (atBottom && stickToBottom) log.scrollTop = log.scrollHeight
      })
      return slot
    }

    // A letter renders as a folded card in the chat; tapping opens the full letter.
    const letterCard = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as Partial<LetterPayload>
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'letter-card'
      const icon = document.createElement('span')
      icon.className = 'letter-card__icon'
      icon.innerHTML = LETTER_ICON
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

    // A countdown renders as a live-ticking card; no separate viewer to open —
    // the card itself is always live, ticking down for as long as it's on
    // screen. Row removal and page cleanup clear its interval immediately.
    const countdownCard = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as Partial<CountdownPayload>
      const card = document.createElement('div')
      card.className = 'countdown-card'
      const icon = document.createElement('span')
      icon.className = 'countdown-card__icon'
      icon.innerHTML = COUNTDOWN_ICON
      const info = document.createElement('span')
      info.className = 'countdown-card__info'
      const label = document.createElement('span')
      label.className = 'countdown-card__label'
      label.textContent = p.label ?? message.content
      const ticker = document.createElement('span')
      ticker.className = 'countdown-card__ticker'
      const target = document.createElement('span')
      target.className = 'countdown-card__target'
      if (p.targetIso) target.textContent = formatFullTimestamp(new Date(p.targetIso)).replace('\n', ' · ')
      info.append(label, target, ticker)
      card.append(icon, info)

      const targetIso = p.targetIso
      if (targetIso) {
        ticker.textContent = formatCountdown(targetIso)
        const timer = setInterval(() => {
          ticker.textContent = formatCountdown(targetIso)
        }, 1000)
        rowResources.set(card, () => clearInterval(timer))
      }
      return card
    }

    // A check-in renders as a mood + note card — a structured, distinct look
    // that signals "this one's an honest check-in", not just another message.
    const checkinCard = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as Partial<CheckinPayload>
      const card = document.createElement('div')
      card.className = 'checkin-card'
      const icon = document.createElement('span')
      icon.className = 'checkin-card__icon'
      icon.textContent = moodEmoji(p.mood ?? 'okay')
      const note = document.createElement('span')
      note.className = 'checkin-card__note'
      linkifyInto(note, p.note ?? message.content)
      card.append(icon, note)
      return card
    }

    // A location snapshot — same keepsake-card family as check-in. The tile
    // request reveals the coordinates (and both users' IPs) to
    // tile.openstreetmap.org, so it's held behind an IntersectionObserver and
    // only fetched once the card is actually scrolled into view, rather than
    // for every location ever sent in the conversation history (see
    // docs/DECISIONS-encryption-at-rest.md for the fuller privacy note — this
    // is a third-party network leak independent of at-rest encryption).
    const locationCard = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as Partial<LocationPayload>
      const lat = p.lat ?? 0
      const lng = p.lng ?? 0

      const card = document.createElement('div')
      card.className = 'location-card'

      const top = document.createElement('div')
      top.className = 'location-card__top'

      const mapWrap = document.createElement('div')
      mapWrap.className = 'location-card__map'
      const pin = document.createElement('span')
      pin.className = 'location-card__pin'
      pin.innerHTML = LOCATION_ICON
      mapWrap.append(pin)

      // zoom 15, single 256px OSM tile centred on the point — good enough to
      // orient by, not a full slippy map (no library, no pan/zoom).
      const zoom = 15
      const n = 2 ** zoom
      const x = Math.floor(((lng + 180) / 360) * n)
      const latRad = (lat * Math.PI) / 180
      const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
      const tileUrl = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`

      const img = document.createElement('img')
      img.className = 'location-card__tile'
      img.alt = 'Map preview'
      img.addEventListener('error', () => mapWrap.classList.add('location-card__map--failed'), { once: true })
      mapWrap.prepend(img)

      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          img.src = tileUrl
          observer.disconnect()
          rowResources.delete(card)
        }
      })
      observer.observe(card)
      rowResources.set(card, () => observer.disconnect())

      const info = document.createElement('div')
      info.className = 'location-card__info'
      const title = document.createElement('span')
      title.className = 'location-card__title'
      title.textContent = 'Location'
      const coords = document.createElement('span')
      coords.className = 'location-card__coords'
      coords.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
      info.append(title, coords)

      const actions = document.createElement('div')
      actions.className = 'location-card__actions'
      const directions = document.createElement('a')
      directions.className = 'location-card__action'
      directions.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
      directions.target = '_blank'
      directions.rel = 'noopener noreferrer'
      directions.textContent = 'Get Directions'
      directions.addEventListener('click', (e) => e.stopPropagation())
      const view = document.createElement('a')
      view.className = 'location-card__action'
      view.href = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
      view.target = '_blank'
      view.rel = 'noopener noreferrer'
      view.textContent = 'View'
      view.addEventListener('click', (e) => e.stopPropagation())
      actions.append(directions, view)

      top.append(mapWrap, info)
      card.append(top, actions)
      return card
    }

    // An ask has two card states, both built from ordinary messages — no
    // separate live-update path. The sealed original (no answerB in payload)
    // renders locked; tapping it (as the recipient) opens the answer modal,
    // which sends a SECOND ask message reply-linked to the original with
    // answerB filled in. That second message is what renders revealed —
    // reusing the existing generic reply/quote system (buildMessageRow
    // already appends a quoteBlock for any message with a replyTo) rather
    // than mutating the original message or its already-rendered row.
    const askCard = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as Partial<AskPayload>
      const question = p.question ?? message.content
      const isMine = message.senderId === myUserId

      if (p.answerB) {
        const original = message.replyTo ? messagesById.get(message.replyTo) : undefined
        const aName = original ? (original.senderId === myUserId ? 'You' : otherName) : otherName
        const bName = isMine ? 'You' : otherName

        const card = document.createElement('div')
        card.className = 'ask-card ask-card--revealed'
        const icon = document.createElement('span')
        icon.className = 'ask-card__icon'
        icon.innerHTML = LETTER_ICON
        const body = document.createElement('div')
        body.className = 'ask-card__body'
        const q = document.createElement('div')
        q.className = 'ask-card__question'
        q.textContent = question
        const rowA = document.createElement('div')
        rowA.className = 'ask-card__answer'
        const nameA = document.createElement('span')
        nameA.className = 'ask-card__answer-name'
        nameA.textContent = `${aName}: `
        rowA.append(nameA, document.createTextNode(p.answerA ?? ''))
        const rowB = document.createElement('div')
        rowB.className = 'ask-card__answer'
        const nameB = document.createElement('span')
        nameB.className = 'ask-card__answer-name'
        nameB.textContent = `${bName}: `
        rowB.append(nameB, document.createTextNode(p.answerB))
        body.append(q, rowA, rowB)
        card.append(icon, body)
        return card
      }

      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'ask-card'
      const icon = document.createElement('span')
      icon.className = 'ask-card__icon'
      icon.innerHTML = LOCK_ICON
      const body = document.createElement('span')
      body.className = 'ask-card__body'
      const q = document.createElement('span')
      q.className = 'ask-card__question'
      q.textContent = question
      const hint = document.createElement('span')
      hint.className = 'ask-card__hint'
      hint.textContent = isMine ? `sealed — waiting for ${otherName.toLowerCase()} to answer` : 'sealed — tap to answer'
      body.append(q, document.createElement('br'), hint)
      card.append(icon, body)
      card.addEventListener('click', (e) => {
        e.stopPropagation() // don't also toggle the row's timestamp
        if (isMine) {
          showNotice(`Waiting for ${otherName.toLowerCase()} to answer.`)
          return
        }
        openAskAnswerModal({
          question,
          onAnswer: (answerB) => {
            sendMessage(question, 'ask', { question, answerA: p.answerA ?? '', answerB }, message.id ?? null)
          },
        })
      })
      return card
    }

    // Same sealed/revealed shape as askCard above, but the payload holds two
    // options + a pick from each side instead of a question + two answers.
    const thisorthatCard = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as Partial<ThisOrThatPayload>
      const optionA = p.optionA ?? ''
      const optionB = p.optionB ?? ''
      const isMine = message.senderId === myUserId

      if (p.pickRecipient) {
        // The revealed card is the recipient's reply message, so its senderId
        // is pickRecipient's, not pickSender's — resolve the poll author from
        // the original message it replies to (same as askCard above).
        const original = message.replyTo ? messagesById.get(message.replyTo) : undefined
        const senderName = original ? (original.senderId === myUserId ? 'You' : otherName) : otherName
        const recipientName = isMine ? 'You' : otherName
        const picksFor = (opt: 'a' | 'b'): string => {
          const names: string[] = []
          if (p.pickSender === opt) names.push(senderName)
          if (p.pickRecipient === opt) names.push(recipientName)
          return names.join(' & ')
        }

        const card = document.createElement('div')
        card.className = 'thisorthat-card thisorthat-card--revealed'
        const icon = document.createElement('span')
        icon.className = 'thisorthat-card__icon'
        icon.innerHTML = CHOICE_ICON
        const body = document.createElement('div')
        body.className = 'thisorthat-card__body'
        const options = document.createElement('div')
        options.className = 'thisorthat-card__options'

        const buildOption = (opt: 'a' | 'b', label: string): HTMLElement => {
          const cell = document.createElement('div')
          cell.className = 'thisorthat-card__option'
          const text = document.createElement('div')
          text.className = 'thisorthat-card__option-text'
          text.textContent = label
          const picks = document.createElement('div')
          picks.className = 'thisorthat-card__picks'
          picks.textContent = picksFor(opt)
          cell.append(text, picks)
          return cell
        }

        const vs = document.createElement('span')
        vs.className = 'thisorthat-card__vs'
        vs.textContent = 'vs'
        options.append(buildOption('a', optionA), vs, buildOption('b', optionB))
        body.append(options)
        card.append(icon, body)
        return card
      }

      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'thisorthat-card'
      const icon = document.createElement('span')
      icon.className = 'thisorthat-card__icon'
      icon.innerHTML = CHOICE_ICON
      const body = document.createElement('span')
      body.className = 'thisorthat-card__body'
      const prompt = document.createElement('div')
      prompt.className = 'thisorthat-card__prompt'
      prompt.textContent = `${optionA} vs ${optionB}`
      const hint = document.createElement('div')
      hint.className = 'thisorthat-card__hint'
      hint.textContent = isMine ? `sealed — waiting for ${otherName.toLowerCase()} to pick` : 'sealed — tap to pick'
      body.append(prompt, hint)
      card.append(icon, body)
      card.addEventListener('click', (e) => {
        e.stopPropagation() // don't also toggle the row's timestamp
        if (isMine) {
          showNotice(`Waiting for ${otherName.toLowerCase()} to pick.`)
          return
        }
        openThisOrThatAnswerModal({
          optionA,
          optionB,
          onPick: (pickRecipient) => {
            sendMessage(
              `${optionA} vs ${optionB}`,
              'thisorthat',
              { optionA, optionB, pickSender: p.pickSender ?? 'a', pickRecipient },
              message.id ?? null,
            )
          },
        })
      })
      return card
    }

    // Same raise/reply shape as ask/thisorthat above: the raise renders as
    // its own permanent card (a sender never gets to see it as anything but
    // "sent"), and an acknowledgement is a SEPARATE alarm message reply-linked
    // to the raise, rendered as its own small confirmation card underneath —
    // no message-mutation path exists or is needed. The live sound/vibration/
    // glow are triggered separately in sendMessage/onIncoming below; this
    // only builds the static card.
    const alarmCard = (message: ChatMessage): HTMLElement => {
      const payload = message.payload as { ack?: string; cancelled?: boolean } | null
      const ack = payload?.ack
      const isMine = message.senderId === myUserId

      if (ack) {
        const cancelled = payload?.cancelled === true
        const card = document.createElement('div')
        card.className = 'alarm-card alarm-card--ack'
        const icon = document.createElement('span')
        icon.className = 'alarm-card__icon'
        icon.innerHTML = cancelled ? CLOSE_ICON : CHECK_ICON
        const label = document.createElement('span')
        const who = isMine ? 'You' : otherName
        label.textContent = cancelled ? `${who} cancelled the alarm` : `${who} acknowledged the alarm`
        card.append(icon, label)
        return card
      }

      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'alarm-card alarm-card--raise'
      const icon = document.createElement('span')
      icon.className = 'alarm-card__icon'
      icon.innerHTML = ALARM_ICON
      const body = document.createElement('span')
      body.className = 'alarm-card__body'
      const title = document.createElement('div')
      title.className = 'alarm-card__title'
      title.textContent = 'Emergency alarm'
      const hint = document.createElement('div')
      hint.className = 'alarm-card__hint'
      hint.textContent = isMine ? 'tap to cancel' : 'tap to acknowledge'
      body.append(title, hint)
      card.append(icon, body)
      if (message.id && ackedRaises.has(message.id)) {
        card.disabled = true
        hint.textContent = ackedRaises.get(message.id) ? 'cancelled' : 'acknowledged'
      }

      // Both branches send the same reply-linked {ack} shape (see
      // validateAlarmPayload) — a raiser's cancel just adds cancelled:true so
      // it renders and pushes differently, but clears the live alert on the
      // exact same payload.ack check every consumer already runs.
      // The raise id is resolved from the row at click time: an own raise has
      // no id until the server echo reconciles the optimistic row (see
      // onIncoming), and until then the card is disabled as "sending…".
      const idleHint = hint.textContent
      if (!message.id) {
        card.disabled = true
        hint.textContent = 'sending…'
      }
      card.addEventListener('click', (e) => {
        e.stopPropagation() // don't also toggle the row's timestamp
        if (card.disabled) return
        const raiseId = card.closest<HTMLElement>('.chat__message')?.dataset.id ?? message.id
        if (!raiseId || !ALARM_ID_RE.test(raiseId)) return
        card.disabled = true
        hint.textContent = 'sending…'
        sendAlarmAck(raiseId, isMine).then(
          () => {
            hint.textContent = isMine ? 'cancelled' : 'acknowledged'
          },
          (err) => {
            // Not recorded server-side: put the card back so it can be retried.
            // The alert/ring was never stopped locally, so nothing else to undo.
            card.disabled = false
            hint.textContent = idleHint
            showNotice(
              `Couldn't ${isMine ? 'cancel' : 'acknowledge'} the alarm${err instanceof Error && err.message ? ` (${err.message})` : ''}. Try again.`,
            )
          },
        )
      })
      return card
    }

    // Attachments sit behind short-lived signed URLs (private bucket — see
    // attachmentService.signAttachments), so a bubble renders a placeholder
    // first and swaps in the real src/href once resolved. getSignedUrls
    // caches per path, so the bulk pre-fetch on history load (below) makes
    // each row's own call here an instant cache hit instead of a new request.
    const hydrateMedia = (path: string, onUrl: (url: string) => void, onError?: () => void): void => {
      getSignedUrls(connectionId, [path])
        .then((urls) => {
          if (disposed) return
          const url = urls[path]
          if (url) onUrl(url)
          else onError?.()
        })
        .catch(() => {
          if (!disposed) onError?.()
        })
    }

    const openImageViewer = (url: string, filename: string): void => {
      const wrap = document.createElement('div')
      wrap.className = 'image-viewer'
      const img = document.createElement('img')
      img.className = 'image-viewer__img'
      img.src = url
      img.alt = 'Photo'
      const actions = document.createElement('div')
      actions.className = 'image-viewer__actions'
      const dl = document.createElement('button')
      dl.type = 'button'
      dl.className = 'primary'
      dl.textContent = 'Download'
      dl.addEventListener('click', () => {
        void downloadFromUrl(url, filename).catch(() => showNotice('Could not download this photo.'))
      })
      actions.append(dl)
      wrap.append(img, actions)
      openModal(wrap)
    }

    // An image renders as a thumbnail + optional caption; tap opens a full
    // view with a download action.
    const imageBubble = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as Partial<ImagePayload>
      const wrap = document.createElement('div')
      wrap.className = 'image-bubble'

      // The <img> and its loading spinner share one relatively-positioned
      // wrapper so the spinner overlays the reserved box instead of the
      // caption below it.
      const media = document.createElement('div')
      media.className = 'image-bubble__media'

      const img = document.createElement('img')
      img.className = 'image-bubble__img'
      img.alt = isSticker(message) ? 'Sticker' : 'Photo'
      img.loading = 'lazy'
      if (p.width && p.height) {
        // Reserve the real final size up front — no layout jump, no blank box.
        img.style.aspectRatio = `${p.width} / ${p.height}`
      } else {
        // Legacy message from before dimensions were captured: nothing to
        // reserve exactly, so fall back to a sane minimum instead of
        // collapsing to 0 height until the raster decodes.
        media.classList.add('image-bubble__media--no-dims')
      }

      const spinner = document.createElement('div')
      spinner.className = 'image-bubble__spinner'
      spinner.innerHTML =
        '<svg class="chat__icon-spinner" width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="40 56.5"/></svg>'
      const stopSpinner = (): void => spinner.remove()
      img.addEventListener('load', () => {
        img.classList.add('image-bubble__img--loaded') // fade in, no pop
        stopSpinner()
      })
      img.addEventListener('error', stopSpinner)

      media.append(img, spinner)
      wrap.append(media)

      if (message.content) {
        const caption = document.createElement('div')
        caption.className = 'image-bubble__caption'
        linkifyInto(caption, message.content)
        wrap.append(caption)
      }

      const path = p.path
      const ext = path?.split('.').pop() ?? 'jpg'
      let resolvedUrl = ''
      if (p.localUrl) {
        // Your own just-sent photo: render straight from the local file —
        // no upload or signed-URL round-trip to wait on.
        resolvedUrl = p.localUrl
        img.src = p.localUrl
      } else if (p.url) {
        // Signed at broadcast time — already viewable, no follow-up request.
        resolvedUrl = p.url
        img.src = p.url
      } else if (path) {
        hydrateMedia(path, (url) => {
          resolvedUrl = url
          img.src = url
        })
      }

      img.addEventListener('click', (e) => {
        if (isSticker(message)) return
        e.stopPropagation()
        if (resolvedUrl) openImageViewer(resolvedUrl, `photo.${ext}`)
      })
      return wrap
    }

    // A voice note renders as a play button + a simple progress bar (no
    // waveform — a deliberate V1 simplification) over a hidden <audio>.
    const voiceBubble = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as Partial<VoicePayload>
      const duration = typeof p.duration === 'number' ? p.duration : 0

      const wrap = document.createElement('div')
      wrap.className = 'voice-bubble'

      const playIcon =
        '<svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><path d="M0 0L12 7L0 14V0Z"/></svg>'
      const pauseIcon =
        '<svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><rect x="0" width="4" height="14"/><rect x="8" width="4" height="14"/></svg>'

      const playBtn = document.createElement('button')
      playBtn.type = 'button'
      playBtn.className = 'voice-bubble__play'
      playBtn.setAttribute('aria-label', 'Play or pause voice message')
      playBtn.innerHTML = playIcon
      playBtn.disabled = true

      const track = document.createElement('div')
      track.className = 'voice-bubble__track'
      const progress = document.createElement('div')
      progress.className = 'voice-bubble__progress'
      track.append(progress)

      const time = document.createElement('span')
      time.className = 'voice-bubble__time'
      time.textContent = formatDuration(duration)

      wrap.append(playBtn, track, time)

      const audio = new Audio()
      audio.preload = 'none'
      rowResources.set(wrap, () => { audio.pause(); audio.removeAttribute('src'); audio.load() })
      let ready = false

      if (p.path) {
        hydrateMedia(p.path, (url) => {
          audio.src = url
          ready = true
          playBtn.disabled = false
        })
      }

      audio.addEventListener('timeupdate', () => {
        if (audio.duration) progress.style.width = `${(audio.currentTime / audio.duration) * 100}%`
        time.textContent = formatDuration(Math.max(0, (audio.duration || duration) - audio.currentTime))
      })
      audio.addEventListener('ended', () => {
        playBtn.innerHTML = playIcon
        progress.style.width = '0%'
        time.textContent = formatDuration(duration)
      })
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (!ready) return
        if (audio.paused) {
          void audio.play()
          playBtn.innerHTML = pauseIcon
        } else {
          audio.pause()
          playBtn.innerHTML = playIcon
        }
      })
      track.addEventListener('click', (e) => {
        e.stopPropagation()
        if (!ready || !audio.duration) return
        const rect = track.getBoundingClientRect()
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
        audio.currentTime = ratio * audio.duration
      })
      return wrap
    }

    // A file renders as a card (icon + name + size); tap downloads it.
    const fileCard = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as Partial<FilePayload>
      const name = p.name ?? 'File'

      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'file-card'

      const icon = document.createElement('span')
      icon.className = 'file-card__icon'
      icon.innerHTML = FILE_ICON

      const info = document.createElement('span')
      info.className = 'file-card__info'
      const nameEl = document.createElement('span')
      nameEl.className = 'file-card__name'
      nameEl.textContent = name
      const meta = document.createElement('span')
      meta.className = 'file-card__meta'
      meta.textContent = formatFileSize(p.size ?? 0)
      info.append(nameEl, meta)
      card.append(icon, info)

      const path = p.path
      card.addEventListener('click', (e) => {
        e.stopPropagation()
        if (!path || card.disabled) return
        card.disabled = true
        hydrateMedia(
          path,
          (url) => {
            card.disabled = false
            void downloadFromUrl(url, name).catch(() => showNotice('Could not download this file.'))
          },
          () => {
            card.disabled = false
            showNotice('Could not open this file — try again.')
          },
        )
      })
      return card
    }

    const dateSeparator = (at: Date): HTMLElement => {
      const sep = document.createElement('div')
      sep.className = 'chat__date-separator'
      sep.textContent = formatDateSeparator(at)
      return sep
    }

    // Call-log card — server-authored. Rides the normal message pipeline
    // (buildMessageRow wraps it in .chat__message), so it gets the same bubble
    // surface, left/right alignment and per-wallpaper palette as every other
    // message. senderId is always the caller, so "mine" = I placed the call.
    // No receipt, reaction or reply — those are gated out in buildMessageRow /
    // registerMessageRow by data-type='call'.
    const callLogCard = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as { kind?: string; outcome?: string; durationSec?: number }
      const iMadeTheCall = message.senderId === myUserId
      const video = p.kind === 'video'
      const noun = video ? 'Video call' : 'Voice call'
      const lower = video ? 'video call' : 'voice call'
      // An unanswered call: "missed" framing (red glyph + tap-to-call-back)
      // only ever shows on the callee's side; the caller's own side reads a
      // plain status ("No answer" / "Not answered").
      const unanswered = p.outcome === 'missed' || p.outcome === 'cancelled' || p.outcome === 'unreachable'
      const missed = unanswered && !iMadeTheCall

      let title = noun
      let sub: string
      if (p.outcome === 'completed') {
        sub = formatCallDuration(p.durationSec ?? 0)
      } else if (missed) {
        title = `Missed ${lower}`
        sub = 'Tap to call back'
      } else if (unanswered) {
        sub = p.outcome === 'unreachable' ? 'Not answered' : p.outcome === 'cancelled' ? 'Cancelled' : 'No answer'
      } else if (p.outcome === 'declined') {
        sub = iMadeTheCall ? 'Declined' : 'You declined'
      } else {
        sub = 'Failed'
      }

      const card = document.createElement('div')
      card.className = 'call-log' + (missed ? ' call-log--missed' : '')

      const disc = document.createElement('span')
      disc.className = 'call-log__disc'
      disc.innerHTML = video
        ? iMadeTheCall
          ? CALL_LOG_VIDEO_OUT_ICON
          : CALL_LOG_VIDEO_IN_ICON
        : iMadeTheCall
          ? CALL_LOG_OUT_ICON
          : CALL_LOG_IN_ICON

      const info = document.createElement('span')
      info.className = 'call-log__info'
      const titleEl = document.createElement('span')
      titleEl.className = 'call-log__title'
      titleEl.textContent = title
      const subEl = document.createElement('span')
      subEl.className = 'call-log__sub'
      subEl.textContent = sub
      info.append(titleEl, subEl)

      card.append(disc, info)

      if (missed) {
        card.classList.add('call-log--action')
        card.setAttribute('role', 'button')
        card.tabIndex = 0
        const redial = (e: Event): void => {
          e.stopImmediatePropagation() // don't also toggle the row's expand-timestamp
          if (video) callBar?.startVideoCall()
          else callBar?.startAudioCall()
        }
        card.addEventListener('click', redial)
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            redial(e)
          }
        })
      }
      return card
    }

    // Server-authored appearance-change notice — see docs/PROGRESS.md Batch C.
    // Payload carries {event, value}; only ever server-sent (socketServer.ts
    // rejects a client-sent 'system' type).
    const WALLPAPER_LABELS: Record<string, string> = { off: 'Off', love: 'Love', samurai: 'Samurai' }
    const STYLE_LABELS: Record<string, string> = { line: 'Bubbles', bubbles: 'Bubbles' }

    const systemNoticeText = (message: ChatMessage): string => {
      const p = (message.payload ?? {}) as { event?: string; value?: string }
      const who = message.senderId === myUserId ? 'You' : otherName
      if (p.event === 'wallpaper') {
        return `${who} changed the wallpaper to ${WALLPAPER_LABELS[p.value ?? ''] ?? p.value}`
      }
      if (p.event === 'style') {
        return `${who} changed the message style to ${STYLE_LABELS[p.value ?? ''] ?? p.value}`
      }
      return `${who} changed an appearance setting`
    }

    // Pure row build (no DOM insertion, no side effects) so both the forward
    // append and the "load older" prepend can share it.
    const buildMessageRow = (message: ChatMessage, pending: boolean): HTMLElement => {
      // Renders as a plain system line (the leave-events/"start of your
      // one-on-one" style), not a message bubble — no receipt, reaction,
      // reply or quote affordance exists on this element at all.
      if (message.type === 'system') {
        const line = document.createElement('div')
        line.className = 'chat__system-line'
        line.dataset.type = message.type
        if (message.id) line.dataset.id = message.id
        line.textContent = systemNoticeText(message)
        return line
      }
      const at = new Date(message.createdAt)
      const isMine = message.senderId === myUserId
      const row = document.createElement('div')
      row.className = 'chat__message' + (pending ? ' chat__message--pending' : '')
      row.dataset.at = message.createdAt
      row.dataset.type = message.type // lets CSS give image/voice/file their own bubble treatment
      row.dataset.sender = message.senderId
      if (message.id && !message.deletedAt && message.type !== 'call') {
        row.tabIndex = 0
        row.setAttribute('aria-label', 'Message. Press Enter to select.')
      }
      if (message.deletedAt) row.dataset.deleted = '1'
      if (message.type === 'image' && message.content) row.dataset.caption = '1'
      if (message.id) row.dataset.id = message.id
      row.dataset.metaSide = metaSide(isMine)
      if (isSticker(message)) row.dataset.sticker = '1'

      const body = document.createElement('div')
      body.className = 'chat__message-body'

      const text = document.createElement('div')
      text.className = 'chat__message-text'
      if (message.deletedAt) text.textContent = DELETED_MESSAGE
      else linkifyInto(text, message.content)

      const fullTime = document.createElement('div')
      fullTime.className = 'chat__message-full-time'
      fullTime.textContent = formatFullTimestamp(at)
      if (message.editedAt) fullTime.textContent += ` · edited ${formatFullTimestamp(new Date(message.editedAt))}`

      // Time and ticks share the bubble's bottom-right footer.
      const meta = document.createElement('div')
      meta.className = 'chat__meta'
      meta.addEventListener('click', (e) => { e.stopPropagation(); row.classList.toggle('chat__message--expanded') })

      const bubbleTime = document.createElement('div')
      bubbleTime.className = 'chat__bubble-time'
      bubbleTime.textContent = message.editedAt && !message.deletedAt ? `edited ${formatMessageTime(new Date(message.editedAt))}` : formatMessageTime(at)
      meta.append(bubbleTime)

      const content =
        message.deletedAt ? text : message.type === 'letter'
          ? letterCard(message)
          : message.type === 'image'
            ? imageBubble(message)
            : message.type === 'voice'
              ? voiceBubble(message)
              : message.type === 'file'
                ? fileCard(message)
                : message.type === 'countdown'
                  ? countdownCard(message)
                  : message.type === 'checkin'
                    ? checkinCard(message)
                    : message.type === 'ask'
                      ? askCard(message)
                      : message.type === 'thisorthat'
                        ? thisorthatCard(message)
                        : message.type === 'alarm'
                          ? alarmCard(message)
                          : message.type === 'call'
                            ? callLogCard(message)
                            : message.type === 'location'
                              ? locationCard(message)
                              : text

      const cardTitles: Partial<Record<MessageType, string>> = {
        letter: 'Letter', countdown: 'Countdown', checkin: 'Check-in', ask: 'Ask', thisorthat: 'This or that',
      }
      const cardTitle = cardTitles[message.type]
      if (cardTitle && !message.deletedAt) {
        const heading = document.createElement('div')
        heading.className = 'chat__card-heading'
        const icon = content.querySelector<HTMLElement>('[class$="__icon"]')
        if (icon) heading.append(icon)
        heading.append(document.createTextNode(cardTitle))
        content.prepend(heading)
      }
      if (message.replyTo && !message.deletedAt) body.append(quoteBlock(message.replyTo))
      if (message.type === 'text' && !message.deletedAt) {
        const url = messageLinks(message.content).find((l) => !l.url.startsWith('tel:'))?.url
        if (url) body.append(linkPreviewCard(url))
      }
      body.append(content)
      if (isMine) {
        row.dataset.mine = '1' // keyed by the bubble-mode preview
        // Call rows carry no receipt (they're server-authored, not "sent") —
        // just the alignment.
        if (message.type !== 'call') {
          if (!pending) row.dataset.delivered = '1'
          const receipt = document.createElement('span')
          receipt.className = 'chat__receipt'
          // Tick state is filled by applyReceipt.
          const ticks = document.createElement('span')
          ticks.className = 'chat__receipt-ticks'
          receipt.append(ticks)
          meta.append(receipt)
        }
      }
      // Text bubbles: float the footer INSIDE the text's own inline flow
      // (WhatsApp's actual technique) so it hugs the end of the last line
      // instead of sitting on its own row below the paragraph — the
      // browser's native text reflow wraps around it per-line for free.
      // Every other type keeps the footer as its own row after the content.
      if (message.type === 'text' || message.deletedAt) text.append(meta)
      else if (message.type === 'image' && !isSticker(message)) content.querySelector('.image-bubble__media')!.append(meta)
      else body.append(meta)
      body.append(fullTime)
      row.append(body)
      if (isMine && pending) {
        const discard = document.createElement('button')
        discard.type = 'button'; discard.className = 'chat__discard'; discard.textContent = 'Delete locally'
        discard.addEventListener('click', (e) => {
          e.stopPropagation()
          discardPending(row)
          const own = myRows.indexOf(row); if (own !== -1) myRows.splice(own, 1)
          row.remove()
        })
        row.append(discard)
      }
      if (!pending && !message.deletedAt && message.type !== 'call') addHoverActions(row)
      // Tapping content reveals the full timestamp.
      content.addEventListener('click', () => row.classList.toggle('chat__message--expanded'))
      return row
    }

    // Side effects after a row is in the DOM (receipts, id map, reaction chips).
    const registerMessageRow = (message: ChatMessage, row: HTMLElement): void => {
      if (message.id) {
        rowsById.set(message.id, row)
        messagesById.set(message.id, { ...message, id: message.id })
      }
      // Index server rows for dedupe; call/system rows have no interaction controls.
      if (message.type === 'call' || message.type === 'system') return
      if (message.senderId === myUserId) {
        myRows.push(row)
        applyReceipt(row)
      }
      if (message.id) {
        if (message.deletedAt) reactionsByMessage.delete(message.id)
        if (message.reactions) reactionsByMessage.set(message.id, message.reactions.map((r) => ({ emoji: r.emoji, userIds: [...r.userIds] })))
        if (!message.deletedAt && reactionsByMessage.has(message.id)) renderReactionChips(message.id)
      }
    }

    // animate: true only for a message arriving live (sent or received) this
    // session — never for history/pagination, or every past message would
    // cascade-animate in on load.
    const messageRows = (): NodeListOf<HTMLElement> => log.querySelectorAll<HTMLElement>('.chat__message[data-at]')
    // Presentation only: adjacent messages from one sender within a minute.
    const updateGroup = (row: Element | null): void => {
      if (!(row instanceof HTMLElement) || !row.classList.contains('chat__message')) return
      const prev = row.previousElementSibling as HTMLElement | null
      const delta = Date.parse(row.dataset.at ?? '') - Date.parse(prev?.dataset.at ?? '')
      row.dataset.groupStart = prev?.classList.contains('chat__message') &&
        prev.dataset.sender === row.dataset.sender && delta >= 0 && delta <= 60_000 &&
        isSameDay(new Date(prev.dataset.at!), new Date(row.dataset.at!)) ? '0' : '1'
    }
    // First rendered message strictly later than `iso` (so a message that
    // arrives out of order — e.g. after a resync — lands where it belongs).
    const findNextRow = (iso: string): HTMLElement | null => {
      const t = Date.parse(iso)
      if (Number.isNaN(t)) return null
      const rows = messageRows()
      let next: HTMLElement | null = null
      for (let i = rows.length - 1; i >= 0; i--) {
        if (Date.parse(rows[i].dataset.at!) > t) next = rows[i]
        else break
      }
      return next
    }
    // Insert `row` before `next`, keeping date separators right.
    const insertOrdered = (row: HTMLElement, at: Date, next: HTMLElement): void => {
      let anchor: Element = next
      const nextSep = next.previousElementSibling
      if (nextSep?.classList.contains('chat__date-separator') && !isSameDay(new Date(next.dataset.at!), at)) anchor = nextSep
      log.insertBefore(row, anchor)
      if (!row.previousElementSibling?.classList.contains('chat__date-separator')) {
        let prev = row.previousElementSibling
        while (prev && !(prev.classList.contains('chat__message') && (prev as HTMLElement).dataset.at)) prev = prev.previousElementSibling
        if (!prev || !isSameDay(new Date((prev as HTMLElement).dataset.at!), at)) log.insertBefore(dateSeparator(at), row)
      }
      updateGroup(row)
      updateGroup(row.nextElementSibling)
    }
    // The server echo replaces an optimistic row's client time; if that crosses
    // midnight the row must move to the right day (and orphan separators go).
    const relocateIfDayChanged = (row: HTMLElement, oldAt: string | undefined, newAt: string): void => {
      updateGroup(row)
      updateGroup(row.nextElementSibling)
      const o = oldAt ? new Date(oldAt) : null
      const n = new Date(newAt)
      if (!o || Number.isNaN(o.getTime()) || Number.isNaN(n.getTime()) || isSameDay(o, n)) return
      const prev = row.previousElementSibling
      const after = row.nextElementSibling
      row.remove()
      updateGroup(after)
      if (prev?.classList.contains('chat__date-separator') && (!after || after.classList.contains('chat__date-separator'))) prev.remove()
      const next = findNextRow(newAt)
      if (next) insertOrdered(row, n, next)
      else {
        const rows = messageRows()
        const last = rows[rows.length - 1]
        if (!last || !isSameDay(new Date(last.dataset.at!), n)) log.appendChild(dateSeparator(n))
        log.appendChild(row)
        updateGroup(row)
      }
      const rows = messageRows()
      lastDate = rows.length ? new Date(rows[rows.length - 1].dataset.at!) : null
    }

    const appendMessage = (message: ChatMessage, pending = false, animate = false): HTMLElement => {
      const at = new Date(message.createdAt)
      const isMine = message.senderId === myUserId
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80
      // Live (animate) messages that sort before what's already shown are
      // inserted in order rather than appended.
      const orderedNext = !pending && animate && !Number.isNaN(at.getTime()) ? findNextRow(message.createdAt) : null
      if (!orderedNext && !Number.isNaN(at.getTime()) && (!lastDate || !isSameDay(lastDate, at))) {
        log.appendChild(dateSeparator(at))
        lastDate = at
      }
      const row = buildMessageRow(message, pending)
      if (animate) row.classList.add('chat__message--enter')
      if (orderedNext) insertOrdered(row, at, orderedNext)
      else log.appendChild(row)
      updateGroup(row)
      updateGroup(row.nextElementSibling)
      if (atBottom || isMine) log.scrollTo({ top: log.scrollHeight, behavior: isMine && animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' })
      registerMessageRow(message, row)
      return row
    }

    // --- Read receipts: sent/delivered gray ticks; seen uses the read color.
    const myRows: HTMLElement[] = []
    let otherLastRead: string | null = current.otherLastReadAt
    let otherLastDelivered: string | null = current.otherLastDeliveredAt

    // Tick paths inherit the receipt state color.
    const TICK_SINGLE =
      '<svg viewBox="0 0 16 15" width="14" height="13"><path fill="currentColor" d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512z"/></svg>'
    const TICK_DOUBLE =
      '<svg viewBox="0 0 16 15" width="14" height="13"><path fill="currentColor" d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512z"/><path fill="currentColor" d="M11.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.666 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.517.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.064-.512z"/></svg>'

    const applyReceipt = (row: HTMLElement): void => {
      const receipt = row.querySelector<HTMLElement>('.chat__receipt')
      if (!receipt) return
      const at = row.dataset.at
      const acked = row.dataset.delivered === '1' // server has persisted the send — "sent"
      const delivered = acked && !!otherLastDelivered && !!at && new Date(at) <= new Date(otherLastDelivered)
      const seen = acked && !!otherLastRead && !!at && new Date(at) <= new Date(otherLastRead)
      receipt.classList.toggle('chat__receipt--pending', !acked)
      receipt.classList.toggle('chat__receipt--delivered', delivered)
      receipt.classList.toggle('chat__receipt--seen', seen)
      const ticks = receipt.querySelector<HTMLElement>('.chat__receipt-ticks')
      const state = seen ? 'seen' : delivered ? 'delivered' : acked ? 'sent' : 'pending'
      if (ticks && ticks.dataset.state !== state) {
        ticks.dataset.state = state; ticks.innerHTML = delivered || seen ? TICK_DOUBLE : TICK_SINGLE
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) ticks.animate([{ opacity: .2, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 180 })
      }
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
        reveal(root.querySelector<HTMLElement>('#leave-strip')!, false)
        return
      }
      if (c.bothLeaving) banner.textContent = "You're both leaving. Open the menu to end now."
      else if (c.myLeaveStep > 0) banner.textContent = `You're leaving — ${dayWord(c.daysRemaining ?? 0)}.`
      else banner.textContent = `${otherName} is leaving — ${dayWord(5 - c.otherLeaveStep)}.`
      reveal(root.querySelector<HTMLElement>('#leave-strip')!, true)
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
    let hasOlder = false

    const loadOlderBtn = document.createElement('button')
    loadOlderBtn.type = 'button'
    loadOlderBtn.className = 'chat__load-older'
    loadOlderBtn.textContent = 'Load older messages'

    const loadOlder = async (): Promise<void> => {
      if (loadingOlder || !oldestLoadedAt || !hasOlder) return
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
        hasOlder = false
        loadingOlder = false
        loadOlderBtn.remove()
        return
      }
      const prevHeight = log.scrollHeight
      const prevTop = log.scrollTop
      const firstSep = loadOlderBtn.nextSibling // the original leading date separator
      const firstRow = log.querySelector<HTMLElement>('.chat__message')
      const fragment = document.createDocumentFragment()
      let batchDate: Date | null = null
      for (const m of older) {
        if (rowsById.has(m.id)) continue
        const at = new Date(m.createdAt)
        if (!Number.isNaN(at.getTime()) && (!batchDate || !isSameDay(batchDate, at))) {
          fragment.appendChild(dateSeparator(at))
          batchDate = at
        }
        const row = buildMessageRow(m, false)
        fragment.appendChild(row)
        updateGroup(row)
        registerMessageRow(m, row)
      }
      log.insertBefore(fragment, firstSep)
      // Drop the pre-existing leading separator if the batch already ended on that day.
      if (
        firstSep instanceof HTMLElement &&
        firstSep.classList.contains('chat__date-separator') &&
        batchDate &&
        firstRow?.dataset.at && isSameDay(batchDate, new Date(firstRow.dataset.at))
      ) {
        firstSep.remove()
      }
      updateGroup(firstRow)
      oldestLoadedAt = older[0].createdAt
      hasOlder = older.length >= HISTORY_PAGE
      loadingOlder = false
      renderPin()
      for (const quote of log.querySelectorAll<HTMLElement>('.chat__quote')) {
        const original = messagesById.get(quote.dataset.replyTo ?? '')
        if (original) quote.querySelector('.chat__quote-snippet')!.textContent = snippetOf(original)
      }
      log.scrollTop = prevTop + (log.scrollHeight - prevHeight)
      if (!hasOlder) loadOlderBtn.remove()
      else {
        loadingOlder = false
        loadOlderBtn.disabled = false
      }
    }
    loadOlderBtn.addEventListener('click', () => void loadOlder())

    const jumpToMessage = async (id: string): Promise<void> => {
      if (loadingOlder) { showNotice('Messages are loading. Try again in a moment.'); return }
      while (!rowsById.has(id) && hasOlder && !disposed) {
        const before = oldestLoadedAt
        await loadOlder()
        if (oldestLoadedAt === before) break
      }
      if (disposed) return
      const target = rowsById.get(id)
      if (!target) { showNotice('This message is not available.'); return }
      target.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
      target.classList.remove('chat__message--flash')
      requestAnimationFrame(() => target.classList.add('chat__message--flash'))
      setTimeout(() => target.classList.remove('chat__message--flash'), 900)
    }

    const history = (await getMessages(connectionId))
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    if (disposed) return
    // One batched sign call warms the cache for the whole page, so each
    // bubble's own hydrateMedia() call below resolves from cache instead of
    // firing its own request.
    const historyMediaPaths = history.map(mediaPathOf).filter((p): p is string => !!p)
    if (historyMediaPaths.length) void getSignedUrls(connectionId, historyMediaPaths).catch(() => {})
    for (const m of history) {
      const ackOf = m.type === 'alarm' ? (m.payload as { ack?: string; cancelled?: boolean } | null) : null
      if (ackOf?.ack) ackedRaises.set(ackOf.ack, ackOf.cancelled === true)
    }
    for (const m of history) noteServerTime(m.createdAt)
    const historyFragment = document.createDocumentFragment()
    // Resolve quotes even when the original occurs later in the same page.
    for (const message of history) messagesById.set(message.id, message)
    for (const message of history) {
      const at = new Date(message.createdAt)
      if (!Number.isNaN(at.getTime()) && (!lastDate || !isSameDay(lastDate, at))) {
        historyFragment.appendChild(dateSeparator(at))
        lastDate = at
      }
      const row = buildMessageRow(message, false)
      historyFragment.appendChild(row)
      updateGroup(row)
      registerMessageRow(message, row)
    }
    if (!history.length) {
      const empty = document.createElement('div')
      empty.className = 'chat__system-line'
      empty.textContent = 'Say hello — this is the start of your one-on-one.'
      historyFragment.appendChild(empty)
    }
    log.appendChild(historyFragment)
    // Resume the alert on reopen only if the latest raise is still live: newer
    // than the auto-clear window, with no ack/cancel anywhere in history (an
    // ack is its own reply-linked alarm message, not necessarily the latest
    // alarm row), and not already silenced/auto-cleared on this device.
    const lastRaise = [...history].reverse().find(
      (m) => m.type === 'alarm' && !(m.payload as { ack?: string } | null)?.ack,
    )
    if (lastRaise?.id && !ackedRaises.has(lastRaise.id) && !isAlarmSilenced(lastRaise.id)) {
      const age = Date.now() - new Date(lastRaise.createdAt).getTime()
      if (age < ALARM_AUTO_CLEAR_MS) {
        const raiseId = lastRaise.id
        const mine = lastRaise.senderId === myUserId
        void getNativeAlarmState().then((native) => {
          if (disposed || isAlarmSilenced(raiseId) || ackedRaises.has(raiseId)) return
          // Native already ringing (or the user silenced it there): show the glow
          // and the acknowledge card but never start a second, JS ring.
          const nativeHandled = native.ringing || native.lastStoppedAlarmId === raiseId
          incomingAlarmId = mine ? null : raiseId
          setAlarmGlow(true)
          alarmController?.start({
            silent: mine || nativeHandled,
            alarmId: raiseId,
            remainingMs: ALARM_AUTO_CLEAR_MS - age,
          })
        })
      }
    }
    oldestLoadedAt = history[0]?.createdAt ?? null
    hasOlder = history.length >= HISTORY_PAGE
    if (hasOlder) log.querySelector('.chat__enc-note')!.after(loadOlderBtn)
    renderPin()
    refreshReceipts()
    renderBanner(current)
    reconcileLeave(current)
    log.scrollTop = log.scrollHeight
    updatePresence(current.otherLastReadAt)
    markReadNow()

    // --- Outgoing (optimistic) --------------------------------------------
    const pending: Pending[] = []
    const discardPending = (row: HTMLElement): void => {
      const index = pending.findIndex((entry) => entry.row === row)
      if (index !== -1) pending.splice(index, 1)
    }

    const trySend = (entry: Pending): Promise<void> => {
      if (!transport) return Promise.resolve() // stays queued; flushed on (re)connect
      entry.sent = true
      entry.row.dataset.inflight = '1'
      entry.row.classList.remove('chat__message--failed')
      const p = entry.payload as ImagePayload
      const payload = entry.type === 'image' ? { path: p.path, mime: p.mime, size: p.size, width: p.width, height: p.height } : entry.payload
      return transport.sendMessage(entry.content, entry.type, payload, entry.replyTo, entry.tempId).then(
        (saved) => {
          // The ack carries the saved message (the original one on a deduped
          // resend), so the optimistic row reconciles even if the echo was lost.
          if (saved && pending.includes(entry)) onIncoming({ ...saved, tempId: entry.tempId })
        },
        () => {
          entry.sent = false
          delete entry.row.dataset.inflight
          entry.row.classList.add('chat__message--failed')
        },
      )
    }

    const flushPending = (): Promise<void> =>
      Promise.allSettled(pending.filter((entry) => !entry.sent).map(trySend)).then(() => undefined)

    const input = root.querySelector<HTMLTextAreaElement>('#message-input')!
    const composer = root.querySelector<HTMLFormElement>('#composer')!
    const sendBtn = root.querySelector<HTMLButtonElement>('#send-btn')!
    const micBtn = root.querySelector<HTMLButtonElement>('#mic-btn')!
    const attachBtn = root.querySelector<HTMLButtonElement>('#attach-btn')!
    let editTarget: QuotableMessage | null = null
    let draftBeforeEdit = ''
    let editSending = false
    let lastTypingSent = 0
    let typingSent = false
    const sendDraftTyping = (): void => {
      const active = input.value.trim().length > 0
      if (!active && typingSent) { transport?.sendTyping(false); typingSent = false }
      else if (active && transport?.getState() === 'connected' && Date.now() - lastTypingSent >= 3000) {
        transport.sendTyping(true)
        typingSent = true
        lastTypingSent = Date.now()
      }
    }
    overlays.add(() => { if (typingSent) transport?.sendTyping(false) })

    // Tapping a <button> moves focus to it on most mobile browsers, which
    // dismisses the soft keyboard — jarring versus WhatsApp/iMessage, where
    // the keyboard stays open after send. preventDefault on pointerdown stops
    // that focus steal without blocking the click/submit that follows it.
    sendBtn.addEventListener('pointerdown', (e) => e.preventDefault())

    // Auto-grow the composer (a textarea, so blank-line paragraph gaps survive)
    // up to a few lines, then it scrolls internally.
    const MAX_INPUT_HEIGHT = 120
    const autoGrow = (): void => {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`
    }

    // Send button shows once there's text to send; otherwise the mic takes its
    // place (WhatsApp/Instagram placement) so composing and recording never
    // fight for the same slot.
    const updateComposerMode = (): void => {
      const hasText = input.value.trim().length > 0
      sendBtn.disabled = editSending
      micBtn.disabled = !!editTarget
      attachBtn.disabled = !!editTarget
      root.querySelector<HTMLButtonElement>('#sticker-btn')!.disabled = !!editTarget
      root.querySelector<HTMLButtonElement>('#camera-btn')!.disabled = !!editTarget
      sendBtn.inert = !hasText; micBtn.inert = hasText
      sendBtn.setAttribute('aria-hidden', String(!hasText)); micBtn.setAttribute('aria-hidden', String(hasText))
      sendBtn.classList.toggle('chat__input-bar-btn--hidden', !hasText)
      micBtn.classList.toggle('chat__input-bar-btn--hidden', hasText)
    }

    const syncComposer = (): void => {
      autoGrow()
      updateComposerMode()
      sendDraftTyping()
    }
    input.addEventListener('input', syncComposer)
    syncComposer()

    const sendMessage = (
      content: string,
      type: MessageType = 'text',
      payload: unknown = null,
      replyTo: string | null = null,
    ): void => {
      if (typingSent) { transport?.sendTyping(false); typingSent = false }
      const tempId = crypto.randomUUID()
      const row = appendMessage(
        { senderId: myUserId, content, createdAt: new Date().toISOString(), type, payload, replyTo },
        true,
        true,
      )
      const entry: Pending = { tempId, content, row, sent: false, type, payload, replyTo }
      pending.push(entry)
      trySend(entry)

      // Your own raise lights up optimistically. Acks/cancels never go through
      // here — see sendAlarmAck, which only stops the alert once the server
      // confirms it recorded the ack.
      if (type === 'alarm') {
        setAlarmGlow(true)
        alarmController?.start({ silent: true }) // you don't need alerting to your own alarm
      }
    }

    const uploadMedia = async (type: 'image' | 'voice', preview: unknown, upload: () => Promise<unknown>, replyTo: string | null): Promise<void> => {
      const row = appendMessage({ senderId: myUserId, content: '', createdAt: new Date().toISOString(), type, payload: preview, replyTo }, true, true)
      row.dataset.uploading = '1'
      const status = document.createElement('span'); status.className = 'chat__upload-status'; status.textContent = 'Sending…'; status.setAttribute('role', 'status')
      row.querySelector('.chat__message-body')!.append(status)
      try {
        const payload = await upload()
        if (disposed || !row.isConnected) return
        const own = myRows.indexOf(row); if (own !== -1) myRows.splice(own, 1)
        row.remove()
        sendMessage('', type, payload, replyTo)
      } catch (err) {
        if (disposed || !row.isConnected) return
        delete row.dataset.uploading; row.classList.add('chat__message--failed'); status.textContent = 'Not sent'
        showNotice(err instanceof Error ? err.message : 'Could not send media. Try again.')
      }
    }
    root.querySelector('#sticker-btn')!.addEventListener('click', () => {
      const dispose = openMediaPicker({ owner: myUserId,
        onSticker: (sticker) => {
          const reply = replyTarget?.id ?? null; cancelReply()
          const localUrl = URL.createObjectURL(sticker.blob); imageObjectUrls.add(localUrl)
          void uploadMedia('image', { mime: 'image/webp', width: 512, height: 512, localUrl }, async () => {
            const blob = await stickerBlob(sticker.blob), uploaded = await uploadAttachment(connectionId, 'image', blob)
            if (uploaded.mime !== 'image/webp' || uploaded.size > 100_000 || !uploaded.path.startsWith(`${connectionId}/`)) throw new Error('Invalid sticker upload response.')
            return { ...uploaded, width: 512, height: 512, localUrl }
          }, reply)
        },
        onGif: (gif) => {
          const reply = replyTarget?.id ?? null; cancelReply()
          void uploadMedia('image', { mime: 'image/gif', width: gif.width, height: gif.height, localUrl: gif.previewUrl }, () => prepareGif(connectionId, gif.id), reply)
        },
      })
      overlays.add(dispose)
    })

    // Acknowledge (recipient) or cancel (raiser) a live alarm. Not optimistic
    // and not queued: the server must record it or the other side keeps
    // ringing, so the alert only stops locally after the server confirms
    // (the ack also carries the existing ack on an idempotent repeat).
    const sendAlarmAck = async (raiseId: string, cancelled: boolean): Promise<void> => {
      if (!transport) throw new Error('offline')
      const payload = cancelled ? { ack: raiseId, cancelled: true } : { ack: raiseId }
      const saved = await transport.sendMessage('', 'alarm', payload, raiseId)
      markRaiseAcked(raiseId, cancelled)
      alarmController?.stopAll(raiseId)
      setAlarmGlow(false)
      if (saved) onIncoming(saved) // appends the ack card (deduped if the echo already did)
    }

    // --- Reply: swipe (phone) or right-click "Reply" (desktop) sets a target;
    // the next send carries it as replyTo and clears the bar.
    const replyBar = root.querySelector<HTMLDivElement>('#reply-bar')!
    const replyBarName = root.querySelector<HTMLDivElement>('#reply-bar-name')!
    const replyBarSnippet = root.querySelector<HTMLDivElement>('#reply-bar-snippet')!
    let replyTarget: QuotableMessage | null = null

    const renderReplyBar = (): void => {
      if (!replyTarget) {
        reveal(replyBar, false)
        return
      }
      replyBarName.textContent = replyTarget.senderId === myUserId ? 'You' : otherName
      replyBarSnippet.textContent = snippetOf(replyTarget)
      reveal(replyBar, true)
    }

    const startReply = (id: string): void => {
      const target = messagesById.get(id)
      if (!target || target.deletedAt) return
      if (editTarget) cancelEdit()
      replyTarget = target
      renderReplyBar()
      // Deferred a frame so the reply-bar's own slide-in transition gets to
      // start before focus() triggers the keyboard — opening both at once is
      // what makes the combined animation feel janky on phones.
      requestAnimationFrame(() => input.focus())
    }

    const cancelReply = (): void => {
      replyTarget = null
      renderReplyBar()
    }

    root.querySelector<HTMLButtonElement>('#reply-bar-cancel')!.addEventListener('click', cancelReply)

    const editBar = root.querySelector<HTMLElement>('#edit-bar')!
    const cancelEdit = (): void => {
      if (!editTarget) return
      editTarget = null
      input.value = draftBeforeEdit
      editSending = false
      reveal(editBar, false)
      composer.dataset.editing = 'false'
      input.dispatchEvent(new Event('input'))
    }
    const startEdit = (id: string): void => {
      const message = messagesById.get(id)
      if (!message || !canEdit(message, myUserId)) { showNotice('Only your text messages from the last 30 minutes can be edited.'); return }
      if (editTarget) cancelEdit()
      draftBeforeEdit = input.value
      editTarget = message
      cancelReply()
      root.querySelector<HTMLElement>('#edit-bar-snippet')!.textContent = message.content
      input.value = message.content
      composer.dataset.editing = 'true'
      reveal(editBar, true)
      input.dispatchEvent(new Event('input'))
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }
    root.querySelector<HTMLButtonElement>('#edit-bar-cancel')!.addEventListener('click', cancelEdit)

    const send = (): void => {
      const content = input.value.trim()
      if (!content) return
      if (content.length > 4000) { showNotice('Messages must be 1–4000 characters.'); return }
      if (editTarget) {
        if (editSending) return
        const target = editTarget
        if (!canEdit(target, myUserId)) { showNotice('Messages can only be edited within 30 minutes.'); return }
        if (!transport) { showNotice('Connect to the internet to edit.'); return }
        editSending = true
        if (typingSent) { transport.sendTyping(false); typingSent = false }
        updateComposerMode()
        void transport.editMessage(target.id, content).then((message) => {
          if (disposed) return
          onMessageUpdate(message)
          if (editTarget?.id === target.id) cancelEdit()
        }).catch((err) => showNotice(err instanceof Error ? err.message : 'Could not edit. Your draft is still here.'))
          .finally(() => { editSending = false; if (!disposed) updateComposerMode() })
        return
      }
      input.value = ''
      syncComposer()
      const replyTo = replyTarget?.id ?? null
      cancelReply()
      sendMessage(content, 'text', null, replyTo)
      input.focus() // keep the keyboard open for the next message, like WhatsApp
    }

    // --- Attachments: "+" opens Photo/File; picking one uploads then sends
    // immediately (no caption step, matching the plan) as a media message. --
    const imageInput = root.querySelector<HTMLInputElement>('#attach-image-input')!
    const fileInput = root.querySelector<HTMLInputElement>('#attach-file-input')!
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024
    const MAX_FILE_BYTES = 25 * 1024 * 1024

    const CAMERA_ICON =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'
    const ATTACH_FILE_ICON =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>'

    const openAttachMenu = (): void => {
      const wrap = document.createElement('div')
      wrap.className = 'attach-menu'
      const photoBtn = document.createElement('button')
      photoBtn.type = 'button'
      photoBtn.className = 'attach-menu__item'
      photoBtn.innerHTML = `${CAMERA_ICON}<span>Photo</span>`
      const fileBtn = document.createElement('button')
      fileBtn.type = 'button'
      fileBtn.className = 'attach-menu__item'
      fileBtn.innerHTML = `${ATTACH_FILE_ICON}<span>File</span>`
      wrap.append(photoBtn, fileBtn)
      const modal = openModal(wrap)
      photoBtn.addEventListener('click', () => {
        modal.close()
        imageInput.click()
      })
      fileBtn.addEventListener('click', () => {
        modal.close()
        fileInput.click()
      })
    }
    attachBtn.addEventListener('click', openAttachMenu)
    root.querySelector('#camera-btn')!.addEventListener('click', () => root.querySelector<HTMLInputElement>('#camera-input')!.click())
    root.querySelector<HTMLInputElement>('#camera-input')!.addEventListener('change', (e) => { const pick = e.target as HTMLInputElement; const file = pick.files?.[0]; pick.value = ''; if (file) void sendImage(file) })

    // Object URLs created for your own just-sent photos (see sendImage) live
    // for the rest of the session so their bubble keeps rendering from the
    // local file; released together on page teardown rather than per-message.
    const imageObjectUrls = new Set<string>()
    overlays.add(() => {
      for (const url of imageObjectUrls) URL.revokeObjectURL(url)
      imageObjectUrls.clear()
    })

    const readImageDimensions = (file: File): Promise<{ width: number; height: number }> =>
      new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.onload = () => {
          URL.revokeObjectURL(url)
          resolve({ width: img.naturalWidth, height: img.naturalHeight })
        }
        img.onerror = () => {
          URL.revokeObjectURL(url)
          reject(new Error('could not read image'))
        }
        img.src = url
      })

    // Re-encode a picked image through a <canvas> before upload — this drops
    // any EXIF/GPS metadata the camera baked in (privacy). Also yields the
    // dimensions for free. GIFs skip this (canvas would flatten the animation)
    // and upload as-is; they rarely carry location data.
    const reencodeImage = (file: File): Promise<{ blob: Blob; width: number; height: number }> =>
      new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.onload = () => {
          URL.revokeObjectURL(url)
          const width = img.naturalWidth
          const height = img.naturalHeight
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error('no canvas context'))
            return
          }
          ctx.drawImage(img, 0, 0)
          const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
          canvas.toBlob(
            (blob) => (blob ? resolve({ blob, width, height }) : reject(new Error('encode failed'))),
            type,
            0.9,
          )
        }
        img.onerror = () => {
          URL.revokeObjectURL(url)
          reject(new Error('could not read image'))
        }
        img.src = url
      })

    const sendImage = async (file: File): Promise<void> => {
      if (file.size > MAX_IMAGE_BYTES) {
        showNotice('That photo is too large (max 10MB).')
        return
      }
      attachBtn.disabled = true
      let row: HTMLElement | null = null
      try {
        const isGif = file.type === 'image/gif'
        let uploadBlob: Blob = file
        let width: number
        let height: number
        if (isGif) {
          ;({ width, height } = await readImageDimensions(file))
        } else {
          const encoded = await reencodeImage(file)
          uploadBlob = encoded.blob
          width = encoded.width
          height = encoded.height
        }
        const uploadPromise = uploadAttachment(connectionId, 'image', uploadBlob)

        // Render at the real final size straight from the local blob — no blank
        // box, no waiting on the (much slower) upload to show anything.
        const localUrl = URL.createObjectURL(uploadBlob)
        imageObjectUrls.add(localUrl)
        row = appendMessage(
          {
            senderId: myUserId,
            content: '',
            createdAt: new Date().toISOString(),
            type: 'image',
            payload: { localUrl, width, height },
            replyTo: null,
          },
          true,
          true,
        )

        // Only enters the retry-tracked `pending` queue once there's a real
        // payload to send — pushing it earlier (while the upload is still in
        // flight) would let a poll/reconnect's flushPending() fire trySend
        // with no path yet and send a broken image message.
        const uploaded = await uploadPromise
        if (disposed || !row.isConnected) return
        const entry: Pending = {
          tempId: crypto.randomUUID(),
          content: '',
          row,
          sent: false,
          type: 'image',
          payload: { ...uploaded, width, height },
          replyTo: null,
        }
        pending.push(entry)
        trySend(entry)
      } catch {
        showNotice('Could not send that photo — try again.')
        row?.classList.add('chat__message--failed')
      } finally {
        attachBtn.disabled = false
      }
    }

    const sendFile = async (file: File): Promise<void> => {
      if (file.size > MAX_FILE_BYTES) {
        showNotice('That file is too large (max 25MB).')
        return
      }
      attachBtn.disabled = true
      try {
        const uploaded = await uploadAttachment(connectionId, 'file', file)
        sendMessage('', 'file', { ...uploaded, name: file.name })
      } catch {
        showNotice('Could not send that file — try again.')
      } finally {
        attachBtn.disabled = false
      }
    }

    imageInput.addEventListener('change', () => {
      const file = imageInput.files?.[0]
      imageInput.value = ''
      if (file) void sendImage(file)
    })
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      fileInput.value = ''
      if (file) void sendFile(file)
    })

    // --- Voice notes: tap the mic to start, tap again (same button, now a
    // stop glyph) to finish and send. The recording indicator REPLACES the
    // text input in place — never a separate element beside it — and every
    // exit path (send, cancel, teardown) routes through resetRecordingUI so
    // no state (timer text, hidden input) survives into the next take. -----
    const recordingBar = root.querySelector<HTMLDivElement>('#recording-bar')!
    const recordingTime = root.querySelector<HTMLSpanElement>('#recording-time')!
    const recordingCancelBtn = root.querySelector<HTMLButtonElement>('#recording-cancel')!
    const MIN_RECORDING_SEC = 1

    const MIC_ICON =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
    const STOP_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    let recorderHandle: VoiceRecorderHandle | null = null
    let recordingTimer: ReturnType<typeof setInterval> | null = null
    let recordingStartedAt = 0
    let isRecording = false

    const stopRecordingTimer = (): void => {
      if (recordingTimer) clearInterval(recordingTimer)
      recordingTimer = null
    }

    // The one place idle composer state is (re)established — always safe to
    // call, recording or not.
    const resetRecordingUI = (): void => {
      isRecording = false
      composer.dataset.recording = 'false'
      recordingBar.inert = true; recordingBar.setAttribute('aria-hidden', 'true')
      recordingTime.textContent = formatDuration(0)
      input.hidden = false
      attachBtn.hidden = false
      micBtn.disabled = false
      micBtn.innerHTML = MIC_ICON
      micBtn.title = 'Record a voice note'
      micBtn.setAttribute('aria-label', 'Record voice note')
    }
    resetRecordingUI()

    const beginRecording = async (): Promise<void> => {
      if (isRecording) return
      if (!(await ensurePermissionRationale('microphone'))) return
      let handle: VoiceRecorderHandle
      try {
        handle = await startRecording()
      } catch {
        showNotice('Could not access the microphone.')
        return
      }
      if (disposed) {
        handle.cancel()
        return
      }
      recorderHandle = handle
      isRecording = true
      recordingStartedAt = Date.now()
      recordingTime.textContent = formatDuration(0)
      composer.dataset.recording = 'true'
      recordingBar.inert = false; recordingBar.setAttribute('aria-hidden', 'false')
      input.hidden = true
      attachBtn.hidden = true
      micBtn.innerHTML = STOP_ICON
      micBtn.title = 'Stop and send'
      micBtn.setAttribute('aria-label', 'Stop recording and send')
      recordingTimer = setInterval(() => {
        recordingTime.textContent = formatDuration((Date.now() - recordingStartedAt) / 1000)
      }, 250)
    }

    const finishRecording = async (shouldSend: boolean): Promise<void> => {
      const handle = recorderHandle
      recorderHandle = null
      stopRecordingTimer()
      resetRecordingUI() // clears instantly; a send (if any) continues in the background
      if (!handle) return
      if (!shouldSend) {
        handle.cancel()
        return
      }
      try {
        const { blob, durationSec } = await handle.stop()
        if (durationSec < MIN_RECORDING_SEC) return // accidental tap — drop silently
        const reply = replyTarget?.id ?? null; cancelReply()
        await uploadMedia('voice', { duration: durationSec }, async () => ({ ...await uploadAttachment(connectionId, 'voice', blob), duration: durationSec }), reply)
      } catch {
        showNotice('Could not send that voice note — try again.')
      }
    }

    micBtn.addEventListener('click', () => {
      if (isRecording) void finishRecording(true)
      else void beginRecording()
    })
    recordingCancelBtn.addEventListener('click', () => void finishRecording(false))

    // Leaving mid-recording must still release the mic (same teardown
    // tracking as the overlays this page opens — see `overlays` above).
    overlays.add(() => {
      recorderHandle?.cancel()
      recorderHandle = null
      stopRecordingTimer()
    })

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
      writeCountdown: () =>
        openCountdownComposer({
          onSend: (label, payload) => {
            sendMessage(label, 'countdown', payload)
            cancelReply()
          },
        }),
      writeCheckin: () =>
        openCheckinComposer({
          onSend: (note, payload) => {
            sendMessage(note, 'checkin', payload)
            cancelReply()
          },
        }),
      writeAsk: () =>
        openAskComposer({
          onSend: (question, payload) => {
            sendMessage(question, 'ask', payload)
            cancelReply()
          },
        }),
      writeThisOrThat: () =>
        openThisOrThatComposer({
          onSend: (content, payload) => {
            sendMessage(content, 'thisorthat', payload)
            cancelReply()
          },
        }),
      // No composer — there's nothing to write, just a confirm before firing
      // (an emergency alert is too easy to misfire without one).
      writeAlarm: () =>
        confirmSendAlarm(() => {
          sendMessage('', 'alarm', {})
          cancelReply()
        }),
      // No composer either — confirm, capture, send. writeLocationFlow owns
      // the permission-denied/failure toasts.
      writeLocation: () =>
        writeLocationFlow(otherName, (content, payload) => {
          sendMessage(content, 'location', payload)
          cancelReply()
        }),
    }

    // Form submit fires for the send button and the iOS keyboard's Go/Send key.
    // A phone's soft keyboard can submit "/letter" as literal text without ever
    // producing a catchable Enter keydown, so check for an exact command match
    // here too before falling back to a normal send.
    composer.addEventListener('submit', (e) => {
      e.preventDefault()
      if (!editTarget && runIfCommand(input.value, slashCtx)) {
        input.value = ''
        syncComposer()
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
      if (e.isComposing) return
      if (e.key === 'ArrowUp' && !input.value && !editTarget) {
        const latest = [...messagesById.values()].filter((m) => canEdit(m, myUserId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        if (latest) { e.preventDefault(); startEdit(latest.id) }
      }
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
      if (ctxMenu) animateOutAndRemove(ctxMenu, 'menu--closing')
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

    const openPopover = (anchor: Anchor | HTMLElement, build: (menu: HTMLElement) => void): void => {
      closeCtxMenu()
      const M = 8 // safe margin from every viewport edge
      const menu = document.createElement('div')
      menu.className = 'menu chat__ctx-menu'
      const theme = getComputedStyle(chatEl)
      for (const token of ['--bg', '--bg-raised', '--border', '--text', '--text-dim', '--muted', '--accent-you', '--danger']) {
        menu.style.setProperty(token, theme.getPropertyValue(token))
      }
      menu.style.visibility = 'hidden'
      menu.style.left = '0'
      menu.style.top = '0'
      build(menu)
      document.body.append(menu)

      const place = (): void => {
        const target = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor
        const vv = window.visualViewport
        const vw = vv?.width ?? document.documentElement.clientWidth
        const vh = vv?.height ?? document.documentElement.clientHeight
        const ox = vv?.offsetLeft ?? 0
        const oy = vv?.offsetTop ?? 0
        const logRect = log.getBoundingClientRect()
        const inLog = anchor instanceof HTMLElement && log.contains(anchor)
        const topEdge = inLog ? Math.max(oy + M, logRect.top + M) : oy + M
        const bottomEdge = inLog ? Math.min(oy + vh - M, logRect.bottom - M) : oy + vh - M
        menu.style.maxWidth = `${vw - 2 * M}px`
        menu.style.maxHeight = `${Math.max(48, bottomEdge - topEdge)}px`
        const width = menu.offsetWidth
        const height = menu.offsetHeight
        let left = target.left + target.width / 2 - width / 2
        left = Math.max(ox + M, Math.min(left, ox + vw - width - M))
        let top = target.top - height - M // prefer above the message
        if (top < topEdge) top = target.top + target.height + M // not enough room — flip below
        top = Math.max(topEdge, Math.min(top, bottomEdge - height))
        menu.style.left = `${left}px`
        menu.style.top = `${top}px`
        menu.style.visibility = ''
      }
      place()

      ctxMenu = menu
      const onScroll = (): void => {
        if (!(anchor instanceof HTMLElement) || !anchor.isConnected) { closeCtxMenu(); return }
        const target = anchor.getBoundingClientRect()
        const viewport = log.getBoundingClientRect()
        if (log.contains(anchor) && (target.bottom < viewport.top || target.top > viewport.bottom)) closeCtxMenu()
        else place()
      }
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
      const unregisterCtxBack = pushBackHandler(() => {
        closeCtxMenu()
        return true
      })
      const unregisterCtxPanel = openPanel(closeCtxMenu)
      menuCleanup = () => {
        clearTimeout(armTimer)
        log.removeEventListener('scroll', onScroll)
        window.removeEventListener('resize', onResize)
        window.visualViewport?.removeEventListener('resize', onResize)
        window.visualViewport?.removeEventListener('scroll', onScroll)
        document.removeEventListener('keydown', onKey)
        document.removeEventListener('click', onDocClick)
        unregisterCtxBack()
        unregisterCtxPanel()
      }
    }

    const buildEmojiRow = (menu: HTMLElement, messageId: string): void => {
      menu.classList.add('chat__quick-reactions')
      menu.setAttribute('role', 'toolbar')
      menu.setAttribute('aria-label', 'Quick reactions')
      const bubble = rowsById.get(messageId)?.querySelector<HTMLElement>('.chat__message-body')
      if (bubble) {
        const colors = getComputedStyle(bubble)
        menu.style.background = `${colors.backgroundImage} ${colors.backgroundColor}`
        menu.style.color = colors.color
        menu.style.setProperty('--text', colors.color)
        menu.style.setProperty('--bg', colors.backgroundColor)
        menu.style.transformOrigin = rowsById.get(messageId)?.dataset.mine ? 'right bottom' : 'left bottom'
      }
      const row = document.createElement('div')
      row.className = 'chat__emoji-picker'
      for (const emoji of ALLOWED_EMOJI) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'chat__emoji-picker-btn'
        btn.textContent = emoji
        btn.setAttribute('aria-label', `React with ${emoji}`)
        btn.setAttribute('aria-pressed', String((reactionsByMessage.get(messageId) ?? []).some((r) => r.emoji === emoji && r.userIds.includes(myUserId))))
        btn.addEventListener('pointerdown', (e) => e.preventDefault())
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          toggleReaction(messageId, emoji)
          closeCtxMenu()
        })
        row.append(btn)
      }
      const more = document.createElement('button')
      more.type = 'button'
      more.className = 'chat__emoji-picker-btn'
      more.innerHTML = PLUS_ICON
      more.setAttribute('aria-label', 'Choose another emoji')
      more.addEventListener('pointerdown', (e) => e.preventDefault())
      more.addEventListener('click', (e) => {
        e.stopPropagation()
        closeCtxMenu()
        const dispose = openEmojiPicker((emoji) => toggleReaction(messageId, emoji), () => overlays.delete(dispose))
        overlays.add(dispose)
      })
      row.append(more)
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

    const selectionBar = root.querySelector<HTMLElement>('#selection-bar')!
    let selectionExpiry: ReturnType<typeof setTimeout> | null = null
    let unregisterSelectionBack: (() => void) | null = null
    const pickedMessages = (): QuotableMessage[] => [...selectedIds].map((id) => messagesById.get(id))
      .filter((m): m is QuotableMessage => !!m && !m.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const updateSelection = (): void => {
      if (selectionExpiry) clearTimeout(selectionExpiry)
      selectionExpiry = null
      const picked = pickedMessages()
      const single = picked.length === 1 ? picked[0] : null
      nav.classList.toggle('chat__nav--selecting', selectedIds.size > 0)
      selectionBar.inert = !selectedIds.size
      selectionBar.setAttribute('aria-hidden', String(!selectedIds.size))
      for (const element of nav.querySelectorAll<HTMLElement>('.chat__nav-peer, .chat__nav-actions')) element.inert = selectedIds.size > 0
      const count = root.querySelector<HTMLElement>('#selection-count')!
      count.textContent = String(selectedIds.size)
      count.setAttribute('aria-label', `${selectedIds.size} message${selectedIds.size === 1 ? '' : 's'} selected`)
      root.querySelector<HTMLButtonElement>('#selection-reply')!.hidden = !single
      root.querySelector<HTMLButtonElement>('#selection-edit')!.hidden = !single || !canEdit(single, myUserId)
      root.querySelector<HTMLButtonElement>('#selection-delete')!.hidden = !picked.length || !picked.every((m) => canDelete(m, myUserId))
      for (const [id, row] of rowsById) row.classList.toggle('chat__message--selected', selectedIds.has(id))
      if (selectedIds.size && !unregisterSelectionBack) unregisterSelectionBack = pushBackHandler(() => { clearSelection(); return true })
      if (!selectedIds.size) { unregisterSelectionBack?.(); unregisterSelectionBack = null }
      const expires = picked.filter((m) => canDelete(m, myUserId)).map((m) => Date.parse(m.createdAt) + EDIT_WINDOW_MS - Date.now() + 1)
      if (expires.length) selectionExpiry = setTimeout(updateSelection, Math.max(1, Math.min(...expires)))
    }
    const clearSelection = (): void => { selectedIds.clear(); closeCtxMenu(); updateSelection() }
    const showQuickReactions = (id: string): void => {
      const message = messagesById.get(id)
      const bubble = rowsById.get(id)?.querySelector<HTMLElement>('.chat__message-body')
      if (!message || message.deletedAt || !bubble) return
      openPopover(bubble, (menu) => buildEmojiRow(menu, id))
    }
    const selectMessage = (id: string): void => {
      if (!messagesById.has(id) || messagesById.get(id)?.deletedAt) return
      selectedIds.add(id)
      updateSelection()
      showQuickReactions(id)
    }
    const copyText = (text: string): void => {
      if (!navigator.clipboard?.writeText) { showNotice('Copy is not available in this browser.'); return }
      void navigator.clipboard.writeText(text).then(() => showNotice('Copied.')).catch(() => showNotice('Could not copy.'))
    }
    const selectionText = (): string => pickedMessages().map((m) => m.content || snippetOf(m)).join('\n')
    root.querySelector<HTMLButtonElement>('#selection-close')!.addEventListener('click', clearSelection)
    root.querySelector<HTMLButtonElement>('#selection-copy')!.addEventListener('click', () => { copyText(selectionText()); clearSelection() })
    root.querySelector<HTMLButtonElement>('#selection-reply')!.addEventListener('click', () => { const m = pickedMessages()[0]; if (m) startReply(m.id); clearSelection() })
    root.querySelector<HTMLButtonElement>('#selection-edit')!.addEventListener('click', () => { const m = pickedMessages()[0]; if (m) startEdit(m.id); clearSelection() })
    root.querySelector<HTMLButtonElement>('#selection-delete')!.addEventListener('click', () => {
      const picked = pickedMessages()
      if (!picked.length || !picked.every((m) => canDelete(m, myUserId))) { updateSelection(); return }
      closeCtxMenu()
      const box = document.createElement('div')
      box.className = 'notice-popup'
      box.innerHTML = '<h2>Delete for everyone?</h2><p>These messages will be replaced with “This message was deleted” for both of you.</p><div class="report-dialog__actions"><button type="button" data-cancel>Cancel</button><button type="button" class="danger" data-delete>Delete</button></div>'
      const dispose = (): void => modal.close()
      const modal = openModal(box, { onClose: () => overlays.delete(dispose) })
      modal.panel.setAttribute('aria-label', 'Delete for everyone?')
      overlays.add(dispose)
      box.querySelector('[data-cancel]')!.addEventListener('click', modal.close)
      box.querySelector<HTMLButtonElement>('[data-delete]')!.addEventListener('click', async (e) => {
        const button = e.currentTarget as HTMLButtonElement
        button.disabled = true
        try {
          if (!transport) throw new Error('Connect to the internet to delete.')
          for (const message of picked) {
            if (disposed) return
            if (!canDelete(message, myUserId)) throw new Error('Messages can only be deleted within 30 minutes.')
            onMessageUpdate(await transport.deleteMessage(message.id))
          }
          modal.close()
          clearSelection()
        } catch (err) { button.disabled = false; showNotice(err instanceof Error ? err.message : 'Could not delete. Try again.') }
      })
    })
    const openSelectionMenu = (anchor: HTMLElement): void => {
      const picked = pickedMessages()
      const single = picked.length === 1 ? picked[0] : null
      openPopover(anchor, (menu) => {
        if (single) menu.append(menuItem(pinState.messageId === single.id ? 'Unpin' : 'Pin', false, () => {
          void pinMessage(pinState.messageId === single.id ? null : single.id)
          clearSelection()
        }))
        menu.append(menuItem('Save a copy', false, () => {
          closeCtxMenu()
          const path = single ? mediaPathOf(single) : null
          if (path) {
            void getSignedUrls(connectionId, [path]).then((urls) => {
              if (!urls[path]) throw new Error('File is not available.')
              const name = (single?.payload as { name?: string } | null)?.name ?? `message.${path.split('.').pop()}`
              return downloadFromUrl(urls[path], name)
            }).catch(() => showNotice('Could not save a copy. Try again.'))
          } else downloadFile('one-on-one-messages.txt', 'text/plain;charset=utf-8', selectionText())
          clearSelection()
        }))
        const report = menuItem('Report message', true, () => {
          if (!single) return
          clearSelection()
          openReportModal({ messageId: single.id })
        })
        report.disabled = !single || single.senderId === myUserId
        menu.append(report)
      })
    }
    root.querySelector<HTMLButtonElement>('#selection-more')!.addEventListener('click', (e) => openSelectionMenu(e.currentTarget as HTMLElement))
    const onEscape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || document.querySelector('.modal-overlay:not(.modal-overlay--closing)')) return
      if (linkTimer) clearTimeout(linkTimer)
      if (selectedIds.size) clearSelection()
      else if (editTarget) cancelEdit()
      else if (replyTarget) cancelReply()
      else closeSearch()
    }
    document.addEventListener('keydown', onEscape)
    overlays.add(() => {
      document.removeEventListener('keydown', onEscape)
      if (selectionExpiry) clearTimeout(selectionExpiry)
      unregisterSelectionBack?.()
    })

    // Function declaration: history builds rows before the gesture controls initialise.
    function addHoverActions(row: HTMLElement): void {
      if (row.querySelector('.chat__hover-actions')) return
      const actions = document.createElement('div')
      actions.className = 'chat__hover-actions'
      actions.setAttribute('role', 'toolbar')
      actions.setAttribute('aria-label', 'Message actions')
      for (const [label, icon, action] of [
        ['React', REACT_ICON, (id: string) => showQuickReactions(id)],
        ['Reply', REPLY_ICON, (id: string) => startReply(id)],
        ['More message options', MORE_ICON, (id: string) => { selectedIds.add(id); updateSelection(); openSelectionMenu(row.querySelector('.chat__message-body')!) }],
      ] as const) {
        const button = document.createElement('button')
        button.type = 'button'
        button.innerHTML = icon
        button.setAttribute('aria-label', label)
        button.title = label
        button.addEventListener('pointerdown', (e) => e.preventDefault())
        button.addEventListener('click', (e) => { e.stopPropagation(); if (row.dataset.id) action(row.dataset.id) })
        actions.append(button)
      }
      row.append(actions)
    }

    // Report a specific message or the other person. Both capture a category
    // (incl. child_safety, required by the Play Child Safety policy) and an
    // optional note; "Report & block" also ends the connection permanently.
    const REPORT_CATEGORIES: Array<{ value: string; label: string }> = [
      { value: 'harassment', label: 'Harassment or bullying' },
      { value: 'hate', label: 'Hate speech' },
      { value: 'sexual', label: 'Unwanted sexual content' },
      { value: 'child_safety', label: 'Child safety / sexual content involving a minor' },
      { value: 'spam', label: 'Spam' },
      { value: 'other', label: 'Something else' },
    ]

    const openReportModal = (target: { messageId: string } | { person: true }): void => {
      const isMessage = 'messageId' in target
      const box = document.createElement('div')
      box.className = 'notice-popup'

      const heading = document.createElement('div')
      heading.className = 'report-dialog__title'
      heading.textContent = isMessage ? 'Report this message?' : `Report ${otherName.toLowerCase()}?`

      const explain = document.createElement('div')
      explain.className = 'report-dialog__text'
      explain.textContent = "We'll review it. Blocking also ends this conversation for good."

      const category = document.createElement('select')
      category.className = 'report-dialog__reason'
      for (const c of REPORT_CATEGORIES) {
        const opt = document.createElement('option')
        opt.value = c.value
        opt.textContent = c.label
        category.append(opt)
      }

      const reason = document.createElement('textarea')
      reason.className = 'report-dialog__reason'
      reason.rows = 3
      reason.placeholder = 'Add a note (optional)'

      const actions = document.createElement('div')
      actions.className = 'report-dialog__actions'
      const cancelBtn = document.createElement('button')
      cancelBtn.type = 'button'
      cancelBtn.textContent = 'Cancel'
      const reportBtn = document.createElement('button')
      reportBtn.type = 'button'
      reportBtn.textContent = 'Report'
      const blockBtn = document.createElement('button')
      blockBtn.type = 'button'
      blockBtn.className = 'danger'
      blockBtn.textContent = 'Report & block'
      actions.append(cancelBtn, reportBtn, blockBtn)

      box.append(heading, explain, category, reason, actions)
      const dispose = (): void => modal.close()
      const modal = openModal(box, { onClose: () => overlays.delete(dispose) })
      overlays.add(dispose)

      const sendReport = (): Promise<void> => {
        const input = { category: category.value, reason: reason.value.trim() }
        return isMessage
          ? reportMessage(target.messageId, input)
          : reportConnectionUser(connectionId, input)
      }

      cancelBtn.addEventListener('click', () => modal.close())
      reportBtn.addEventListener('click', () => {
        reportBtn.disabled = true
        blockBtn.disabled = true
        void sendReport()
          .then(() => {
            modal.close()
            showNotice('Thanks — this has been reported.')
          })
          .catch(() => {
            reportBtn.disabled = false
            blockBtn.disabled = false
            showNotice('Could not send the report — try again.')
          })
      })
      blockBtn.addEventListener('click', () => {
        reportBtn.disabled = true
        blockBtn.disabled = true
        void sendReport()
          .catch(() => {}) // a failed report shouldn't stop the block
          .then(() => blockAndEnd(connectionId))
          .then(() => {
            modal.close()
            go('connection-id')
          })
          .catch(() => {
            reportBtn.disabled = false
            blockBtn.disabled = false
            showNotice('Could not block — try again.')
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
    let swipeFrame = 0
    let swipeDistance = 0
    let swipeIconTop = 0
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
        if (!row?.dataset.id || row.dataset.type === 'call' || row.dataset.deleted || e.touches.length !== 1) return
        cancelLongPress()
        swipeRow = row
        swipeStartX = e.touches[0].clientX
        swipeStartY = e.touches[0].clientY
        swiping = false
        swipeDistance = 0
        const rowRect = row.getBoundingClientRect()
        const logRect = log.getBoundingClientRect()
        swipeIconTop = rowRect.top - logRect.top + log.scrollTop + rowRect.height / 2 - 8
        const id = row.dataset.id
        const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-message-link]')
        longPressTimer = setTimeout(() => {
          longPressTimer = null
          swipeRow = null // cancel any in-progress reply-swipe tracking
          suppressClickUntil = Date.now() + 600 // eat the trailing touchend->click
          lastMenuFor = id
          if (link) copyText(link.href.startsWith('tel:') ? link.textContent ?? link.href.slice(4) : link.href)
          else selectMessage(id)
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
          if (selectedIds.size) { swipeRow = null; return }
          swiping = true
          swipeRow.style.transition = 'none'
        }
        // Axis committed horizontal — block native scroll for the rest of this
        // gesture so a diagonal swipe can't scroll the page and reply at once.
        // Needs { passive: false } on this listener to have any effect; the
        // touch-action: pan-y on .chat__log keeps vertical scroll native/smooth
        // for gestures that never reach here.
        e.preventDefault()
        swipeDistance = Math.max(0, Math.min(dx, SWIPE_MAX))
        if (!swipeFrame) swipeFrame = requestAnimationFrame(() => {
          swipeFrame = 0
          if (!swipeRow || disposed) return
          swipeRow.style.transform = `translateX(${swipeDistance}px)`
          const ready = swipeDistance >= SWIPE_TRIGGER
          swipeRow.classList.toggle('chat__message--swipe-ready', ready)
          const icon = ensureSwipeIcon()
          icon.style.top = `${swipeIconTop}px`
          icon.style.opacity = String(Math.min(swipeDistance / SWIPE_TRIGGER, 1))
          icon.classList.toggle('chat__swipe-icon--ready', ready)
        })
      },
      { passive: false },
    )

    const finishSwipe = (reply: boolean): void => {
      cancelLongPress()
      cancelAnimationFrame(swipeFrame)
      swipeFrame = 0
      if (!swipeRow) return
      const triggered = reply && swipeDistance >= SWIPE_TRIGGER
      const id = swipeRow.dataset.id!
      swipeRow.style.transition = ''
      swipeRow.style.transform = ''
      swipeRow.classList.remove('chat__message--swipe-ready')
      swipeIcon?.remove()
      swipeIcon = null
      swipeRow = null
      if (triggered) { suppressClickUntil = Date.now() + 450; startReply(id) }
    }
    log.addEventListener('touchend', () => finishSwipe(true))
    log.addEventListener('touchcancel', () => finishSwipe(false))
    overlays.add(() => finishSwipe(false))

    log.addEventListener('contextmenu', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.chat__message')
      if (!row?.dataset.id || row.dataset.type === 'call' || row.dataset.deleted) return
      e.preventDefault()
      const id = row.dataset.id
      // The long-press timer already opened this menu on touch — don't rebuild.
      if (Date.now() < suppressClickUntil && lastMenuFor === id) return
      // Anchor to the bubble, not the cursor (e.clientX/Y), so the menu opens
      // in the same place relative to the message every time — not shifted
      // left/right depending on where inside it you happened to right-click.
      cancelLongPress()
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-message-link]')
      if (link) copyText(link.href.startsWith('tel:') ? link.textContent ?? link.href.slice(4) : link.href)
      else selectMessage(id)
    })

    // Mouse hold follows the same selection/copy rules as touch long press.
    let holdStartX = 0
    let holdStartY = 0
    log.addEventListener('pointerdown', (e) => {
      if (document.activeElement === input && (e.target as HTMLElement).closest('.chat__message-body')) e.preventDefault()
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      const row = (e.target as HTMLElement).closest<HTMLElement>('.chat__message')
      if (!row?.dataset.id || row.dataset.deleted || row.dataset.type === 'call' || (e.target as HTMLElement).closest('.chat__hover-actions, .chat__reaction-badge')) return
      holdStartX = e.clientX
      holdStartY = e.clientY
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-message-link]')
      cancelLongPress()
      longPressTimer = setTimeout(() => {
        suppressClickUntil = Date.now() + 600
        if (link) copyText(link.href.startsWith('tel:') ? link.textContent ?? link.href.slice(4) : link.href)
        else selectMessage(row.dataset.id!)
      }, LONG_PRESS_MS)
    })
    log.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && (Math.abs(e.clientX - holdStartX) > 10 || Math.abs(e.clientY - holdStartY) > 10)) cancelLongPress() })
    document.addEventListener('pointerup', cancelLongPress)
    log.addEventListener('pointerleave', cancelLongPress)
    let lastTapId = ''
    let lastTapAt = 0
    let linkTimer: ReturnType<typeof setTimeout> | null = null
    let forwardingClick = false
    log.addEventListener('click', (e) => {
      if (forwardingClick) return
      const target = e.target as HTMLElement
      const row = target.closest<HTMLElement>('.chat__message')
      if (!row?.dataset.id || row.dataset.deleted || row.dataset.type === 'call' || target.closest('.chat__hover-actions, .chat__reaction-badge')) return
      const id = row.dataset.id
      if (selectedIds.size) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (selectedIds.has(id)) selectedIds.delete(id)
        else selectedIds.add(id)
        closeCtxMenu()
        updateSelection()
        return
      }
      if (e.detail && lastTapId === id && Date.now() - lastTapAt < 320) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (linkTimer) clearTimeout(linkTimer)
        lastTapAt = 0
        showQuickReactions(id)
        return
      }
      lastTapId = id
      if (!e.detail) return
      lastTapAt = Date.now()
      const link = target.closest<HTMLAnchorElement>('a[data-message-link]')
      // Wait for a second tap before opening a card, link, quote or timestamp.
      e.preventDefault()
      e.stopImmediatePropagation()
      if (linkTimer) clearTimeout(linkTimer)
      linkTimer = setTimeout(() => {
        if (disposed || !target.isConnected) return
        if (link) {
          if (link.href.startsWith('tel:')) location.assign(link.href)
          else if (safeWebUrl(link.href)) window.open(link.href, '_blank', 'noopener,noreferrer')
        } else {
          forwardingClick = true
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
          forwardingClick = false
        }
      }, 320)
    }, { capture: true })
    log.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.chat__message')
      if (!row?.dataset.id || row.dataset.deleted || row.dataset.type === 'call' || selectedIds.size) return
      e.preventDefault()
      if (linkTimer) clearTimeout(linkTimer)
      if (!ctxMenu) showQuickReactions(row.dataset.id)
    })
    log.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return
      if (e.target !== (e.target as HTMLElement).closest('.chat__message')) return
      const row = e.target as HTMLElement
      if (row.dataset.id && !row.dataset.deleted) { e.preventDefault(); selectMessage(row.dataset.id) }
    })
    overlays.add(() => { cancelLongPress(); if (linkTimer) clearTimeout(linkTimer); document.removeEventListener('pointerup', cancelLongPress) })

    const onMessageUpdate = (message: IncomingMessage): void => {
      if (disposed) return
      const previous = messagesById.get(message.id)
      if (previous?.deletedAt && !message.deletedAt) return
      if (previous?.editedAt && !message.deletedAt && (!message.editedAt || Date.parse(previous.editedAt) > Date.parse(message.editedAt))) return
      messagesById.set(message.id, message)
      const oldRow = rowsById.get(message.id)
      if (oldRow) {
        const atBottom = stickToBottom
        const row = buildMessageRow(message, false)
        const ownIndex = myRows.indexOf(oldRow)
        if (ownIndex !== -1) myRows.splice(ownIndex, 1)
        oldRow.replaceWith(row)
        if (message.deletedAt && !previous?.deletedAt && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) row.animate([{ opacity: .1 }, { opacity: 1 }], { duration: 200 })
        registerMessageRow(message, row)
        updateGroup(row)
        updateGroup(row.nextElementSibling)
        if (atBottom) log.scrollTop = log.scrollHeight
      }
      for (const quote of log.querySelectorAll<HTMLElement>('.chat__quote')) {
        if (quote.dataset.replyTo === message.id) quote.querySelector('.chat__quote-snippet')!.textContent = snippetOf(message)
      }
      if (message.deletedAt) {
        reactionsByMessage.delete(message.id)
        selectedIds.delete(message.id)
        closeCtxMenu()
        if (replyTarget?.id === message.id) cancelReply()
        if (editTarget?.id === message.id) cancelEdit()
      } else if (replyTarget?.id === message.id) { replyTarget = message; renderReplyBar() }
      updateSelection()
      renderPin()
      if (searchInput.value.trim()) runSearch(searchInput.value)
    }

    // --- Incoming ----------------------------------------------------------
    const onIncoming = (message: IncomingMessage): void => {
      if (disposed) return
      if (message.senderId !== myUserId) setOtherTyping(false)
      // A send already reconciled (via the ack or an earlier echo) — drop the repeat.
      if (message.tempId && resolvedTempIds.has(message.tempId)) return
      // Reconcile our own optimistic row by the client tempId echoed back —
      // never by content (server may normalise it) which duplicated rows.
      if (message.senderId === myUserId && message.tempId) {
        const idx = pending.findIndex((p) => p.tempId === message.tempId)
        if (idx >= 0) {
          const [entry] = pending.splice(idx, 1)
          resolvedTempIds.add(message.tempId)
          noteServerTime(message.createdAt)
          entry.row.classList.remove('chat__message--pending', 'chat__message--failed')
          entry.row.querySelector('.chat__discard')?.remove()
          const oldAt = entry.row.dataset.at
          entry.row.dataset.at = message.createdAt
          relocateIfDayChanged(entry.row, oldAt, message.createdAt)
          entry.row.dataset.id = message.id
          rowsById.set(message.id, entry.row) // index the existing DOM row; reconciliation is unchanged
          if (message.type === 'alarm' && !(message.payload as { ack?: string } | null)?.ack) {
            alarmController?.setId(message.id) // own raise: later ack/cancel/silence can now target it
            // The raise card was disabled as "sending…" — now it has an id, enable it.
            const raiseCard = entry.row.querySelector<HTMLButtonElement>('.alarm-card--raise')
            if (raiseCard) {
              const acked = ackedRaises.get(message.id)
              raiseCard.disabled = acked !== undefined
              const raiseHint = raiseCard.querySelector('.alarm-card__hint')
              if (raiseHint) raiseHint.textContent = acked === undefined ? 'tap to cancel' : acked ? 'cancelled' : 'acknowledged'
            }
          }
          entry.row.dataset.delivered = '1'
          messagesById.set(message.id, message)
          if (message.type !== 'call' && message.type !== 'system') {
            addHoverActions(entry.row)
            entry.row.tabIndex = 0
          }
          applyReceipt(entry.row)
          return
        }
      }
      // Dedup: a reconnect can re-deliver recent message:new events.
      if (message.id && messagesById.has(message.id)) return
      noteServerTime(message.createdAt)

      if (message.type === 'alarm') {
        const alarmPayload = message.payload as { ack?: string; cancelled?: boolean } | null
        if (alarmPayload?.ack) {
          markRaiseAcked(alarmPayload.ack, alarmPayload.cancelled === true)
          // An ack for a different alarm than the live one must not silence it.
          const live = alarmController?.currentId()
          if (!live || live === alarmPayload.ack) {
            alarmController?.stopAll(alarmPayload.ack)
            setAlarmGlow(false)
          }
        } else if (message.senderId !== myUserId && Date.now() - Date.parse(message.createdAt) < ALARM_AUTO_CLEAR_MS) {
          incomingAlarmId = message.id
          setAlarmGlow(true)
          // Hidden/backgrounded or native already ringing: native owns the sound,
          // so this layer shows the glow only (never two rings).
          const raiseId = message.id
          const hidden = document.visibilityState === 'hidden'
          void getNativeAlarmState().then((native) => {
            if (disposed || isAlarmSilenced(raiseId) || ackedRaises.has(raiseId)) return
            alarmController?.start({ silent: hidden || native.ringing, alarmId: raiseId, remainingMs: ALARM_AUTO_CLEAR_MS - (Date.now() - Date.parse(message.createdAt)) })
          })
        }
      }

      // Apply the other side's appearance change immediately rather than
      // waiting for the next poll tick (poll sync above remains the fallback
      // for anything missed, same as leave/wallpaper already do).
      if (message.type === 'system') {
        const p = (message.payload ?? {}) as { event?: string; value?: string }
        if (p.event === 'wallpaper' && typeof p.value === 'string') {
          currentWallpaper = p.value
          applyAppearance(chatEl, currentWallpaper, currentStyle)
        } else if (p.event === 'style' && typeof p.value === 'string') {
          currentStyle = p.value
          applyAppearance(chatEl, currentWallpaper, currentStyle)
        }
      }

      appendMessage(message, false, true)
      if (message.senderId !== myUserId) {
        markReadNow()
      }
    }

    // --- Connect (non-blocking: chat is already usable) --------------------
    let connecting = false
    // After a reconnect: resend anything unacked FIRST (the server dedupes by
    // tempId and the ack reconciles the optimistic row), then fetch everything
    // newer than our newest server message and merge by id.
    let resyncing = false
    const resyncAfterReconnect = async (): Promise<void> => {
      if (resyncing || disposed) return
      resyncing = true
      try {
        await flushPending()
        let cursor = newestServerAt
        // Include the editable window from BEFORE disconnect, even after a large backlog.
        const refreshSince = (cursor ? Date.parse(cursor) : Date.now()) - EDIT_WINDOW_MS
        let before: string | undefined
        while (!disposed) {
          const recent = await getMessages(connectionId, before)
          if (disposed) return
          for (const message of recent) {
            if (rowsById.has(message.id)) onMessageUpdate(message)
            else if (!cursor || message.createdAt > cursor) onIncoming(message)
          }
          const nextBefore = recent[0]?.createdAt
          if (recent.length < HISTORY_PAGE || !nextBefore || nextBefore === before || Date.parse(nextBefore) <= refreshSince) break
          before = nextBefore
        }
        for (let pass = 0; pass < 10 && !disposed; pass++) {
          const batch = (await getMessages(connectionId, undefined, cursor ?? undefined))
            .slice()
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          for (const m of batch) {
            if (!messagesById.has(m.id)) onIncoming(m as IncomingMessage)
            if (!cursor || Date.parse(m.createdAt) > Date.parse(cursor)) cursor = m.createdAt
          }
          if (!cursor || batch.length < HISTORY_PAGE) break
        }
      } catch (err) {
        console.warn('resync after reconnect failed', err)
      } finally {
        resyncing = false
      }
    }
    const attachTransport = (t: Transport): void => {
      transport = t
      unsubscribe = t.onMessage(onIncoming)
      unsubscribeReactions = t.onReaction(applyReactionUpdate)
      overlays.add(t.onMessageUpdate(onMessageUpdate))
      overlays.add(t.onPin(applyPin))
      overlays.add(t.onTyping((update) => { if (!disposed && update.userId !== myUserId) setOtherTyping(update.typing) }))
      overlays.add(t.onPresence((update) => {
        if (disposed || update.userId === myUserId) return
        livePresence = update
        if (!update.online) setOtherTyping(false)
        updatePresence(otherLastRead)
      }))
      unsubscribeEnded = t.onConnectionEnded(() => {
        if (!disposed) go('connection-id')
      })
      setConnState(t.getState())
      t.onStateChange((state, reconnected) => {
        if (disposed) return
        setConnState(state)
        if (state !== 'connected') { livePresence = null; setOtherTyping(false); typingSent = false; lastTypingSent = 0 }
        else { sendDraftTyping(); syncPresence() }
        if (state === 'connected' && reconnected) void resyncAfterReconnect()
      })
      // Receipts pushed over the socket flip ticks/presence instantly; the 4s
      // poll below stays as the fallback.
      t.onReceipt((u) => {
        if (disposed || u.userId === myUserId) return
        if (u.lastReadAt && (!otherLastRead || Date.parse(u.lastReadAt) > Date.parse(otherLastRead))) {
          otherLastRead = u.lastReadAt
          updatePresence(u.lastReadAt)
        }
        if (u.lastDeliveredAt && (!otherLastDelivered || Date.parse(u.lastDeliveredAt) > Date.parse(otherLastDelivered))) {
          otherLastDelivered = u.lastDeliveredAt
        }
        refreshReceipts()
      })
      void flushPending()
      syncPresence()
      markReadNow()
      // Mount once — ensureConnected can call attachTransport again on a
      // later successful reconnect after an earlier attempt failed.
      if (!callBar) { callBar = mountCallBar(nav, getCallTransport(), otherName); callBar.setPhoto(peerPhoto) }
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
        setConnState(navigator.onLine === false ? 'offline' : 'connecting')
      } finally {
        connecting = false
      }
    }
    void ensureConnected()

    // An emergency alarm's sound/vibration run until the recipient actually
    // taps Acknowledge (or the 2min no-ack auto-clear) — opening or focusing
    // the chat no longer silences it, so a raise can't be missed by glancing
    // at the tab.
    const syncPresence = (): void => {
      transport?.sendPresence(!disposed && document.visibilityState === 'visible' && document.hasFocus())
    }
    const blurHandler = (): void => transport?.sendPresence(false)
    document.addEventListener('visibilitychange', syncPresence)
    window.addEventListener('blur', blurHandler)
    overlays.add(() => {
      document.removeEventListener('visibilitychange', syncPresence)
      window.removeEventListener('blur', blurHandler)
    })
    focusHandler = () => {
      syncPresence()
      markReadNow()
      // Back in the app while native is ringing: never let this layer ring too.
      void getNativeAlarmState().then((native) => {
        if (native.ringing) alarmController?.silenceLocal()
      })
    }
    window.addEventListener('focus', focusHandler)

    // --- Poll: leave state, termination, seen, reconnect ------------------
    const MARK_HEARTBEAT_MS = 10_000
    const poll = async (): Promise<void> => {
      void ensureConnected() // recover a failed initial transport
      if (transport && pending.some((p) => !p.sent)) void flushPending() // retry stuck sends

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
      const nextAvatarIds = `${next.myAvatarId}:${next.otherAvatarId}`
      if (nextAvatarIds !== avatarIds || Date.now() - avatarsLoadedAt > 55 * 60_000) { avatarIds = nextAvatarIds; void loadPhotos().catch(() => {}) }
      renderBanner(next)
      if (Date.now() - lastPinEvent >= 10_000) {
        pinState = { messageId: next.pinnedMessageId ?? null, pinnedBy: next.pinnedBy ?? null, pinnedAt: next.pinnedAt ?? null }
        renderPin()
      }
      otherLastRead = next.otherLastReadAt
      otherLastDelivered = next.otherLastDeliveredAt
      refreshReceipts()
      updatePresence(next.otherLastReadAt)
      if (next.wallpaper !== currentWallpaper || next.messageStyle !== currentStyle) {
        currentWallpaper = next.wallpaper
        currentStyle = next.messageStyle
        applyAppearance(chatEl, currentWallpaper, currentStyle)
      }
      // Keep marking read while the chat is actually on screen — makes the
      // other side's "seen" tick reliable even if a discrete event was missed.
      // Only a presence heartbeat now (the other side's "in chat" window is
      // 15s): new messages and focus already mark read immediately, and the
      // receipt:update event delivers the result without waiting for a poll.
      if (document.visibilityState === 'visible' && Date.now() - lastMarkAt > MARK_HEARTBEAT_MS) {
        markReadNow()
      }
    }

    // Self-scheduling so a slow tick can't stack overlapping polls.
    const schedulePoll = (): void => {
      if (disposed) return
      pollTimer = setTimeout(() => {
        void poll().finally(schedulePoll)
      }, 4000)
    }
    if (!disposed) schedulePoll()

    // A gentle in-app reminder precedes the browser's permission prompt.
    const notificationReminder = async (): Promise<void> => {
      if (!isPushSupported() || await isPushSubscribed() || disposed) return
      let lastAsked = 0
      try { lastAsked = Number(localStorage.getItem('notificationReminderAt')) } catch { /* private mode */ }
      if (!notificationReminderDue(lastAsked)) return
      try { localStorage.setItem('notificationReminderAt', String(Date.now())) } catch { /* private mode */ }
      const box = document.createElement('div')
      box.className = 'notice-popup'
      box.innerHTML = '<h2>Turn on notifications?</h2><p>Get a gentle heads-up when a message arrives while the chat is closed.</p><div class="report-dialog__actions"><button type="button" data-later>Not now</button><button type="button" class="primary" data-enable>Turn on</button></div>'
      const dispose = (): void => modal.close()
      const modal = openModal(box, { onClose: () => overlays.delete(dispose) })
      modal.panel.setAttribute('aria-label', 'Turn on notifications?')
      overlays.add(dispose)
      box.querySelector('[data-later]')!.addEventListener('click', modal.close)
      box.querySelector('[data-enable]')!.addEventListener('click', () => { modal.close(); void toggleNotifications() })
    }
    if (!current.otherNickname) {
      const box = document.createElement('form')
      box.className = 'notice-popup'
      box.innerHTML = '<h2>What would you like to call this person?</h2><input aria-label="Nickname" placeholder="Type a nickname" maxlength="40" required/><div class="report-dialog__actions"><button type="button" data-later>Later</button><button type="submit" class="primary">Save</button></div>'
      const dispose = (): void => modal.close()
      const modal = openModal(box, { onClose: () => { overlays.delete(dispose); if (!disposed) void notificationReminder() } })
      modal.panel.setAttribute('aria-label', 'Choose a nickname')
      overlays.add(dispose)
      box.querySelector('[data-later]')!.addEventListener('click', modal.close)
      box.addEventListener('submit', async (e) => {
        e.preventDefault()
        const name = box.querySelector<HTMLInputElement>('input')!.value.trim()
        if (!name) return
        const save = box.querySelector<HTMLButtonElement>('[type="submit"]')!
        save.disabled = true
        try { await setNickname(connectionId, name); if (!disposed) go('chat') }
        catch (err) { save.disabled = false; showNotice(err instanceof Error ? err.message : 'Could not save nickname.') }
      })
    } else void notificationReminder()
  })().catch(() => {
    if (!disposed) go('connection-id')
  })

  return cleanup
}

function renderChat(root: HTMLElement, displayName: string): void {
  root.innerHTML = `
    <div class="chat">
      <div class="chat__nav">
        <div class="chat__nav-peer">
          <span class="chat__avatar" id="nav-avatar" aria-hidden="true"></span>
          <div class="chat__nav-info">
          <div class="chat__nav-title" id="nav-title"></div>
          <div class="chat__nav-status chat__nav-status--connecting" id="nav-status">connecting…</div>
          </div>
        </div>
        <div class="chat__nav-actions" id="nav-actions">
          <button type="button" class="chat__call-btn" id="video-btn" aria-label="Start video call" disabled>${CALL_VIDEO_ICON}</button>
          <button type="button" class="chat__call-btn" id="call-btn" aria-label="Start audio call" disabled>${CALL_PHONE_ICON}</button>
          <button type="button" class="chat__menu-btn" id="menu-btn" aria-label="More options"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
        </div>
        <div class="chat__selection" id="selection-bar" role="toolbar" aria-label="Selected message actions" aria-hidden="true" inert>
          <button type="button" id="selection-close" aria-label="Clear selection">${CLOSE_ICON}</button>
          <span id="selection-count" aria-live="polite">0</span>
          <button type="button" id="selection-reply" aria-label="Reply" title="Reply">${REPLY_ICON}</button>
          <button type="button" id="selection-edit" aria-label="Edit" title="Edit">${EDIT_ICON}</button>
          <button type="button" id="selection-copy" aria-label="Copy" title="Copy">${COPY_ICON}</button>
          <button type="button" id="selection-delete" aria-label="Delete for everyone" title="Delete for everyone">${DELETE_ICON}</button>
          <button type="button" id="selection-more" aria-label="More selected message options">${MORE_ICON}</button>
        </div>
      </div>
      <div class="chat__strip" id="pin-banner" aria-hidden="true" inert><div class="chat__pin-banner">
        <button type="button" class="chat__pin-open" id="pin-open" aria-label="Go to pinned message">${PIN_ICON}<span><strong id="pin-author"></strong><span id="pin-snippet"></span></span></button>
        <button type="button" class="chat__strip-close" id="pin-unpin" aria-label="Unpin">${CLOSE_ICON}</button>
      </div></div>
      <div class="chat__strip" id="alarm-banner" aria-hidden="true" inert><div class="chat__alarm-banner" role="alert">
        ${ALARM_ICON}<span id="alarm-banner-label"></span><span aria-hidden="true">·</span><button type="button" id="alarm-acknowledge">Acknowledge</button>
      </div></div>
      <div class="chat__strip" id="chat-search" aria-hidden="true" inert><div class="chat__search">
        <input id="search-input" aria-label="Search messages" placeholder="Search messages…" autocomplete="off" />
        <span class="chat__search-count" id="search-count">0/0</span>
        <button type="button" class="chat__search-nav" id="search-prev" aria-label="Older match" title="Older match"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></button>
        <button type="button" class="chat__search-nav" id="search-next" aria-label="Newer match" title="Newer match"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
        <button type="button" class="chat__search-close" id="search-close" aria-label="Close search">${CLOSE_ICON}</button>
      </div></div>
      <div class="chat__strip" id="leave-strip" aria-hidden="true" inert><div class="chat__leave-banner" id="leave-banner"></div></div>
      <div class="chat__log" id="chat-log">
        <div class="chat__enc-note chat__system-line">
          <svg class="chat__enc-note-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          <span>Messages are encrypted</span>
        </div>
      </div>
      <div class="chat__composer-area">
      <div class="chat__strip chat__reply-bar" id="reply-bar" aria-hidden="true" inert><div class="chat__reply-bar-content">
        <div class="chat__reply-bar-info">
          <div class="chat__reply-bar-name" id="reply-bar-name"></div>
          <div class="chat__reply-bar-snippet" id="reply-bar-snippet"></div>
        </div>
        <button type="button" class="chat__reply-bar-cancel" id="reply-bar-cancel" aria-label="Cancel reply">${CLOSE_ICON}</button>
      </div></div>
      <div class="chat__strip chat__reply-bar" id="edit-bar" aria-hidden="true" inert><div class="chat__reply-bar-content">
        <div class="chat__reply-bar-info"><div class="chat__reply-bar-name">Edit message</div><div class="chat__reply-bar-snippet" id="edit-bar-snippet"></div></div>
        <button type="button" class="chat__reply-bar-cancel" id="edit-bar-cancel" aria-label="Cancel edit">${CLOSE_ICON}</button>
      </div></div>
      <form class="chat__input-bar" id="composer">
        <div class="chat__input-pill">
        <button type="button" class="chat__icon-btn" id="sticker-btn" title="Stickers and GIFs" aria-label="Stickers and GIFs">${STICKER_ICON}</button>
        <textarea id="message-input" aria-label="Message" placeholder="Message" maxlength="4000" autocomplete="off" enterkeyhint="send" rows="1"></textarea>
        <div class="chat__recording-bar" id="recording-bar" aria-hidden="true" inert>
          <span class="chat__recording-dot"></span>
          <span class="chat__recording-time" id="recording-time">0:00</span>
          <button type="button" class="chat__recording-cancel" id="recording-cancel">Cancel</button>
        </div>
        <button type="button" class="chat__icon-btn" id="attach-btn" title="Attach" aria-label="Attach"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5L13 2a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l8-8"/></svg></button>
        <button type="button" class="chat__icon-btn" id="camera-btn" title="Camera" aria-label="Camera">${CAMERA_ICON}</button>
        </div>
        <button type="button" class="chat__icon-btn" id="mic-btn"></button>
        <button class="primary chat__send-btn" id="send-btn" type="submit" aria-label="Send"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg></button>
        <input type="file" id="camera-input" accept="image/jpeg,image/png,image/webp" capture="environment" hidden />
        <input type="file" id="attach-image-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
        <input type="file" id="attach-file-input" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" hidden />
      </form>
      </div>
    </div>
  `

  // An unpadded grid child lets hidden strips fold fully to zero height.
  for (const strip of root.querySelectorAll<HTMLElement>('.chat__strip')) {
    const inner = document.createElement('div')
    inner.className = 'chat__strip-inner'
    inner.append(...strip.childNodes)
    strip.append(inner)
  }
  root.querySelector<HTMLDivElement>('#nav-title')!.textContent = displayName
  root.querySelector<HTMLElement>('#nav-avatar')!.textContent = Array.from(displayName.trim())[0]?.toUpperCase() ?? '?'
}
