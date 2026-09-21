import './styles/global.css'
import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { mountRouter, registerPage, type Screen } from './state/router'
import { LoginPage } from './pages/LoginPage'
import { ConnectionIdPage } from './pages/ConnectionIdPage'
import { ConnectPage } from './pages/ConnectPage'
import { WaitingPage } from './pages/WaitingPage'
import { ConnectionRequestPage } from './pages/ConnectionRequestPage'
import { NicknamePage } from './pages/NicknamePage'
import { ChatPage } from './pages/ChatPage'
import { ExportPage } from './pages/ExportPage'
import { LeavePage } from './pages/LeavePage'
import { PrivacyPage } from './pages/PrivacyPage'
import { TermsPage } from './pages/TermsPage'
import { ChildSafetyPage } from './pages/ChildSafetyPage'
import { DeleteAccountPage } from './pages/DeleteAccountPage'
import { onSignedOut, signOut } from './services/authService'
import { setUnauthorizedHandler } from './services/apiClient'
import { resolveScreenForSession } from './state/boot'
import { ensureFirstRunGates } from './features/ageGate'
import { installNativeBackButton } from './features/nativeBack'
import { withTimeout } from './utils/withTimeout'

// --- Splash (see index.html for the markup, capacitor.config.ts for the
// native plugin config) ---------------------------------------------------
// Native shows the platform splash (Theme.SplashScreen, launchAutoHide:
// false) before the WebView even loads, so the in-app HTML splash would only
// double up behind it — remove it immediately there and drive the native
// splash instead. Web has no platform splash, so the HTML one covers the
// whole gap from first paint through boot routing.
const SPLASH_START = performance.now()
const SPLASH_MIN_MS = 1500
const SPLASH_MAX_MS = 3000
const isNative = Capacitor.isNativePlatform()
const splashEl = isNative ? null : document.getElementById('splash')
if (isNative) document.getElementById('splash')?.remove()

let splashHidden = false
function hideSplash(): void {
  if (splashHidden) return
  splashHidden = true
  if (isNative) {
    void SplashScreen.hide({ fadeOutDuration: 250 })
    return
  }
  if (!splashEl) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    splashEl.remove()
    return
  }
  let done = false
  const finish = (): void => {
    if (done) return
    done = true
    splashEl.remove()
  }
  splashEl.addEventListener('transitionend', finish, { once: true })
  setTimeout(finish, 300)
  splashEl.classList.add('splash--out')
}

// Hard cap — the splash must never outlast this, however long boot takes.
setTimeout(hideSplash, SPLASH_MAX_MS)

// Call once the first real screen has mounted. Enforces the ~1.5s minimum
// display so a near-instant boot doesn't just flash the splash; adds no wait
// once SPLASH_MIN_MS has already elapsed.
function scheduleSplashHide(): void {
  const elapsed = performance.now() - SPLASH_START
  setTimeout(hideSplash, Math.max(SPLASH_MIN_MS - elapsed, 0))
}

registerPage('login', LoginPage)
registerPage('connection-id', ConnectionIdPage)
registerPage('connect', ConnectPage)
registerPage('waiting', WaitingPage)
registerPage('request', ConnectionRequestPage)
registerPage('nickname', NicknamePage)
registerPage('chat', ChatPage)
registerPage('export', ExportPage)
registerPage('leave', LeavePage)
registerPage('privacy', PrivacyPage)
registerPage('terms', TermsPage)
registerPage('child-safety', ChildSafetyPage)
registerPage('delete-account', DeleteAccountPage)

void installNativeBackButton()

// Public legal routes: reachable without a session and without tripping the
// age / consent gate. Matched by path before any auth work below.
const LEGAL_ROUTES: Record<string, Screen> = {
  '/privacy': 'privacy',
  '/terms': 'terms',
  '/child-safety': 'child-safety',
  '/delete-account': 'delete-account',
}

// iOS Safari doesn't reflow the layout viewport when the keyboard opens — it
// shifts the *visual* viewport instead (resizing it, and offsetting it from
// the top of the layout viewport). #app, sized by plain height (dvh/vh), has
// no way to know about that offset, so it stays anchored to the top of the
// now-scrolled-away layout viewport — leaving a gap of page background
// between the composer and the keyboard until something forces a recompute.
// Track both the size AND position of the true visible area ourselves via
// visualViewport, and pin #app (position: fixed in CSS) to exactly that.
function syncViewport(): void {
  const vv = window.visualViewport
  document.documentElement.style.setProperty('--app-height', `${vv?.height ?? window.innerHeight}px`)
  document.documentElement.style.setProperty('--app-offset-top', `${vv?.offsetTop ?? 0}px`)
}
syncViewport()
window.visualViewport?.addEventListener('resize', syncViewport)
window.visualViewport?.addEventListener('scroll', syncViewport)
window.addEventListener('resize', syncViewport)

// Last-resort visibility for otherwise-silent failures.
window.addEventListener('unhandledrejection', (e) => console.error('unhandledrejection:', e.reason))
window.addEventListener('error', (e) => console.error('window error:', e.error ?? e.message))

// A 401 from the API (revoked/rotated session) → sign out and reload to login.
setUnauthorizedHandler(() => {
  void signOut()
  location.assign('/')
})

// Registers the push-notification service worker; harmless no-op in
// browsers that don't support it. Catch so a failed registration isn't an
// unhandled rejection. Skipped on the native (Capacitor) build — assets ship
// in the APK and Android WebView SW support is unreliable; native push
// arrives via FCM instead.
if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

// An OAuth redirect can return an error in the query (?error=…) or the hash
// (#error=…&error_description=…). Stash it for LoginPage and clean the URL.
function captureOAuthError(): boolean {
  const q = new URLSearchParams(location.search)
  const h = new URLSearchParams(location.hash.replace(/^#/, ''))
  const err = q.get('error') ?? h.get('error')
  if (!err) return false
  const desc = q.get('error_description') ?? h.get('error_description')
  try {
    sessionStorage.setItem('oauthError', (desc ?? err).replace(/\+/g, ' '))
  } catch {
    /* private mode — login just won't show the reason */
  }
  history.replaceState(null, '', location.pathname)
  return true
}

const hadOAuthError = captureOAuthError()

const app = document.querySelector<HTMLDivElement>('#app')!
const legalScreen = LEGAL_ROUTES[location.pathname]
if (legalScreen) {
  mountRouter(app, legalScreen)
  scheduleSplashHide()
} else {
  try {
    const initial = hadOAuthError ? 'login' : await withTimeout(resolveScreenForSession(), 20000)
    // Age (18+) + Terms acceptance before anything else — but not on the login
    // screen itself (a signed-out visitor has nothing to gate yet).
    if (initial !== 'login') await ensureFirstRunGates(app)
    mountRouter(app, initial)
  } catch (err) {
    // A transient network failure (or a hung request past the 20s timeout) on
    // cold load must not leave a blank page — fall back to login with a
    // reason LoginPage's existing oauthError channel can show.
    console.error('startup failed, falling back to login:', err)
    const timedOut = err instanceof Error && err.message === 'timeout'
    try {
      sessionStorage.setItem(
        'oauthError',
        timedOut ? "Couldn't finish signing in. Check your connection and try again." : 'Something went wrong. Try again.',
      )
    } catch {
      /* private mode — login just won't show the reason */
    }
    mountRouter(app, 'login')
  }
  scheduleSplashHide()
}

// Cross-tab sign-out → back to login.
onSignedOut(() => location.assign('/'))
