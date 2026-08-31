import type { Page } from '../state/router'
import { fetchMe } from '../services/apiClient'
import { getCurrentConnection, regenerateConnectionCode } from '../services/connectionsApi'
import { signOut } from '../services/authService'
import { nextScreenFor } from '../state/nextScreen'

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
      <div class="screen__actions">
        <button id="logout-btn">Log out</button>
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

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch {
      /* clipboard API present but blocked (http:, permissions) — fall through */
    }
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.append(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }

  copyBtn.addEventListener('click', async () => {
    if (!code) return
    const ok = await copyToClipboard(code)
    subtitleEl.textContent = ok ? 'Copied to clipboard.' : `Copy manually: ${code}`
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
    const next = nextScreenFor(current)
    if (next !== 'connection-id') go(next)
  }

  const interval = setInterval(() => {
    poll().catch(() => {})
  }, POLL_INTERVAL_MS)

  root.querySelector<HTMLButtonElement>('#continue-btn')!.addEventListener('click', () => {
    go('connect')
  })

  root.querySelector<HTMLButtonElement>('#logout-btn')!.addEventListener('click', () => {
    void signOut().then(() => location.assign('/'))
  })

  return () => clearInterval(interval)
}
