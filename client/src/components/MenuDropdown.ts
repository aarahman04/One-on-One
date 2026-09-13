import { Capacitor } from '@capacitor/core'
import type { Screen } from '../state/router'
import { animateOutAndRemove } from '../utils/animateOut'
import { pushBackHandler } from '../state/backHandlers'

export function mountMenuDropdown(
  nav: HTMLElement,
  anchor: HTMLButtonElement,
  go: (screen: Screen) => void,
  onSearch?: () => void,
  onAppearance?: () => void,
  onNotifications?: () => void,
  onBlock?: () => void,
  onDeleteAccount?: () => void,
): () => void {
  let panel: HTMLDivElement | null = null
  let unregisterBack: (() => void) | null = null

  const close = (): void => {
    if (!panel) return
    animateOutAndRemove(panel, 'menu--closing')
    panel = null
    document.removeEventListener('click', onOutsideClick)
    unregisterBack?.()
    unregisterBack = null
  }

  const onOutsideClick = (e: MouseEvent): void => {
    if (panel && !panel.contains(e.target as Node) && e.target !== anchor) close()
  }

  const onAnchorClick = (e: MouseEvent): void => {
    e.stopPropagation()
    if (panel) {
      close()
      return
    }

    panel = document.createElement('div')
    panel.className = 'menu'
    panel.innerHTML = `
      <div class="menu__group-label">CONNECTION</div>
      <button class="menu__item" data-action="rename">Rename connection</button>
      <div class="menu__divider"></div>
      <div class="menu__group-label">CONVERSATION</div>
      <button class="menu__item" data-action="export">Export</button>
      <button class="menu__item" data-action="search"${onSearch ? '' : ' disabled'}>Search</button>
      ${onAppearance ? '<button class="menu__item" data-action="appearance">Appearance</button>' : ''}
      ${onNotifications ? '<button class="menu__item" data-action="notifications">Notifications</button>' : ''}
      <div class="menu__divider"></div>
      <button class="menu__item menu__item--danger" data-action="leave">Leave connection</button>
      ${onBlock ? '<button class="menu__item menu__item--danger" data-action="block">Block &amp; end</button>' : ''}
      ${onDeleteAccount ? '<button class="menu__item menu__item--danger" data-action="delete-account">Delete account</button>' : ''}
      <div class="menu__divider"></div>
      <div class="menu__group-label">ABOUT</div>
      <button class="menu__item" data-action="privacy">Privacy Policy</button>
      <button class="menu__item" data-action="terms">Terms</button>
      <button class="menu__item" data-action="child-safety">Child Safety</button>
    `
    nav.appendChild(panel)

    panel.querySelector('[data-action="rename"]')!.addEventListener('click', () => {
      close()
      go('nickname')
    })
    panel.querySelector('[data-action="export"]')!.addEventListener('click', () => {
      close()
      go('export')
    })
    if (onSearch) {
      panel.querySelector('[data-action="search"]')!.addEventListener('click', () => {
        close()
        onSearch()
      })
    }
    if (onAppearance) {
      panel.querySelector('[data-action="appearance"]')!.addEventListener('click', () => {
        close()
        onAppearance()
      })
    }
    if (onNotifications) {
      panel.querySelector('[data-action="notifications"]')!.addEventListener('click', () => {
        close()
        onNotifications()
      })
    }
    panel.querySelector('[data-action="leave"]')!.addEventListener('click', () => {
      close()
      go('leave')
    })
    if (onBlock) {
      panel.querySelector('[data-action="block"]')!.addEventListener('click', () => {
        close()
        onBlock()
      })
    }
    if (onDeleteAccount) {
      panel.querySelector('[data-action="delete-account"]')!.addEventListener('click', () => {
        close()
        onDeleteAccount()
      })
    }
    // Web: new tab so the conversation stays put. Native: same WebView — the
    // Capacitor local server SPA-falls back to index.html for /privacy etc.
    // (html5mode), and hardware back walks the WebView history home.
    for (const route of ['privacy', 'terms', 'child-safety'] as const) {
      panel.querySelector(`[data-action="${route}"]`)!.addEventListener('click', () => {
        close()
        if (Capacitor.isNativePlatform()) location.assign(`/${route}`)
        else window.open(`/${route}`, '_blank', 'noopener')
      })
    }

    document.addEventListener('click', onOutsideClick)
    unregisterBack = pushBackHandler(() => {
      close()
      return true
    })
  }

  anchor.addEventListener('click', onAnchorClick)

  return () => {
    close()
    anchor.removeEventListener('click', onAnchorClick)
  }
}
