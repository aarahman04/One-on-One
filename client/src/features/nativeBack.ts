import { Capacitor } from '@capacitor/core'
import { runBackHandlers } from '../state/backHandlers'
import { getCurrentScreen, goBackScreen } from '../state/router'

const LEGAL_SCREENS = new Set(['privacy', 'terms', 'child-safety', 'delete-account'])

// Android hardware / gesture back. Once a JS listener exists, @capacitor/app
// does nothing on its own, so every branch here must end the press: close
// the newest transient surface, else step the screen back, else (legal page
// reached by an in-WebView link) walk WebView history, else background the
// app. minimizeApp, not exitApp — keeps the socket alive for a fast resume.
export async function installNativeBackButton(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const { App } = await import('@capacitor/app')
  await App.addListener('backButton', ({ canGoBack }) => {
    if (runBackHandlers()) return
    if (goBackScreen()) return
    const screen = getCurrentScreen()
    if (screen && LEGAL_SCREENS.has(screen)) {
      if (canGoBack) history.back()
      else location.assign('/')
      return
    }
    void App.minimizeApp()
  })
}
