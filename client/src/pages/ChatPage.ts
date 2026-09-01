import type { Page } from '../state/router'
import {
  formatClock,
  formatDateSeparator,
  formatDuration,
  formatFullTimestamp,
  formatMessageTime,
  isSameDay,
} from '../utils/formatTime'
import { downloadFromUrl, formatFileSize } from '../utils/download'
import { mountMenuDropdown } from '../components/MenuDropdown'
import { openModal } from '../components/Modal'
import { showToast } from '../components/Toast'
import { applyAppearance, closeAppearance, openAppearance } from '../features/appearancePreview'
import { openLetter, openLetterComposer, type LetterPayload } from '../features/letters'
import { formatCountdown, openCountdownComposer, type CountdownPayload } from '../features/countdown'
import { moodEmoji, openCheckinComposer, type CheckinPayload } from '../features/checkin'
import { openAskAnswerModal, openAskComposer, type AskPayload } from '../features/ask'
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
import {
  connectMessaging,
  type IncomingMessage,
  type MessageType,
  type ReactionUpdate,
  type Transport,
} from '../services/messageService'
import { getSignedUrls, uploadAttachment } from '../services/attachmentsApi'
import { startRecording, type VoiceRecorderHandle } from '../features/voiceRecorder'
import { linkifyInto } from '../utils/linkify'
import { animateOutAndRemove } from '../utils/animateOut'
import { signOut } from '../services/authService'

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

// payload shapes for the three attachment message types (validated
// server-side in messageService.validateMediaPayload; read defensively here).
interface ImagePayload {
  path: string
  mime: string
  size: number
  width: number
  height: number
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
    // Transient status feedback (no decision required) — a toast, not a
    // modal, so it doesn't block the chat or need a body-level overlay
    // tracked for navigation cleanup.
    const showNotice = (message: string): void => {
      showToast(message)
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
      () => void signOut().then(() => location.assign('/')),
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

    // Instagram-DM style: a small badge overlapping the bubble's bottom
    // corner (not inline with the message content). One reaction per user
    // per message, so a 1:1 chat needs at most two emoji here (me + other).
    const renderReactionChips = (messageId: string): void => {
      const row = log.querySelector<HTMLElement>(`[data-id="${cssEsc(messageId)}"]`)
      const body = row?.querySelector<HTMLElement>('.chat__message-body')
      if (!body) return
      const list = reactionsByMessage.get(messageId) ?? []
      let badge = body.querySelector<HTMLElement>('.chat__reaction-badge')
      if (!list.length) {
        badge?.remove()
        return
      }
      if (!badge) {
        badge = document.createElement('div')
        badge.className = 'chat__reaction-badge'
        body.append(badge)
      }
      badge.innerHTML = ''
      for (const r of list) {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'chat__reaction-chip' + (r.userIds.includes(myUserId) ? ' chat__reaction-chip--mine' : '')
        chip.textContent = r.emoji
        chip.addEventListener('click', (e) => {
          e.stopPropagation()
          if (r.userIds.includes(myUserId)) toggleReaction(messageId, r.emoji)
        })
        badge.append(chip)
      }
    }

    // One reaction per user per message: adding an emoji replaces whatever
    // this user had on the message before (across all emoji), locally and
    // for every client — the server enforces the same via a unique
    // (message_id, user_id) upsert, so a single 'add' broadcast is enough.
    const applyReactionUpdate = (update: ReactionUpdate): void => {
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
      const list = reactionsByMessage.get(messageId) ?? []
      const mine = list.find((r) => r.userIds.includes(myUserId))
      const prevEmoji = mine?.emoji ?? null // one-per-user: at most one entry can include me
      const alreadyReacted = prevEmoji === emoji
      const op = alreadyReacted ? 'remove' : 'add'
      applyReactionUpdate({ messageId, emoji, userId: myUserId, op }) // optimistic; server echo reconciles
      transport?.sendReaction(messageId, emoji, op).catch(() => {
        // Revert to exactly what I had before — a plain inverse toggle isn't
        // enough for 'add', since applying it may have replaced a *different*
        // prior emoji of mine (one-per-user), not just added a fresh one.
        applyReactionUpdate({ messageId, emoji, userId: myUserId, op: 'remove' })
        if (prevEmoji) applyReactionUpdate({ messageId, emoji: prevEmoji, userId: myUserId, op: 'add' })
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
      snippet.textContent = original ? (mediaLabel(original.type) ?? original.content) : 'Original message'
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

    // A countdown renders as a live-ticking card; no separate viewer to open —
    // the card itself is always live, ticking down for as long as it's on
    // screen. The interval self-clears the first time it finds the card
    // detached (e.g. after navigating away), rather than needing page-level
    // teardown tracking.
    const countdownCard = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as Partial<CountdownPayload>
      const card = document.createElement('div')
      card.className = 'countdown-card'
      const icon = document.createElement('span')
      icon.className = 'countdown-card__icon'
      icon.textContent = '⏳'
      const info = document.createElement('span')
      info.className = 'countdown-card__info'
      const label = document.createElement('span')
      label.className = 'countdown-card__label'
      label.textContent = p.label ?? message.content
      const ticker = document.createElement('span')
      ticker.className = 'countdown-card__ticker'
      info.append(label, ticker)
      card.append(icon, info)

      const targetIso = p.targetIso
      if (targetIso) {
        ticker.textContent = formatCountdown(targetIso)
        const timer = setInterval(() => {
          if (!card.isConnected) {
            clearInterval(timer)
            return
          }
          ticker.textContent = formatCountdown(targetIso)
        }, 1000)
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
        icon.textContent = '💌'
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
      icon.textContent = '🔒'
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

      const img = document.createElement('img')
      img.className = 'image-bubble__img'
      img.alt = 'Photo'
      img.loading = 'lazy'
      if (p.width && p.height) img.style.aspectRatio = `${p.width} / ${p.height}`
      wrap.append(img)

      if (message.content) {
        const caption = document.createElement('div')
        caption.className = 'image-bubble__caption'
        linkifyInto(caption, message.content)
        wrap.append(caption)
      }

      const path = p.path
      const ext = path?.split('.').pop() ?? 'jpg'
      let resolvedUrl = ''
      if (path) {
        hydrateMedia(path, (url) => {
          resolvedUrl = url
          img.src = url
        })
      }

      img.addEventListener('click', (e) => {
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

      const playBtn = document.createElement('button')
      playBtn.type = 'button'
      playBtn.className = 'voice-bubble__play'
      playBtn.textContent = '▶'
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
        playBtn.textContent = '▶'
        progress.style.width = '0%'
        time.textContent = formatDuration(duration)
      })
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (!ready) return
        if (audio.paused) {
          void audio.play()
          playBtn.textContent = '⏸'
        } else {
          audio.pause()
          playBtn.textContent = '▶'
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

    const FILE_ICONS: Record<string, string> = {
      pdf: '📄',
      doc: '📄',
      docx: '📄',
      txt: '📄',
      csv: '📊',
      xls: '📊',
      xlsx: '📊',
      ppt: '📑',
      pptx: '📑',
    }

    // A file renders as a card (icon + name + size); tap downloads it.
    const fileCard = (message: ChatMessage): HTMLElement => {
      const p = (message.payload ?? {}) as Partial<FilePayload>
      const name = p.name ?? 'File'
      const ext = name.split('.').pop()?.toLowerCase() ?? ''

      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'file-card'

      const icon = document.createElement('span')
      icon.className = 'file-card__icon'
      icon.textContent = FILE_ICONS[ext] ?? '📎'

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

    // Pure row build (no DOM insertion, no side effects) so both the forward
    // append and the "load older" prepend can share it.
    const buildMessageRow = (message: ChatMessage, pending: boolean): HTMLElement => {
      const at = new Date(message.createdAt)
      const isMine = message.senderId === myUserId
      const row = document.createElement('div')
      row.className = 'chat__message' + (pending ? ' chat__message--pending' : '')
      row.dataset.at = message.createdAt
      row.dataset.type = message.type // lets CSS give image/voice/file their own bubble treatment
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

      // Time + receipt render as one unit (WhatsApp-style): in line mode
      // `.chat__meta` is `display: contents`, so its children lay out exactly
      // as if appended to body directly (unchanged from before); in bubble
      // mode it becomes a single flex row pinned to the bubble's bottom-right.
      const meta = document.createElement('div')
      meta.className = 'chat__meta'

      const bubbleTime = document.createElement('div')
      bubbleTime.className = 'chat__bubble-time'
      bubbleTime.textContent = formatMessageTime(at)
      meta.append(bubbleTime)

      const content =
        message.type === 'letter'
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
                      : text

      body.append(sender)
      if (message.replyTo) body.append(quoteBlock(message.replyTo))
      body.append(content)
      if (isMine) {
        row.dataset.mine = '1' // keyed by the bubble-mode preview
        if (!pending) row.dataset.delivered = '1'
        const receipt = document.createElement('span')
        receipt.className = 'chat__receipt'
        // WhatsApp-shaped tick glyph (line mode ignores this and renders its
        // own dot via .chat__receipt's background — see applyReceipt).
        const ticks = document.createElement('span')
        ticks.className = 'chat__receipt-ticks'
        receipt.append(ticks)
        meta.append(receipt)
      }
      // Text bubbles: float the footer INSIDE the text's own inline flow
      // (WhatsApp's actual technique) so it hugs the end of the last line
      // instead of sitting on its own row below the paragraph — the
      // browser's native text reflow wraps around it per-line for free.
      // Every other type keeps the footer as its own row after the content.
      if (message.type === 'text') text.append(meta)
      else body.append(meta)
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
    // the end of the message. Line mode renders it as a dot; bubble mode
    // renders WhatsApp ticks — both driven by these classes, styled in
    // global.css. Three states: pending (not yet acked by the server),
    // delivered (reached the other member's device — gray double tick), seen
    // (they've had the chat open since — blue double tick).
    const myRows: HTMLElement[] = []
    let otherLastRead: string | null = current.otherLastReadAt
    let otherLastDelivered: string | null = current.otherLastDeliveredAt

    // WhatsApp's actual tick paths (bubble mode only — line mode's dot never
    // reads this markup). fill="currentColor" so the existing color rules
    // (seen = WhatsApp blue, per-wallpaper recolors) keep working unchanged.
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
      if (ticks) ticks.innerHTML = delivered || seen ? TICK_DOUBLE : TICK_SINGLE
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
    // One batched sign call warms the cache for the whole page, so each
    // bubble's own hydrateMedia() call below resolves from cache instead of
    // firing its own request.
    const historyMediaPaths = history.map(mediaPathOf).filter((p): p is string => !!p)
    if (historyMediaPaths.length) void getSignedUrls(connectionId, historyMediaPaths).catch(() => {})
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
    const sendBtn = root.querySelector<HTMLButtonElement>('#send-btn')!
    const micBtn = root.querySelector<HTMLButtonElement>('#mic-btn')!
    const attachBtn = root.querySelector<HTMLButtonElement>('#attach-btn')!

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
      sendBtn.classList.toggle('chat__input-bar-btn--hidden', !hasText)
      micBtn.classList.toggle('chat__input-bar-btn--hidden', hasText)
    }

    const syncComposer = (): void => {
      autoGrow()
      updateComposerMode()
    }
    input.addEventListener('input', syncComposer)
    syncComposer()

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
      replyBarSnippet.textContent = mediaLabel(replyTarget.type) ?? replyTarget.content
      replyBar.classList.add('chat__reply-bar--visible')
    }

    const startReply = (id: string): void => {
      const target = messagesById.get(id)
      if (!target) return
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

    const send = (): void => {
      const content = input.value.trim()
      if (!content) return
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

    const sendImage = async (file: File): Promise<void> => {
      if (file.size > MAX_IMAGE_BYTES) {
        showNotice('That photo is too large (max 10MB).')
        return
      }
      attachBtn.disabled = true
      try {
        const { width, height } = await readImageDimensions(file)
        const uploaded = await uploadAttachment(connectionId, 'image', file)
        sendMessage('', 'image', { ...uploaded, width, height })
      } catch {
        showNotice('Could not send that photo — try again.')
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
    const SPINNER_ICON =
      '<svg class="chat__icon-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="40 56.5"/></svg>'

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
      recordingBar.hidden = true
      recordingTime.textContent = formatDuration(0)
      input.hidden = false
      attachBtn.hidden = false
      micBtn.disabled = false
      micBtn.innerHTML = MIC_ICON
      micBtn.title = 'Record a voice note'
      micBtn.setAttribute('aria-label', 'Record voice note')
    }
    resetRecordingUI()

    // Shown on the mic button itself while a finished recording uploads in
    // the background (the composer is already back to idle by then — see
    // finishRecording). Disabling the button blocks a second tap from
    // starting a new recording mid-upload.
    const setMicLoading = (loading: boolean): void => {
      micBtn.disabled = loading
      micBtn.innerHTML = loading ? SPINNER_ICON : MIC_ICON
      micBtn.title = loading ? 'Sending…' : 'Record a voice note'
      micBtn.setAttribute('aria-label', loading ? 'Sending voice note' : 'Record voice note')
    }

    const beginRecording = async (): Promise<void> => {
      if (isRecording) return
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
      recordingBar.hidden = false
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
        setMicLoading(true)
        const uploaded = await uploadAttachment(connectionId, 'voice', blob)
        sendMessage('', 'voice', { ...uploaded, duration: durationSec })
      } catch {
        showNotice('Could not send that voice note — try again.')
      } finally {
        setMicLoading(false)
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
    }

    // Form submit fires for the send button and the iOS keyboard's Go/Send key.
    // A phone's soft keyboard can submit "/letter" as literal text without ever
    // producing a catchable Enter keydown, so check for an exact command match
    // here too before falling back to a normal send.
    composer.addEventListener('submit', (e) => {
      e.preventDefault()
      if (runIfCommand(input.value, slashCtx)) {
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

    const openReportModal = (messageId: string): void => {
      const box = document.createElement('div')
      box.className = 'notice-popup'

      const heading = document.createElement('div')
      heading.className = 'report-dialog__title'
      heading.textContent = 'Report this message?'

      const explain = document.createElement('div')
      explain.className = 'report-dialog__text'
      explain.textContent = "We'll review it. Add a note if you'd like (optional)."

      const reason = document.createElement('textarea')
      reason.className = 'report-dialog__reason'
      reason.rows = 3
      reason.placeholder = 'What’s wrong with this message?'

      const actions = document.createElement('div')
      actions.className = 'report-dialog__actions'
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
      // Long-press (touchstart/touchmove/touchend) already owns this gesture
      // on touch — Android can fire a native contextmenu around the same
      // ~450ms threshold as our own long-press timer, racing to open a
      // second, differently-sized menu (this path always includes Reply,
      // since it doesn't know it's actually a touch gesture) right on top of
      // the first — reads as the popover flashing big then shrinking, and
      // cuts its pop-in animation off mid-flight. Right-click only exists on
      // desktop, so just don't build a menu here at all on a coarse pointer.
      if (isCoarsePointer) return
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
      otherLastDelivered = next.otherLastDeliveredAt
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
        <button type="button" class="chat__icon-btn" id="attach-btn" title="Attach" aria-label="Attach">+</button>
        <textarea id="message-input" placeholder="Type a message..." autocomplete="off" enterkeyhint="send" rows="1"></textarea>
        <div class="chat__recording-bar" id="recording-bar" hidden>
          <span class="chat__recording-dot"></span>
          <span class="chat__recording-time" id="recording-time">0:00</span>
          <button type="button" class="chat__recording-cancel" id="recording-cancel">Cancel</button>
        </div>
        <button type="button" class="chat__icon-btn" id="mic-btn"></button>
        <button class="primary chat__send-btn" id="send-btn" type="submit" aria-label="Send"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c3.5-5 7-8.5 10.5-10.5"/><circle cx="17.5" cy="7" r="1.8" fill="currentColor" stroke="none"/></svg></button>
        <input type="file" id="attach-image-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
        <input type="file" id="attach-file-input" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" hidden />
      </form>
    </div>
  `

  root.querySelector<HTMLDivElement>('#nav-title')!.textContent = displayName
}
