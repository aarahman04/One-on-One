import { openModal } from '../components/Modal'
import type { Page } from '../state/router'
import { acceptConnection, declineConnection, getCurrentConnection, endedConnectionId } from '../services/connectionsApi'
import { escapeHtml } from '../utils/download'
import { loadingScreenHtml } from '../utils/loadingScreen'

export const ConnectionRequestPage: Page = (root, go) => {
  let disposed = false, closeWarning: (() => void) | undefined
  root.innerHTML = loadingScreenHtml()

  getCurrentConnection()
    .then((current) => {
      if (disposed) return
      if (!current || current.isRequester) {
        go('connection-id')
        return
      }

      root.innerHTML = `
        <div class="screen">
      <div class="screen__title">Connection request</div>
      <div class="screen__subtitle">${escapeHtml(current.otherConnectionCode)} wants to connect with you.</div>
          <div class="screen__actions">
        <button class="danger" id="decline-btn">Decline</button>
            <button class="primary" id="accept-btn">Accept</button>
          </div>
          <div class="screen__subtitle screen__error" id="error"></div>
        </div>
      `

      const errorEl = root.querySelector<HTMLDivElement>('#error')!
      const acceptBtn = root.querySelector<HTMLButtonElement>('#accept-btn')!
      const declineBtn = root.querySelector<HTMLButtonElement>('#decline-btn')!

      const accept = async () => {
        errorEl.style.display = 'none'
        acceptBtn.disabled = true
        declineBtn.disabled = true
        try {
          await acceptConnection(current.id)
          if (!disposed) go('chat')
        } catch (err) {
          if (disposed) return
          errorEl.textContent = err instanceof Error ? err.message : 'Failed to accept.'
          errorEl.style.display = 'block'
          acceptBtn.disabled = false
          declineBtn.disabled = false
        }
      }

      acceptBtn.addEventListener('click', () => {
        if (!endedConnectionId(current.myUserId)) { void accept(); return }
        const box = document.createElement('div')
        box.innerHTML = '<h2>Your old chat will be deleted</h2><p>Save it first if you want a copy.</p><button type="button" data-back>Go back</button><button type="button" data-accept>Accept and delete old chat</button>'
        const modal = openModal(box); closeWarning = modal.close
        box.querySelector('[data-back]')!.addEventListener('click', modal.close)
        box.querySelector('[data-accept]')!.addEventListener('click', () => { modal.close(); void accept() })
      })

      declineBtn.addEventListener('click', async () => {
        errorEl.style.display = 'none'
        acceptBtn.disabled = true
        declineBtn.disabled = true
        try {
          await declineConnection(current.id)
          if (!disposed) go('connection-id')
        } catch (err) {
          if (disposed) return
          errorEl.textContent = err instanceof Error ? err.message : 'Failed to decline.'
          errorEl.style.display = 'block'
          acceptBtn.disabled = false
          declineBtn.disabled = false
        }
      })
    })
    .catch(() => { if (!disposed) go('connection-id') })
  return () => { disposed = true; closeWarning?.() }
}
