import type { Page } from '../state/router'
import { getCurrentConnection, getMessages, type HistoryMessage } from '../services/connectionsApi'
import { formatFullTimestamp } from '../utils/formatTime'
import { downloadFile, escapeHtml } from '../utils/download'
import { loadingScreenHtml } from '../utils/loadingScreen'

function letterMeta(m: HistoryMessage): { to: string; from: string } {
  const p = (m.payload ?? {}) as { to?: string; from?: string }
  return { to: p.to ?? '', from: p.from ?? '' }
}

export const ExportPage: Page = (root, go) => {
  root.innerHTML = loadingScreenHtml()

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
          <button class="primary" id="export-html">Export HTML</button>
          <button id="export-txt">Export TXT</button>
          <button id="export-json">Export JSON</button>
        </div>
        <div class="screen__actions">
          <button id="back-btn">Back</button>
        </div>
      </div>
    `

    root.querySelector<HTMLButtonElement>('#export-html')!.addEventListener('click', () => {
      downloadFile('one-on-one.html', 'text/html', toHtml(messages, current.myUserId, otherName))
    })
    root.querySelector<HTMLButtonElement>('#export-txt')!.addEventListener('click', () => {
      downloadFile('one-on-one.txt', 'text/plain', toTxt(messages, current.myUserId, otherName))
    })
    root.querySelector<HTMLButtonElement>('#export-json')!.addEventListener('click', () => {
      downloadFile('one-on-one.json', 'application/json', toJson(messages, current.myUserId, otherName))
    })
    root.querySelector<HTMLButtonElement>('#back-btn')!.addEventListener('click', () => go('chat'))
  })().catch(() => go('connection-id'))
}

function toTxt(messages: HistoryMessage[], myUserId: string, otherName: string): string {
  return messages
    .map((m) => {
      const who = m.senderId === myUserId ? 'YOU' : otherName
      const when = formatFullTimestamp(new Date(m.createdAt)).replace('\n', ' ')
      if (m.type === 'letter') {
        const { to, from } = letterMeta(m)
        return `[${when}] ${who}: [letter to ${to} from ${from}]\n${m.content}`
      }
      return `[${when}] ${who}: ${m.content}`
    })
    .join('\n')
}

function toJson(messages: HistoryMessage[], myUserId: string, otherName: string): string {
  const out = messages.map((m) => ({
    sender: m.senderId === myUserId ? 'you' : otherName,
    type: m.type,
    content: m.content,
    ...(m.type === 'letter' ? { letter: m.payload } : {}),
    at: m.createdAt,
  }))
  return JSON.stringify(out, null, 2)
}

// Readable HTML export: left/right layout so the conversation is easy to follow.
function toHtml(messages: HistoryMessage[], myUserId: string, otherName: string): string {
  const rows = messages
    .map((m) => {
      const mine = m.senderId === myUserId
      const who = mine ? 'You' : otherName
      const when = formatFullTimestamp(new Date(m.createdAt)).replace('\n', ' ')
      const meta = `<div class="meta">${escapeHtml(who)} · ${escapeHtml(when)}</div>`
      if (m.type === 'letter') {
        const { to, from } = letterMeta(m)
        return `    <div class="msg ${mine ? 'me' : 'them'}">${meta}<div class="letter"><div class="letter-h">✉ A letter — to ${escapeHtml(to)}, from ${escapeHtml(from)}</div><div class="text">${escapeHtml(m.content)}</div></div></div>`
      }
      return `    <div class="msg ${mine ? 'me' : 'them'}">${meta}<div class="text">${escapeHtml(m.content)}</div></div>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>One on One — conversation with ${escapeHtml(otherName)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 680px; margin: 0 auto; padding: 24px; background: #0d1117; color: #e6edf3; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  .count { color: #9aa4af; font-size: 13px; margin-bottom: 20px; }
  .msg { margin: 10px 0; padding: 10px 14px; border-radius: 12px; max-width: 80%; }
  .msg.me { background: #16351f; margin-left: auto; }
  .msg.them { background: #12181f; margin-right: auto; }
  .meta { font-size: 11px; color: #9aa4af; margin-bottom: 4px; }
  .text { white-space: pre-wrap; word-wrap: break-word; }
  .letter { border: 1px solid #3a4a2f; border-radius: 8px; padding: 10px 12px; background: rgba(120, 150, 90, 0.08); }
  .letter-h { font-size: 12px; color: #cdebc0; margin-bottom: 6px; }
</style></head>
<body>
  <h1>Conversation with ${escapeHtml(otherName)}</h1>
  <div class="count">${messages.length} messages · exported ${escapeHtml(new Date().toLocaleString())}</div>
${rows}
</body></html>`
}
