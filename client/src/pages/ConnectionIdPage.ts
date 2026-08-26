import type { Page } from '../state/router'
import { fetchMe } from '../services/apiClient'
import { getCurrentConnection, regenerateConnectionCode } from '../services/connectionsApi'

const POLL_INTERVAL_MS = 3000

export const ConnectionIdPage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">YOUR CONNECTION ID</div>
      <div class="connection-id" id="connection-id">...</div>
      <div class="screen__actions">
        <button id="copy-btn" disabled>Copy</button>
        <button id="new-id-btn" disabled>Get a new ID</button>
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
  const newIdBtn = root.querySelector<HTMLButtonElement>('#new-id-btn')!

  let code = ''

  fetchMe()
    .then(({ connectionCode }) => {
      code = connectionCode
      idEl.textContent = code
      subtitleEl.textContent = 'Give this ID to the person you want to connect with.'
      copyBtn.disabled = false
      newIdBtn.disabled = false
    })
    .catch((err) => {
      idEl.textContent = '—'
      subtitleEl.textContent = err instanceof Error ? err.message : 'Failed to load connection ID.'
    })

  copyBtn.addEventListener('click', async () => {
    if (code) await navigator.clipboard.writeText(code)
  })

  // Rotate the ID (e.g. it got shared too widely). The old ID stops working.
  newIdBtn.addEventListener('click', async () => {
    newIdBtn.disabled = true
    try {
      code = await regenerateConnectionCode()
      idEl.textContent = code
      subtitleEl.textContent = 'New ID generated. The old one no longer works.'
    } catch (err) {
      subtitleEl.textContent = err instanceof Error ? err.message : 'Failed to generate a new ID.'
    } finally {
      newIdBtn.disabled = false
    }
  })

  // Live-route the moment an incoming request arrives (or one gets accepted
  // elsewhere), so the recipient never sits on this screen able to fire off
  // their own duplicate request.
  const poll = async (): Promise<void> => {
    const current = await getCurrentConnection()
    if (!current) return
    if (current.status === 'pending') {
      go(current.isRequester ? 'waiting' : 'request')
    } else if (current.status === 'active' || current.status === 'leave_pending') {
      go(current.otherNickname ? 'chat' : 'nickname')
    }
  }

  const interval = setInterval(() => {
    poll().catch(() => {})
  }, POLL_INTERVAL_MS)

  root.querySelector<HTMLButtonElement>('#continue-btn')!.addEventListener('click', () => {
    go('connect')
  })

  return () => clearInterval(interval)
}
