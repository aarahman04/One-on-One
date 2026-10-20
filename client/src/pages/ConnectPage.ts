import type { Page } from '../state/router'
import { requestConnection } from '../services/connectionsApi'

export const ConnectPage: Page = (root, go) => {
  root.innerHTML = `
    <div class="screen">
      <div class="screen__title">Enter their ID</div>
      <div class="screen__subtitle">Paste the ID they shared with you.</div>
      <input id="id-input" class="screen__input screen__input--code" aria-label="Their connection ID" placeholder="8-character ID" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" />
      <div class="screen__actions">
        <button type="button" id="paste-btn">Paste</button>
        <button class="primary" id="connect-btn" disabled>Connect</button>
      </div>
      <button type="button" class="screen__alt" id="back-btn">Back</button>
      <div class="screen__subtitle screen__error" id="error"></div>
    </div>
  `

  const input = root.querySelector<HTMLInputElement>('#id-input')!
  const errorEl = root.querySelector<HTMLDivElement>('#error')!
  const button = root.querySelector<HTMLButtonElement>('#connect-btn')!
  const paste = root.querySelector<HTMLButtonElement>('#paste-btn')!
  const back = root.querySelector<HTMLButtonElement>('#back-btn')!
  let disposed = false, busy = false
  const update = () => {
    input.value = input.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8)
    button.disabled = busy || input.value.length !== 8
  }
  input.addEventListener('input', update)
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); button.click() } })
  back.addEventListener('click', () => go('connection-id'))
  paste.addEventListener('click', async () => {
    try { const text = await navigator.clipboard.readText(); if (!disposed) { input.value = text; update(); input.focus() } }
    catch { if (!disposed) { errorEl.textContent = 'Paste the ID into the box above.'; errorEl.style.display = 'block' } }
  })

  button.addEventListener('click', async () => {
    errorEl.style.display = 'none'
    busy = true; update(); paste.disabled = back.disabled = true
    try {
      await requestConnection(input.value.trim())
      if (!disposed) go('waiting')
    } catch (err) {
      if (disposed) return
      errorEl.textContent = err instanceof Error ? err.message : 'Failed to connect.'
      errorEl.style.display = 'block'
    } finally {
      busy = false; update(); paste.disabled = back.disabled = false
    }
  })
  return () => { disposed = true }
}
