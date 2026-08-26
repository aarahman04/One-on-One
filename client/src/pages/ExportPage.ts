import type { Page } from '../state/router'
import { fakeMessages } from '../utils/fakeMessages'

export const ExportPage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">EXPORT CONVERSATION</div>
      <div class="screen__subtitle">Messages: ${fakeMessages.length}<br />Connection started: 26 August 2026</div>
      <div class="screen__actions">
        <button class="primary" id="export-txt">Export TXT</button>
        <button id="export-json">Export JSON</button>
      </div>
      <div class="screen__actions">
        <button id="back-btn">Back</button>
      </div>
    </div>
  `

  root.querySelector<HTMLButtonElement>('#back-btn')!.addEventListener('click', () => go('chat'))
}
