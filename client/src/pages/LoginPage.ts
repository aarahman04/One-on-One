import type { Page } from '../state/router'
import { signInWithGoogle } from '../services/authService'

export const LoginPage: Page = (root) => {
  let oauthError: string | null = null
  try {
    oauthError = sessionStorage.getItem('oauthError')
    if (oauthError) sessionStorage.removeItem('oauthError')
  } catch {
    /* ignore */
  }

  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">ONE</div>
      <div class="screen__title">one connection. nothing else.</div>
      <div class="screen__actions">
        <button class="primary" id="login-btn">Continue with Google</button>
      </div>
      <div class="screen__subtitle" id="login-error" style="color: var(--danger); display: none;"></div>
    </div>
  `

  const errorEl = root.querySelector<HTMLDivElement>('#login-error')!
  if (oauthError) {
    errorEl.textContent = oauthError
    errorEl.style.display = 'block'
  }

  root.querySelector<HTMLButtonElement>('#login-btn')!.addEventListener('click', async () => {
    try {
      await signInWithGoogle()
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Sign-in failed. Try again.'
      errorEl.style.display = 'block'
    }
  })
}
