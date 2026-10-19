import { getMessages, type CurrentConnection, type HistoryMessage } from '../services/connectionsApi'
import { getSignedUrls } from '../services/attachmentsApi'
import { downloadBlob, escapeHtml } from '../utils/download'
import { archiveContent, archiveFilename, archiveFiles, archiveMessages } from './archiveRules'
import { openModal } from '../components/Modal'

export async function allMessages(id: string, signal?: AbortSignal): Promise<HistoryMessage[]> {
  const byId = new Map<string, HistoryMessage>()
  let before: string | undefined
  while (true) {
    signal?.throwIfAborted()
    const page = await getMessages(id, before, undefined, signal)
    for (const m of page) byId.set(m.id, m)
    const cursor = page[0]?.createdAt
    if (page.length < 50 || !cursor) break
    if (cursor === before) throw new Error('History did not finish loading. Please try again.')
    before = cursor
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function conversationText(messages: HistoryMessage[], current: CurrentConnection, files = new Map<string, string>()): string {
  return archiveMessages(messages).map((m) => {
    const name = m.senderId === current.myUserId ? 'You' : current.otherNickname || 'Partner'
    const path = files.get(m.id)
    const content = archiveContent(m)
    return `[${new Date(m.createdAt).toLocaleString()}] ${name}: ${path ? `[${m.type === 'image' ? 'Photo' : m.type === 'voice' ? 'Voice message' : m.type === 'letter' ? 'Letter' : 'File'}: ${path}]\n` : ''}${content}${m.editedAt ? ' (edited)' : ''}`
  }).join('\n\n')
}

export function conversationHtml(messages: HistoryMessage[], current: CurrentConnection, files = new Map<string, string>()): string {
  const e = escapeHtml
  const rows = archiveMessages(messages).map((m) => {
    const path = files.get(m.id), url = path ? e(path.split('/').map(encodeURIComponent).join('/')) : ''
    const media = !path ? '' : m.type === 'image' ? `<img src="${url}" alt="Shared image">` : m.type === 'voice' ? `<audio controls src="${url}"></audio>` : `<p><a href="${url}">${m.type === 'letter' ? 'Read letter (PDF)' : 'Open file'}</a></p>`
    return `<article class="${m.senderId === current.myUserId ? 'me' : 'them'}"><small>${e(m.senderId === current.myUserId ? 'You' : current.otherNickname || 'Partner')} · ${e(new Date(m.createdAt).toLocaleString())}</small>${media}<div>${e(archiveContent(m))}</div></article>`
  }).join('\n')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conversation with ${e(current.otherNickname || 'Partner')}</title><style>body{max-width:720px;margin:auto;padding:20px;font:16px/1.5 system-ui;background:#f6f4f1;color:#161b22}article{max-width:85%;padding:12px;margin:12px 0;background:#fff;border-radius:14px;overflow-wrap:anywhere}.me{margin-left:auto;background:#d6f6d8}small{display:block;color:#485460}article div{white-space:pre-wrap}img,audio{max-width:100%}img{max-height:500px}</style><h1>Conversation with ${e(current.otherNickname || 'Partner')}</h1>${rows}</html>`
}

export async function saveConversationZip(current: CurrentConnection, signal: AbortSignal, progress: (value: number) => void): Promise<void> {
  progress(0)
  const [{ default: JSZip }, messages] = await Promise.all([import('jszip'), allMessages(current.id, signal)])
  const zip = new JSZip(), files = archiveFiles(messages), saved = new Map<string, string>()
  for (const folder of ['letters', 'images/stickers', 'voice', 'files']) zip.folder(folder)
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted()
    let blob: Blob
    if (file.message.type === 'letter') {
      const { letterPdf } = await import('./letterPdf')
      const p = file.message.payload as { to: string; from: string }
      blob = await letterPdf(file.message.content, { ...p, appearance: 'dawn' }, file.message.createdAt)
    } else {
      const p = file.message.payload as { path: string }
      const urls = await getSignedUrls(current.id, [p.path], { fresh: true, signal })
      if (!urls[p.path]) throw new Error('An attachment is unavailable. Your conversation has not been deleted.')
      const res = await fetch(urls[p.path], { signal })
      if (!res.ok) throw new Error('An attachment could not be saved. Try again.')
      blob = await res.blob()
    }
    signal.throwIfAborted()
    zip.file(file.name, await blob.arrayBuffer())
    saved.set(file.message.id, file.name)
    progress(Math.round((index + 1) / Math.max(files.length, 1) * 85))
  }
  zip.file('conversation.txt', conversationText(messages, current, saved))
  zip.file('conversation.html', conversationHtml(messages, current, saved))
  // shortcut: JSZip buffers the archive; use a streaming file writer when browsers support saving streams consistently.
  const blob = await zip.generateAsync({ type: 'blob', streamFiles: true }, ({ percent }) => { signal.throwIfAborted(); progress(Math.round(85 + percent * .15)) })
  signal.throwIfAborted()
  downloadBlob(archiveFilename(current.otherNickname || 'Partner'), blob)
  progress(100)
}

export function openArchiveSave(current: CurrentConnection, onSaved: () => void = () => {}): () => void {
  const abort = new AbortController()
  const box = document.createElement('div')
  box.className = 'archive-save'
  box.innerHTML = '<h2>Save conversation</h2><p role="status">Loading history…</p><progress max="100" value="0" aria-label="Saving conversation"></progress><button type="button">Cancel</button>'
  const modal = openModal(box, { onClose: () => abort.abort() })
  modal.panel.setAttribute('aria-label', 'Save conversation')
  box.querySelector('button')!.addEventListener('click', modal.close)
  void saveConversationZip(current, abort.signal, (percent) => {
    box.querySelector('p')!.textContent = `Saving your conversation… ${percent}%`
    box.querySelector('progress')!.value = percent
  }).then(() => {
    if (abort.signal.aborted) return
    modal.close()
    onSaved()
  }).catch((err) => {
    if (abort.signal.aborted) return
    box.querySelector('p')!.textContent = err instanceof Error ? err.message : 'Could not save. Try again.'
    box.querySelector('button')!.textContent = 'Close'
  })
  return modal.close
}
