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
            <div class="screen__title">This conversation<br />is going to end.</div>
            <div class="screen__subtitle">You both chose to leave. You can end it now instead of waiting out the countdown.</div>
            <div class="screen__actions">
              <button id="cancel-btn">Back to chat</button>
              <button id="end-btn" style="border-color: var(--danger); color: var(--danger);">Do you want to leave it?</button>
            </div>
            ${errorHtml}
          </div>
        `
        root.querySelector<HTMLButtonElement>('#cancel-btn')!.addEventListener('click', () => go('chat'))
        root.querySelector<HTMLButtonElement>('#end-btn')!.addEventListener('click', async () => {
          try {
            await confirmEndLeave(id)
            go('connection-id')
          } catch (err) {
            showError(err instanceof Error ? err.message : 'Failed to end connection.')
          }
        })
        return
      }

      const inProgress = current.myLeaveStep > 0
      const remaining = current.daysRemaining ?? 5

      const stateLine = inProgress
        ? `You're leaving — <strong>${remaining} ${remaining === 1 ? 'day' : 'days'} remaining</strong>.`
        : `Leaving is deliberate: 5 steps, one every 24 hours. Either of you can stop it, and no one can be forced out.`

      const advanceLabel = inProgress ? `Continue leaving (${remaining} left)` : 'Leave connection'
      const advanceBtn = current.canAdvanceLeave
        ? `<button id="advance-btn" style="border-color: var(--danger); color: var(--danger);">${advanceLabel}</button>`
        : `<button disabled>Next step available in ~24h</button>`

      root.innerHTML = `
        <div class="screen">
          <div class="screen__eyebrow">LEAVE CONNECTION</div>
          <div class="screen__subtitle">${stateLine}</div>
          <div class="screen__actions">
            <button id="cancel-btn">${inProgress ? 'Keep connection' : 'Cancel'}</button>
            ${advanceBtn}
          </div>
          ${errorHtml}
        </div>
      `

      root.querySelector<HTMLButtonElement>('#cancel-btn')!.addEventListener('click', async () => {
        if (inProgress) {
          try {
            await cancelLeave(id)
          } catch {
            /* fall through to chat regardless */
          }
        }
        go('chat')
      })

      const advance = root.querySelector<HTMLButtonElement>('#advance-btn')
      advance?.addEventListener('click', async () => {
        try {
          const result = await advanceLeave(id)
          if (result.terminated) {
            go('connection-id')
          } else {
            go('chat')
          }
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Failed to update leave.')
        }
      })
    })
    .catch(() => go('connection-id'))
}
