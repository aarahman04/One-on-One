import type { Page } from '../state/router'

export const NicknamePage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">CONNECTION ACCEPTED</div>
      <div class="screen__title">What would you like<br />to call this person?</div>
      <input id="nickname-input" placeholder="Arjun" style="text-align:center; width:220px;" />
      <div class="screen__actions">
        <button class="primary" id="save-btn">Save</button>
      </div>
    </div>
  `

  root.querySelector<HTMLButtonElement>('#save-btn')!.addEventListener('click', () => {
    go('chat')
  })
}
