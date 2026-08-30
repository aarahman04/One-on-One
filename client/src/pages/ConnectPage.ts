import type { Page } from '../state/router'
import { requestConnection } from '../services/connectionsApi'

export const ConnectPage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">CONNECT</div>
      <div class="screen__title">Connection ID</div>
      <input id="id-input" class="screen__input screen__input--code" placeholder="K7F29PQ2" maxlength="8" />
      <div class="screen__actions">
        <button class="primary" id="connect-btn">Connect</button>
      </div>
      <div class="screen__subtitle" id="error" style="color: var(--danger); display: none;"></div>
    </div>
  `

  const input = root.querySelector<HTMLInputElement>('#id-input')!
  const errorEl = root.querySelector<HTMLDivElement>('#error')!
  const button = root.querySelector<HTMLButtonElement>('#connect-btn')!

  button.addEventListener('click', async () => {
    errorEl.style.display = 'none'
    button.disabled = true
    try {
      await requestConnection(input.value.trim())
      go('waiting')
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Failed to connect.'
      errorEl.style.display = 'block'
    } finally {
      button.disabled = false
    }
  })
}
