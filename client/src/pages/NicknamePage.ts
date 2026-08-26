import type { Page } from '../state/router'
import { getCurrentConnection, setNickname } from '../services/connectionsApi'

export const NicknamePage: Page = (root, go) => {
  root.innerHTML = `<div class="screen"><div class="screen__subtitle">Loading...</div></div>`

  getCurrentConnection()
    .then((current) => {
      if (!current || current.status !== 'active') {
        go('connection-id')
        return
      }

      root.innerHTML = `
        <div class="screen">
          <div class="screen__eyebrow">CONNECTION ACCEPTED</div>
          <div class="screen__title">What would you like<br />to call this person?</div>
          <input id="nickname-input" placeholder="Type a nickname" style="text-align:center; width:220px;" />
          <div class="screen__actions">
            <button class="primary" id="save-btn">Save</button>
          </div>
          <div class="screen__subtitle" id="error" style="color: var(--danger); display: none;"></div>
        </div>
      `

      const input = root.querySelector<HTMLInputElement>('#nickname-input')!
      const errorEl = root.querySelector<HTMLDivElement>('#error')!

      root.querySelector<HTMLButtonElement>('#save-btn')!.addEventListener('click', async () => {
        try {
          await setNickname(current.id, input.value)
          go('chat')
        } catch (err) {
          errorEl.textContent = err instanceof Error ? err.message : 'Failed to save nickname.'
          errorEl.style.display = 'block'
        }
      })
    })
    .catch(() => go('connection-id'))
}
