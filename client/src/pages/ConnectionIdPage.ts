import type { Page } from '../state/router'
import { generateConnectionId } from '../utils/fakeData'

export const ConnectionIdPage: Page = (root, go) => {
  const connectionId = generateConnectionId()

  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">YOUR CONNECTION ID</div>
      <div class="connection-id">${connectionId}</div>
      <div class="screen__actions">
        <button id="copy-btn">Copy</button>
      </div>
      <div class="screen__subtitle">Give this ID to the person you want to connect with.</div>
      <div class="screen__actions">
        <button class="primary" id="continue-btn">I have an ID to connect with</button>
      </div>
    </div>
  `

  root.querySelector<HTMLButtonElement>('#copy-btn')!.addEventListener('click', async () => {
    await navigator.clipboard.writeText(connectionId)
  })

  root.querySelector<HTMLButtonElement>('#continue-btn')!.addEventListener('click', () => {
    go('connect')
  })
}
