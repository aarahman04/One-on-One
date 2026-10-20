import type { Page } from '../state/router'
import { fetchMe } from '../services/apiClient'
import { getCurrentConnection, regenerateConnectionCode } from '../services/connectionsApi'
import { signOut } from '../services/authService'
import { nextScreenFor } from '../state/nextScreen'
import { openDeleteAccountDialog } from '../features/deleteAccount'

const POLL_INTERVAL_MS = 3000

export const ConnectionIdPage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__title">Your connection ID</div>
      <button type="button" class="connection-id" id="connection-id" aria-label="Copy your connection ID" disabled>...</button>
      <div class="screen__actions">
        <button id="share-btn" disabled>Share</button>
        <button id="new-id-btn" disabled>New ID</button>
      </div>
      <div class="screen__subtitle" id="subtitle">Loading…</div>
      <div class="screen__actions">
        <button class="primary" id="continue-btn">I have their ID</button>
      </div>
      <div class="screen__actions">
        <button id="logout-btn">Log out</button>
      </div>
      <button type="button" class="screen__alt" id="delete-account-btn">Delete account</button>
    </div>
  `

  const idEl = root.querySelector<HTMLButtonElement>('#connection-id')!
  const subtitleEl = root.querySelector<HTMLDivElement>('#subtitle')!
  const shareBtn = root.querySelector<HTMLButtonElement>('#share-btn')!
  const newIdBtn = root.querySelector<HTMLButtonElement>('#new-id-btn')!

  let code = ''

  fetchMe()
    .then(({ connectionCode }) => {
      code = connectionCode
      idEl.textContent = code
      subtitleEl.textContent = 'Share this ID to connect.'
      shareBtn.disabled = false
      idEl.disabled = false
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

  idEl.addEventListener('click', async () => {
    if (!code) return
    const ok = await copyToClipboard(code)
    subtitleEl.textContent = ok ? 'Copied to clipboard.' : `Copy manually: ${code}`
  })

  shareBtn.addEventListener('click', async () => {
    if (!code) return
    const text = `Let's talk on One on One.\n\nDownload the app on Google Play:\nhttps://play.google.com/store/apps/details?id=app.web.oneonone\n\nOr use it on the web:\nhttps://one-on-one-mu.vercel.app\n\nMy connection ID: ${code}`
    if (navigator.share) {
      try { await navigator.share({ title: 'One on One', text }) }
      catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) subtitleEl.textContent = 'Could not share. Tap your ID to copy it.'
      }
    } else {
      const copied = await copyToClipboard(text)
      subtitleEl.textContent = copied ? 'Share message copied. Paste it into your preferred app.' : `Copy your ID manually: ${code}`
    }
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

  root.querySelector<HTMLButtonElement>('#delete-account-btn')!.addEventListener('click', () => {
    openDeleteAccountDialog()
  })

  return () => clearInterval(interval)
}
