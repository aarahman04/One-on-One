import type { Page } from '../state/router'

export const ConnectionRequestPage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">CONNECTION REQUEST</div>
      <div class="connection-id" style="font-size:24px;">K7F29PQ</div>
      <div class="screen__subtitle">wants to connect with you.</div>
      <div class="screen__actions">
        <button class="primary" id="accept-btn">Accept</button>
        <button id="decline-btn">Decline</button>
      </div>
    </div>
  `

  root.querySelector<HTMLButtonElement>('#accept-btn')!.addEventListener('click', () => {
    go('nickname')
  })

  root.querySelector<HTMLButtonElement>('#decline-btn')!.addEventListener('click', () => {
    go('connect')
  })
}
