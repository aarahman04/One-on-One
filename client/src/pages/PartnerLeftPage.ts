import type { Page } from '../state/router'
import { acknowledgeEnd, getCurrentConnection } from '../services/connectionsApi'
import { nextScreenFor } from '../state/nextScreen'
import { loadingScreenHtml } from '../utils/loadingScreen'
import { openArchiveSave } from '../features/conversationArchive'
import { openModal } from '../components/Modal'

export const PartnerLeftPage: Page = (root, go) => {
  let disposed = false, closeArchive: (() => void) | undefined, closeConfirm: (() => void) | undefined
  root.innerHTML = loadingScreenHtml()
  void getCurrentConnection().then((current) => {
    if (disposed) return
    if (current?.status !== 'ended') { go(current ? nextScreenFor(current) : 'connection-id'); return }
    root.innerHTML = `<div class="screen"><div class="screen__title"></div><p class="screen__subtitle"></p>
      <div class="screen__actions"><button class="primary" data-save>Save zip</button><button data-skip>Skip</button></div><p role="status"></p></div>`
    root.querySelector('.screen__title')!.textContent = `${current.otherNickname || 'Your partner'} left the connection.`
    const date = current.purgeAt ? new Date(current.purgeAt).toLocaleDateString(undefined, { dateStyle: 'long' }) : '7 days from now'
    root.querySelector('.screen__subtitle')!.textContent = `Save your conversation before it's deleted on ${date}?`
    const acknowledge = async () => {
      root.querySelectorAll('button').forEach((b) => { b.disabled = true })
      try { await acknowledgeEnd(current.id); if (!disposed) go('connection-id') }
      catch (err) {
        if (disposed) return
        root.querySelector('[role="status"]')!.textContent = err instanceof Error ? err.message : 'Could not continue. Try again.'
        root.querySelectorAll('button').forEach((b) => { b.disabled = false })
      }
    }
    root.querySelector('[data-save]')!.addEventListener('click', () => { closeArchive = openArchiveSave(current, () => void acknowledge()) })
    root.querySelector('[data-skip]')!.addEventListener('click', () => {
      const box = document.createElement('div')
      box.innerHTML = '<h2>Delete without saving?</h2><p>Your conversation will be gone for good.</p><button data-back>Go back</button><button class="danger" data-delete>Delete</button>'
      const modal = openModal(box)
      closeConfirm = modal.close
      box.querySelector('[data-back]')!.addEventListener('click', modal.close)
      box.querySelector('[data-delete]')!.addEventListener('click', () => { modal.close(); void acknowledge() })
    })
  }).catch(() => { if (!disposed) { root.innerHTML = '<div class="screen"><p>Could not load your conversation.</p><button>Try again</button></div>'; root.querySelector('button')!.onclick = () => go('partner-left') } })
  return () => { disposed = true; closeArchive?.(); closeConfirm?.() }
}
