import type { Page } from '../state/router'
import { getCurrentConnection, advanceLeave, cancelLeave, confirmEndLeave } from '../services/connectionsApi'

export const LeavePage: Page = (root, go) => {
  root.innerHTML = `<div class="screen"><div class="screen__subtitle">Loading...</div></div>`

  getCurrentConnection()
    .then((current) => {
      if (!current || (current.status !== 'active' && current.status !== 'leave_pending')) {
        go('connection-id')
        return
      }

      const id = current.id
      const errorHtml = `<div class="screen__subtitle" id="leave-error" style="color: var(--danger); display: none;"></div>`
      const showError = (msg: string): void => {
        const el = root.querySelector<HTMLDivElement>('#leave-error')!
        el.textContent = msg
        el.style.display = 'block'
      }

      // Both members are leaving — offer the immediate mutual end.
      if (current.bothLeaving) {
        root.innerHTML = `
          <div class="screen">
            <div class="screen__eyebrow">END CONNECTION</div>
            <div class="screen__title">This conversation is going to end.</div>
            <div class="screen__subtitle">You both chose to leave. You can end it now instead of waiting out the countdown.</div>
            <div class="screen__actions">
              <button id="cancel-btn">Back to chat</button>
              <button id="end-btn" style="border-color: var(--danger); color: var(--danger);">Leave now</button>
            </div>
            ${errorHtml}
          </div>
        `
        root.querySelector<HTMLButtonElement>('#cancel-btn')!.addEventListener('click', () => go('chat'))
        const endBtn = root.querySelector<HTMLButtonElement>('#end-btn')!
        endBtn.addEventListener('click', async () => {
          endBtn.disabled = true
          try {
            await confirmEndLeave(id)
            go('connection-id')
          } catch (err) {
            showError(err instanceof Error ? err.message : 'Failed to end connection.')
            endBtn.disabled = false
          }
        })
        return
      }

      const inProgress = current.myLeaveStep > 0
      const remaining = current.daysRemaining ?? 5
      const cooling = inProgress && !current.canAdvanceLeave

      const dayLabel = `${remaining} ${remaining === 1 ? 'day' : 'days'} remaining`
      const subtitle = inProgress
        ? `You're leaving this connection — ${dayLabel}.`
        : `Leaving is deliberate: five daily steps, one every 24 hours. Either of you can stop it, and no one can be forced out.`
      // The 24h wait is information, not an action — shown as text, not a dead button.
      const note = cooling
        ? `<div class="screen__subtitle" style="opacity:0.7;">Next step available in about 24 hours.</div>`
        : ''

      root.innerHTML = `
        <div class="screen">
          <div class="screen__eyebrow">LEAVE CONNECTION</div>
          <div class="screen__subtitle">${subtitle}</div>
          ${note}
          <div class="screen__actions">
            <button id="cancel-btn">${inProgress ? 'Keep connection' : 'Cancel'}</button>
            <button id="ok-btn" class="primary">OK</button>
          </div>
          ${errorHtml}
        </div>
      `

      const cancelBtn = root.querySelector<HTMLButtonElement>('#cancel-btn')!
      const okBtn = root.querySelector<HTMLButtonElement>('#ok-btn')!

      cancelBtn.addEventListener('click', async () => {
        cancelBtn.disabled = true
        okBtn.disabled = true
        if (inProgress) {
          try {
            await cancelLeave(id)
          } catch {
            /* fall through to chat regardless */
          }
        }
        go('chat')
      })

      okBtn.addEventListener('click', async () => {
        // In the 24h cooldown, OK just returns; otherwise it advances the countdown.
        if (cooling) {
          go('chat')
          return
        }
        cancelBtn.disabled = true
        okBtn.disabled = true
        try {
          const result = await advanceLeave(id)
          go(result.terminated ? 'connection-id' : 'chat')
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Failed to update leave.')
          cancelBtn.disabled = false
          okBtn.disabled = false
        }
      })
    })
    .catch(() => go('connection-id'))
}
