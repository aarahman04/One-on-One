import './styles/global.css'
import { mountRouter, registerPage } from './state/router'
import { LoginPage } from './pages/LoginPage'
import { ConnectionIdPage } from './pages/ConnectionIdPage'
import { ConnectPage } from './pages/ConnectPage'
import { ConnectionRequestPage } from './pages/ConnectionRequestPage'
import { NicknamePage } from './pages/NicknamePage'
import { ChatPage } from './pages/ChatPage'
import { ExportPage } from './pages/ExportPage'
import { LeavePage } from './pages/LeavePage'
import { getSession } from './services/authService'

registerPage('login', LoginPage)
registerPage('connection-id', ConnectionIdPage)
registerPage('connect', ConnectPage)
registerPage('request', ConnectionRequestPage)
registerPage('nickname', NicknamePage)
registerPage('chat', ChatPage)
registerPage('export', ExportPage)
registerPage('leave', LeavePage)

const session = await getSession()
mountRouter(document.querySelector<HTMLDivElement>('#app')!, session ? 'connection-id' : 'login')
