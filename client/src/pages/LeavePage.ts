import type { Page } from '../state/router'

export const LeavePage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">LEAVE CONNECTION</div>
      <div class="screen__subtitle">Ending this connection starts a 5-day countdown. Either of you can cancel before it expires.</div>
      <div class="screen__actions">
        <button id="cancel-btn">Cancel</button>
        <button id="leave-btn" style="border-color: var(--danger); color: var(--danger);">Leave Connection</button>
      </div>
    </div>
  `

  root.querySelector<HTMLButtonElement>('#cancel-btn')!.addEventListener('click', () => go('chat'))

  root.querySelector<HTMLButtonElement>('#leave-btn')!.addEventListener('click', () => {
    root.innerHTML = `
      <div class="screen">
        <div class="screen__eyebrow">CONNECTION TERMINATION REQUEST</div>
        <div class="screen__subtitle">Leave request sent.<br />5 days remaining.</div>
        <div class="screen__actions">
          <button id="back-btn">Back to chat</button>
        </div>
      </div>
    `
    root.querySelector<HTMLButtonElement>('#back-btn')!.addEventListener('click', () => go('chat'))
  })
}
