import type { Page } from '../state/router'
import { cancelRequest, getCurrentConnection } from '../services/connectionsApi'
import { nextScreenFor } from '../state/nextScreen'

const POLL_INTERVAL_MS = 2500

export const WaitingPage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">CONNECTION REQUEST SENT</div>
      <div class="screen__subtitle">Waiting for them to accept.</div>
      <div class="screen__actions">
        <button id="cancel-btn">Cancel request</button>
      </div>
    </div>
  `

  let connectionId: string | null = null
  let cancelled = false

  const cancelBtn = root.querySelector<HTMLButtonElement>('#cancel-btn')!
  cancelBtn.addEventListener('click', async () => {
    if (!connectionId) return
    cancelBtn.disabled = true
    try {
      await cancelRequest(connectionId)
      cancelled = true
      go('connection-id')
    } catch {
      cancelBtn.disabled = false
    }
  })

  const poll = async (): Promise<void> => {
    if (cancelled) return
    const current = await getCurrentConnection()

    if (!current) {
      go('connection-id')
      return
    }
    connectionId = current.id

    const next = nextScreenFor(current)
    if (next !== 'waiting') go(next)
  }

  void poll()
  const interval = setInterval(() => {
    poll().catch(() => {})
  }, POLL_INTERVAL_MS)

  return () => clearInterval(interval)
}
