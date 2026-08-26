import type { Page } from '../state/router'
import { fetchMe } from '../services/apiClient'

export const ConnectionIdPage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">YOUR CONNECTION ID</div>
      <div class="connection-id" id="connection-id">...</div>
      <div class="screen__actions">
        <button id="copy-btn" disabled>Copy</button>
      </div>
      <div class="screen__subtitle" id="subtitle">Loading...</div>
      <div class="screen__actions">
        <button class="primary" id="continue-btn">I have an ID to connect with</button>
      </div>
    </div>
  `

  const idEl = root.querySelector<HTMLDivElement>('#connection-id')!
  const subtitleEl = root.querySelector<HTMLDivElement>('#subtitle')!
  const copyBtn = root.querySelector<HTMLButtonElement>('#copy-btn')!

  fetchMe()
    .then(({ connectionCode }) => {
      idEl.textContent = connectionCode
      subtitleEl.textContent = 'Give this ID to the person you want to connect with.'
      copyBtn.disabled = false
      copyBtn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(connectionCode)
      })
    })
    .catch((err) => {
      idEl.textContent = '—'
      subtitleEl.textContent = err instanceof Error ? err.message : 'Failed to load connection ID.'
    })

  root.querySelector<HTMLButtonElement>('#continue-btn')!.addEventListener('click', () => {
    go('connect')
  })
}
