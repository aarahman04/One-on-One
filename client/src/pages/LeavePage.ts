import type { Page } from '../state/router'
import { getCurrentConnection, leaveConnection } from '../services/connectionsApi'
import { loadingScreenHtml } from '../utils/loadingScreen'
import { openArchiveSave } from '../features/conversationArchive'
import { nextScreenFor } from '../state/nextScreen'

export const LeavePage: Page = (root, go) => {
  let disposed = false, closeArchive: (() => void) | undefined
  root.innerHTML = loadingScreenHtml()
  void getCurrentConnection().then((current) => {
    if (disposed) return
    if (!current || !['active', 'leave_pending'].includes(current.status)) { go(current ? nextScreenFor(current) : 'connection-id'); return }
    root.innerHTML = `<div class="screen"><div class="screen__title">Leave connection?</div>
      <p class="screen__subtitle">Chat, photos, letters and files will be deleted for both of you.</p>
      <div class="screen__actions"><button class="primary" data-save>Save a copy first</button>
      <button class="danger" data-leave>Leave without saving</button><button data-cancel>Cancel</button></div>
      <p role="status" class="media-error"></p></div>`
    let leaving = false
    const leave = async () => {
      if (disposed || leaving) return
      leaving = true
      root.querySelectorAll('button').forEach((b) => { b.disabled = true })
      try { await leaveConnection(current.id); if (!disposed) go('connection-id') }
      catch (err) {
        if (disposed) return
        root.querySelector('[role="status"]')!.textContent = err instanceof Error ? err.message : 'Could not leave. Try again.'
        root.querySelectorAll('button').forEach((b) => { b.disabled = false })
      } finally { leaving = false }
    }
    root.querySelector('[data-save]')!.addEventListener('click', () => { closeArchive = openArchiveSave(current, () => void leave()) })
    root.querySelector('[data-leave]')!.addEventListener('click', () => void leave())
    root.querySelector('[data-cancel]')!.addEventListener('click', () => go('chat'))
  }).catch(() => { if (!disposed) go('chat') })
  return () => { disposed = true; closeArchive?.() }
}
