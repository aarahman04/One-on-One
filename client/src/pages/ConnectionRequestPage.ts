import type { Page } from '../state/router'
import { acceptConnection, declineConnection, getCurrentConnection } from '../services/connectionsApi'
import { escapeHtml } from '../utils/download'
import { loadingScreenHtml } from '../utils/loadingScreen'

export const ConnectionRequestPage: Page = (root, go) => {
  root.innerHTML = loadingScreenHtml()

  getCurrentConnection()
    .then((current) => {
      if (!current || current.isRequester) {
        go('connection-id')
        return
      }

      root.innerHTML = `
        <div class="screen">
          <div class="screen__eyebrow">CONNECTION REQUEST</div>
          <div class="connection-id">${escapeHtml(current.otherConnectionCode)}</div>
          <div class="screen__subtitle">wants to connect with you.</div>
          <div class="screen__actions">
            <button class="primary" id="accept-btn">Accept</button>
            <button id="decline-btn">Decline</button>
          </div>
          <div class="screen__subtitle screen__error" id="error"></div>
        </div>
      `

      const errorEl = root.querySelector<HTMLDivElement>('#error')!
      const acceptBtn = root.querySelector<HTMLButtonElement>('#accept-btn')!
      const declineBtn = root.querySelector<HTMLButtonElement>('#decline-btn')!

      acceptBtn.addEventListener('click', async () => {
        errorEl.style.display = 'none'
        acceptBtn.disabled = true
        declineBtn.disabled = true
        try {
          await acceptConnection(current.id)
          go('nickname')
        } catch (err) {
          errorEl.textContent = err instanceof Error ? err.message : 'Failed to accept.'
          errorEl.style.display = 'block'
          acceptBtn.disabled = false
          declineBtn.disabled = false
        }
      })

      declineBtn.addEventListener('click', async () => {
        errorEl.style.display = 'none'
        acceptBtn.disabled = true
        declineBtn.disabled = true
        try {
          await declineConnection(current.id)
          go('connection-id')
        } catch (err) {
          errorEl.textContent = err instanceof Error ? err.message : 'Failed to decline.'
          errorEl.style.display = 'block'
          acceptBtn.disabled = false
          declineBtn.disabled = false
        }
      })
    })
    .catch(() => go('connection-id'))
}
