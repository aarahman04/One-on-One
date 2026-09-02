import type { Page } from '../state/router'
import { signInWithGoogle, signOut } from '../services/authService'

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
      <button type="button" class="screen__alt" id="switch-account-btn">Use a different account</button>
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

  // Clear any lingering session, then relaunch Google with its account picker
  // forced so a different account can actually be chosen.
  root.querySelector<HTMLButtonElement>('#switch-account-btn')!.addEventListener('click', async () => {
    try {
      await signOut()
      await signInWithGoogle(true)
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Could not switch accounts. Try again.'
      errorEl.style.display = 'block'
    }
  })
}
