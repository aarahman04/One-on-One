import type { Page } from '../state/router'
import { getCurrentConnection, getMessages, type HistoryMessage } from '../services/connectionsApi'
import { formatFullTimestamp } from '../utils/formatTime'

export const ExportPage: Page = (root, go) => {
  root.innerHTML = `<div class="screen"><div class="screen__subtitle">Loading...</div></div>`

  ;(async () => {
    const current = await getCurrentConnection()
    if (!current) {
      go('connection-id')
      return
    }

    const messages = await getMessages(current.id)
    const otherName = (current.otherNickname ?? 'Them').trim()

    root.innerHTML = `
      <div class="screen">
        <div class="screen__eyebrow">EXPORT CONVERSATION</div>
        <div class="screen__subtitle">Messages: ${messages.length}</div>
        <div class="screen__actions">
          <button class="primary" id="export-txt">Export TXT</button>
          <button id="export-json">Export JSON</button>
        </div>
        <div class="screen__actions">
          <button id="back-btn">Back</button>
        </div>
      </div>
    `

    root.querySelector<HTMLButtonElement>('#export-txt')!.addEventListener('click', () => {
      download('one-on-one.txt', 'text/plain', toTxt(messages, current.myUserId, otherName))
    })
    root.querySelector<HTMLButtonElement>('#export-json')!.addEventListener('click', () => {
      download('one-on-one.json', 'application/json', toJson(messages, current.myUserId, otherName))
    })
    root.querySelector<HTMLButtonElement>('#back-btn')!.addEventListener('click', () => go('chat'))
  })().catch(() => go('connection-id'))
}

function toTxt(messages: HistoryMessage[], myUserId: string, otherName: string): string {
  return messages
    .map((m) => {
      const who = m.senderId === myUserId ? 'YOU' : otherName
      return `[${formatFullTimestamp(new Date(m.createdAt)).replace('\n', ' ')}] ${who}: ${m.content}`
    })
    .join('\n')
}

function toJson(messages: HistoryMessage[], myUserId: string, otherName: string): string {
  const out = messages.map((m) => ({
    sender: m.senderId === myUserId ? 'you' : otherName,
    content: m.content,
    at: m.createdAt,
  }))
  return JSON.stringify(out, null, 2)
}

function download(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
