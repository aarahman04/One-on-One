import type { Page } from '../state/router'
import { getCurrentConnection } from '../services/connectionsApi'

const POLL_INTERVAL_MS = 2500

export const WaitingPage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">CONNECTION REQUEST SENT</div>
      <div class="screen__subtitle">Waiting for them to accept.</div>
    </div>
  `

  const poll = async (): Promise<void> => {
    const current = await getCurrentConnection()

    if (!current) {
      go('connection-id')
      return
    }

    if (current.status === 'active') {
      go(current.otherNickname ? 'chat' : 'nickname')
    }
  }

  const interval = setInterval(() => {
    poll().catch(() => {})
  }, POLL_INTERVAL_MS)

  return () => clearInterval(interval)
}
