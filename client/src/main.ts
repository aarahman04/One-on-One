import './styles/global.css'
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
import { getSession, onSignedOut, signOut } from './services/authService'
import { setUnauthorizedHandler } from './services/apiClient'
import { getCurrentConnection } from './services/connectionsApi'

registerPage('login', LoginPage)
registerPage('connection-id', ConnectionIdPage)
registerPage('connect', ConnectPage)
registerPage('waiting', WaitingPage)
registerPage('request', ConnectionRequestPage)
registerPage('nickname', NicknamePage)
registerPage('chat', ChatPage)
registerPage('export', ExportPage)
registerPage('leave', LeavePage)

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
// unhandled rejection.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

async function resolveInitialScreen(): Promise<Screen> {
  const session = await getSession()
  if (!session) return 'login'

  const current = await getCurrentConnection()
  if (!current) return 'connection-id'

  if (current.status === 'pending') return current.isRequester ? 'waiting' : 'request'
  return current.otherNickname ? 'chat' : 'nickname'
}

const app = document.querySelector<HTMLDivElement>('#app')!
try {
  mountRouter(app, await resolveInitialScreen())
} catch (err) {
  // A transient network failure on cold load must not leave a blank page.
  console.error('startup failed, falling back to login:', err)
  mountRouter(app, 'login')
}

// Cross-tab sign-out → back to login.
onSignedOut(() => location.assign('/'))
