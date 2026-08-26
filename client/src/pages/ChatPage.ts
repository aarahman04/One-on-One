import type { Page, Screen } from '../state/router'
import { formatClock, formatDateSeparator, formatFullTimestamp, isSameDay } from '../utils/formatTime'
import { mountMenuDropdown } from '../components/MenuDropdown'
import { getCurrentConnection, getMessages } from '../services/connectionsApi'
import { connectMessaging, type IncomingMessage } from '../services/messageService'
import type { Transport } from '../services/transport/Transport'

export const ChatPage: Page = (root, go) => {
  let transport: Transport | null = null
  let unsubscribe: (() => void) | null = null
  let disposed = false

  const cleanup = (): void => {
    disposed = true
    unsubscribe?.()
    transport?.disconnect()
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

    const history = await getMessages(current.id)
    if (disposed) return

    transport = await connectMessaging()
    if (disposed) {
      transport.disconnect()
      return
    }

    renderChat(root, go, otherName)

    const log = root.querySelector<HTMLDivElement>('#chat-log')!
    let lastDate: Date | null = null

    const appendMessage = (message: IncomingMessage): void => {
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
      row.className = 'chat__message'

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
    }

    for (const message of history) appendMessage(message)
    unsubscribe = transport.onMessage(appendMessage)

    const input = root.querySelector<HTMLInputElement>('#message-input')!
    const sendBtn = root.querySelector<HTMLButtonElement>('#send-btn')!

    const send = async (): Promise<void> => {
      const content = input.value.trim()
      if (!content) return
      input.value = ''
      try {
        await transport!.sendMessage(content)
      } catch {
        input.value = content
      }
    }

    sendBtn.addEventListener('click', () => void send())
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void send()
      }
    })
    input.focus()
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
      <div class="chat__log" id="chat-log"></div>
      <div class="chat__input-bar">
        <input id="message-input" placeholder="Type a message..." autocomplete="off" />
        <button class="primary" id="send-btn">&uarr;</button>
      </div>
    </div>
  `

  root.querySelector<HTMLDivElement>('#nav-title')!.textContent = displayName

  const nav = root.querySelector<HTMLElement>('.chat__nav')!
  const menuBtn = root.querySelector<HTMLButtonElement>('#menu-btn')!
  mountMenuDropdown(nav, menuBtn, go)
}
