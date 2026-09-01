import { openModal } from '../components/Modal'

export interface CountdownPayload {
  label: string
  targetIso: string
}

// Composer: label + target date/time. One step — unlike /letter, there's no
// long-form body to preview, so write-then-preview would be pure overhead.
export function openCountdownComposer(opts: { onSend: (label: string, payload: CountdownPayload) => void }): void {
  const { onSend } = opts
  const container = document.createElement('div')
  container.className = 'countdown-compose'
  container.innerHTML = `
    <div class="msg-compose__title">Start a countdown</div>
    <input id="countdown-label" class="msg-compose__field" placeholder="What are we counting down to?" maxlength="100" />
    <input id="countdown-target" class="msg-compose__field" type="datetime-local" />
    <div class="msg-compose__actions">
      <button type="button" id="countdown-cancel">Cancel</button>
      <button type="button" id="countdown-send" class="primary">Start countdown</button>
    </div>
  `
  const modal = openModal(container)
  const labelEl = container.querySelector<HTMLInputElement>('#countdown-label')!
  const targetEl = container.querySelector<HTMLInputElement>('#countdown-target')!
  targetEl.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  labelEl.focus()

  container.querySelector('#countdown-cancel')!.addEventListener('click', () => modal.close())
  container.querySelector('#countdown-send')!.addEventListener('click', () => {
    const label = labelEl.value.trim()
    if (!label) {
      labelEl.focus()
      return
    }
    const target = new Date(targetEl.value)
    if (!targetEl.value || Number.isNaN(target.getTime())) {
      targetEl.focus()
      return
    }
    onSend(label, { label, targetIso: target.toISOString() })
    modal.close()
  })
}

// Shared by the chat card's live ticker. "Now" once the target has passed —
// the card stays in the log as a keepsake, it doesn't disappear or error.
export function formatCountdown(targetIso: string): string {
  const diffMs = new Date(targetIso).getTime() - Date.now()
  if (diffMs <= 0) return 'Now'
  const totalSeconds = Math.floor(diffMs / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  return `${minutes}m ${seconds}s`
}
