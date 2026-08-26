import type { Page } from '../state/router'
import { fakeMessages } from '../utils/fakeMessages'
import { formatClock, formatDateSeparator, formatFullTimestamp, isSameDay } from '../utils/formatTime'
import { mountMenuDropdown } from '../components/MenuDropdown'

export const ChatPage: Page = (root, go) => {
  root.innerHTML = `
    <div class="chat">
      <div class="chat__nav">
        <div>
          <div class="chat__nav-title">ARJUN</div>
          <div class="chat__nav-status">connected</div>
        </div>
        <button class="chat__menu-btn" id="menu-btn">&bull;&bull;&bull;</button>
      </div>
      <div class="chat__log" id="chat-log"></div>
      <div class="chat__input-bar">
        <input id="message-input" placeholder="Type a message..." />
        <button class="primary" id="send-btn">&uarr;</button>
      </div>
    </div>
  `

  const nav = root.querySelector<HTMLElement>('.chat__nav')!
  const menuBtn = root.querySelector<HTMLButtonElement>('#menu-btn')!
  mountMenuDropdown(nav, menuBtn, go)

  const log = root.querySelector<HTMLDivElement>('#chat-log')!
  let lastDate: Date | null = null

  for (const message of fakeMessages) {
    if (!lastDate || !isSameDay(lastDate, message.at)) {
      const sep = document.createElement('div')
      sep.className = 'chat__date-separator'
      sep.textContent = formatDateSeparator(message.at)
      log.appendChild(sep)
      lastDate = message.at
    }

    const row = document.createElement('div')
    row.className = 'chat__message'
    row.innerHTML = `
      <div class="chat__message-time">${formatClock(message.at)}</div>
      <div class="chat__message-body">
        <div class="chat__message-sender chat__message-sender--${message.sender}">
          ${message.sender === 'you' ? 'YOU' : 'ARJUN'}
        </div>
        <div class="chat__message-text">${message.text}</div>
        <div class="chat__message-full-time">${formatFullTimestamp(message.at)}</div>
      </div>
    `
    row.addEventListener('click', () => row.classList.toggle('chat__message--expanded'))
    log.appendChild(row)
  }

  log.scrollTop = log.scrollHeight

  root.querySelector<HTMLButtonElement>('#send-btn')!.addEventListener('click', () => {
    const input = root.querySelector<HTMLInputElement>('#message-input')!
    if (!input.value.trim()) return
    input.value = ''
  })
}
