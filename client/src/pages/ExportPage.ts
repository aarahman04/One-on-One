import type { Page } from '../state/router'
import { getCurrentConnection } from '../services/connectionsApi'
import { allMessages, conversationHtml, conversationText, openArchiveSave } from '../features/conversationArchive'
import { archiveMessages } from '../features/archiveRules'
import { downloadFile } from '../utils/download'
import { loadingScreenHtml } from '../utils/loadingScreen'

export const ExportPage: Page = (root, go) => {
  const abort = new AbortController()
  let closeArchive: (() => void) | undefined
  root.innerHTML = loadingScreenHtml()
  void (async () => {
    const current = await getCurrentConnection()
    if (abort.signal.aborted) return
    if (!current) { go('connection-id'); return }
    const messages = archiveMessages(await allMessages(current.id, abort.signal))
    if (abort.signal.aborted) return
    root.innerHTML = `<div class="screen"><div class="screen__title">Save conversation</div><p class="screen__subtitle"></p>
      <div class="screen__actions"><button class="primary" data-zip>Save zip with photos and files</button>
      <button data-html>Web page</button><button data-txt>Plain text</button><button data-json>Structured data</button><button data-back>Back</button></div></div>`
    root.querySelector('p')!.textContent = `${messages.length} messages`
    root.querySelector('[data-zip]')!.addEventListener('click', () => { closeArchive = openArchiveSave(current) })
    root.querySelector('[data-html]')!.addEventListener('click', () => downloadFile('one-on-one.html', 'text/html', conversationHtml(messages, current)))
    root.querySelector('[data-txt]')!.addEventListener('click', () => downloadFile('one-on-one.txt', 'text/plain', conversationText(messages, current)))
    root.querySelector('[data-json]')!.addEventListener('click', () => downloadFile('one-on-one.json', 'application/json', JSON.stringify(messages, null, 2)))
    root.querySelector('[data-back]')!.addEventListener('click', () => go(current.status === 'ended' ? 'partner-left' : 'chat'))
  })().catch(() => { if (!abort.signal.aborted) go('connection-id') })
  return () => { abort.abort(); closeArchive?.() }
}
