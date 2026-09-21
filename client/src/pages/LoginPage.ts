import type { Page } from '../state/router'
import { signInWithGoogle } from '../services/authService'
import { goToPostSignInScreen } from '../state/boot'
import { withTimeout } from '../utils/withTimeout'

// A device that has ever signed in gets Google's account picker forced
// (instead of silently reusing the last account) — no separate "use a
// different account" control on this screen: nobody is signed in here yet,
// so a control framed around switching *away* from an account never makes
// sense on this page.
const HAS_SIGNED_IN_KEY = 'hasSignedInBefore'

export const LoginPage: Page = (root, go) => {
  let oauthError: string | null = null
  try {
    oauthError = sessionStorage.getItem('oauthError')
    if (oauthError) sessionStorage.removeItem('oauthError')
  } catch {
    /* ignore */
  }

  let hasSignedInBefore = false
  try {
    hasSignedInBefore = localStorage.getItem(HAS_SIGNED_IN_KEY) === '1'
  } catch {
    /* private mode — treat as a new device */
  }

  root.innerHTML = `
    <div class="screen">
      <div class="screen__eyebrow">ONE</div>
      <div class="screen__title">one connection. nothing else.</div>
      <div class="screen__actions">
        <button class="primary" id="login-btn">Continue with Google</button>
      </div>
      <div class="screen__subtitle screen__error" id="login-error"></div>
      <div class="screen__legal">
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms</a>
        <a href="/child-safety">Child Safety</a>
      </div>
    </div>
  `

  const errorEl = root.querySelector<HTMLDivElement>('#login-error')!
  if (oauthError) {
    errorEl.textContent = oauthError
    errorEl.style.display = 'block'
  }

  const loginBtn = root.querySelector<HTMLButtonElement>('#login-btn')!
  const DEFAULT_LABEL = loginBtn.textContent!

  // signInWithGoogle resolves true only on the native path, which signs in
  // without navigating anywhere — so nothing re-runs the boot routing and this
  // screen has to move itself. On web it returns false mid-redirect and the
  // reload does the routing (the button stays disabled through the redirect).
  loginBtn.addEventListener('click', async () => {
    loginBtn.disabled = true
    loginBtn.textContent = 'Signing in…'
    errorEl.style.display = 'none'
    try {
      if (await withTimeout(signInWithGoogle(hasSignedInBefore), 20000)) {
        await goToPostSignInScreen(root, go)
        return
      }
      loginBtn.disabled = false
      loginBtn.textContent = DEFAULT_LABEL
    } catch (err) {
      const timedOut = err instanceof Error && err.message === 'timeout'
      errorEl.textContent = timedOut
        ? 'Sign-in is taking too long. Try again.'
        : err instanceof Error
          ? err.message
          : 'Sign-in failed. Try again.'
      errorEl.style.display = 'block'
      loginBtn.disabled = false
      loginBtn.textContent = DEFAULT_LABEL
    }
  })
}
