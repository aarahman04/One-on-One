import type { Page } from '../state/router'

export const LoginPage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">ONE</div>
      <div class="screen__title">one connection.<br />nothing else.</div>
      <div class="screen__actions">
        <button class="primary" id="login-btn">Continue with Google</button>
      </div>
    </div>
  `

  root.querySelector<HTMLButtonElement>('#login-btn')!.addEventListener('click', () => {
    go('connection-id')
  })
}
