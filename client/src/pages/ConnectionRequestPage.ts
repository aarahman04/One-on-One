import type { Page } from '../state/router'
import { acceptConnection, declineConnection, getCurrentConnection } from '../services/connectionsApi'

export const ConnectionRequestPage: Page = (root, go) => {
  root.innerHTML = `<div class="screen"><div class="screen__subtitle">Loading...</div></div>`

  getCurrentConnection()
    .then((current) => {
      if (!current || current.isRequester) {
        go('connection-id')
        return
      }

      root.innerHTML = `
        <div class="screen">
          <div class="screen__eyebrow">CONNECTION REQUEST</div>
          <div class="connection-id" style="font-size:24px;">${current.otherConnectionCode}</div>
          <div class="screen__subtitle">wants to connect with you.</div>
          <div class="screen__actions">
            <button class="primary" id="accept-btn">Accept</button>
            <button id="decline-btn">Decline</button>
          </div>
          <div class="screen__subtitle" id="error" style="color: var(--danger); display: none;"></div>
        </div>
      `

      const errorEl = root.querySelector<HTMLDivElement>('#error')!

      root.querySelector<HTMLButtonElement>('#accept-btn')!.addEventListener('click', async () => {
        try {
          await acceptConnection(current.id)
          go('nickname')
        } catch (err) {
          errorEl.textContent = err instanceof Error ? err.message : 'Failed to accept.'
          errorEl.style.display = 'block'
        }
      })

      root.querySelector<HTMLButtonElement>('#decline-btn')!.addEventListener('click', async () => {
        try {
          await declineConnection(current.id)
          go('connection-id')
        } catch (err) {
          errorEl.textContent = err instanceof Error ? err.message : 'Failed to decline.'
          errorEl.style.display = 'block'
        }
      })
    })
    .catch(() => go('connection-id'))
}
