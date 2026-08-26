import type { Page } from '../state/router'

export const ConnectPage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">CONNECT</div>
      <div class="screen__title">Connection ID</div>
      <input id="id-input" placeholder="K7F29PQ" maxlength="7" style="text-align:center; width:200px; text-transform:uppercase;" />
      <div class="screen__actions">
        <button class="primary" id="connect-btn">Connect</button>
      </div>
    </div>
  `

  root.querySelector<HTMLButtonElement>('#connect-btn')!.addEventListener('click', () => {
    go('request')
  })
}
