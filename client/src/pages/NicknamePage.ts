import type { Page } from '../state/router'
import { getCurrentConnection, setNickname } from '../services/connectionsApi'
import { loadingScreenHtml } from '../utils/loadingScreen'

export const NicknamePage: Page = (root, go) => {
  root.innerHTML = loadingScreenHtml()

  getCurrentConnection()
    .then((current) => {
      // Rename is reachable from chat during a pending leave too (the backend
      // allows setNickname while leave_pending) — don't bounce the user out.
      if (!current || (current.status !== 'active' && current.status !== 'leave_pending')) {
        go('connection-id')
        return
      }

      root.innerHTML = `
        <div class="screen">
          <div class="screen__eyebrow">CONNECTION ACCEPTED</div>
          <div class="screen__title">What would you like to call this person?</div>
          <input id="nickname-input" class="screen__input" placeholder="Type a nickname" />
          <div class="screen__actions">
            <button class="primary" id="save-btn">Save</button>
          </div>
          <div class="screen__subtitle screen__error" id="error"></div>
        </div>
      `

      const input = root.querySelector<HTMLInputElement>('#nickname-input')!
      const errorEl = root.querySelector<HTMLDivElement>('#error')!
      const saveBtn = root.querySelector<HTMLButtonElement>('#save-btn')!

      saveBtn.addEventListener('click', async () => {
        const value = input.value.trim()
        if (!value) return
        errorEl.style.display = 'none'
        saveBtn.disabled = true
        try {
          await setNickname(current.id, value)
          go('chat')
        } catch (err) {
          errorEl.textContent = err instanceof Error ? err.message : 'Failed to save nickname.'
          errorEl.style.display = 'block'
          saveBtn.disabled = false
        }
      })
    })
    .catch(() => go('connection-id'))
}
