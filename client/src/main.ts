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
import { getSession } from './services/authService'
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

// Registers the push-notification service worker; harmless no-op in
// browsers that don't support it.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js')
}

async function resolveInitialScreen(): Promise<Screen> {
  const session = await getSession()
  if (!session) return 'login'

  const current = await getCurrentConnection()
  if (!current) return 'connection-id'

  if (current.status === 'pending') return current.isRequester ? 'waiting' : 'request'
  return current.otherNickname ? 'chat' : 'nickname'
}

const initialScreen = await resolveInitialScreen()
mountRouter(document.querySelector<HTMLDivElement>('#app')!, initialScreen)
