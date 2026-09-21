// Appearance settings: chat wallpaper, message style (line/bubbles), and
// bubble-mode light/dark theme.
//
// Wallpaper and message style are both shared per-connection (either
// member's choice applies to both — synced server-side via
// connectionsApi.setWallpaper / setMessageStyle, owned by ChatPage.ts) — NOT
// stored here. Theme stays a per-device localStorage preference, same as
// before.

import { pushBackHandler } from '../state/backHandlers'
import { openPanel } from '../state/activePanel'

interface Appearance {
  theme: 'light' | 'dark'
}

const KEY = 'appearancePreview'
const DEFAULT: Appearance = { theme: 'dark' }

function read(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Appearance> | null
    if (saved) return { ...DEFAULT, ...saved }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT }
}

function write(a: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a))
  } catch {
    /* ignore */
  }
}

export function applyAppearance(chat: HTMLElement, wallpaper: string, style: string): void {
  chat.classList.toggle('chat--wallpaper-love', wallpaper === 'love')
  chat.classList.toggle('chat--wallpaper-samurai', wallpaper === 'samurai')
  chat.classList.toggle('chat--bubbles', style === 'bubbles')
  chat.dataset.theme = read().theme
}

// The one open appearance panel's teardown (panel + its outside-click
// listener), so re-opening or a page cleanup can't leak it.
let activeAppearanceDispose: (() => void) | null = null

export function closeAppearance(): void {
  activeAppearanceDispose?.()
  activeAppearanceDispose = null
}

// Small popover anchored to the nav (reuses the .menu positioning).
// `wallpaper` and `style` are the connection's current (shared) values;
// `onWallpaperChange` / `onStyleChange` persist a new choice server-side —
// this module never writes either locally. `trigger` is the button that
// opens/closes this panel — used for the outside-click test so taps
// elsewhere in the nav (call buttons, the ••• menu) count as "outside" and
// close it, instead of the whole `anchor` nav being treated as part of the
// panel.
export function openAppearance(
  anchor: HTMLElement,
  trigger: HTMLElement,
  chat: HTMLElement,
  wallpaper: string,
  style: string,
  onWallpaperChange: (value: string) => void,
  onStyleChange: (value: string) => void,
): void {
  const panel = document.createElement('div')
  panel.className = 'menu appearance'
  panel.innerHTML = `
    <div class="menu__group-label">WALLPAPER (shared)</div>
    <div class="appearance__row" data-group="wallpaper">
      <button class="appearance__opt" data-value="off">Off</button>
      <button class="appearance__opt" data-value="love">Love</button>
      <button class="appearance__opt" data-value="samurai">Samurai</button>
    </div>
    <div class="menu__divider"></div>
    <div class="menu__group-label">MESSAGE STYLE (shared)</div>
    <div class="appearance__row" data-group="style">
      <button class="appearance__opt" data-value="line">Line</button>
      <button class="appearance__opt" data-value="bubbles">Bubbles</button>
    </div>
    <div class="menu__divider"></div>
    <div class="menu__group-label">THEME</div>
    <div class="appearance__row" data-group="theme">
      <button class="appearance__opt" data-value="light">Light</button>
      <button class="appearance__opt" data-value="dark">Dark</button>
    </div>
  `
  anchor.appendChild(panel)

  let currentWallpaper = wallpaper
  let currentStyle = style

  const mark = (): void => {
    const theme = read().theme
    for (const btn of panel.querySelectorAll<HTMLButtonElement>('.appearance__opt')) {
      const group = btn.closest<HTMLElement>('[data-group]')!.dataset.group
      const active =
        group === 'wallpaper'
          ? currentWallpaper === btn.dataset.value
          : group === 'style'
            ? currentStyle === btn.dataset.value
            : theme === btn.dataset.value
      btn.classList.toggle('appearance__opt--active', active)
    }
  }
  mark()

  panel.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.appearance__opt')
    if (!btn) return
    const group = btn.closest<HTMLElement>('[data-group]')!.dataset.group
    const value = btn.dataset.value!
    if (group === 'wallpaper') {
      currentWallpaper = value
      onWallpaperChange(value)
      mark()
      return
    }
    if (group === 'style') {
      currentStyle = value
      onStyleChange(value)
      applyAppearance(chat, currentWallpaper, currentStyle)
      mark()
      return
    }
    write({ theme: value as Appearance['theme'] })
    applyAppearance(chat, currentWallpaper, currentStyle)
    mark()
  })

  const onOutside = (e: MouseEvent): void => {
    if (!panel.contains(e.target as Node) && e.target !== trigger) closeAppearance()
  }
  setTimeout(() => document.addEventListener('click', onOutside), 0)

  const unregisterBack = pushBackHandler(() => {
    closeAppearance()
    return true
  })
  const unregisterPanel = openPanel(closeAppearance)

  activeAppearanceDispose = () => {
    panel.remove()
    document.removeEventListener('click', onOutside)
    unregisterBack()
    unregisterPanel()
  }
}
