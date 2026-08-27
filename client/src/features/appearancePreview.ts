// Appearance settings: chat wallpaper, message style (line/bubbles), and
// bubble-mode light/dark theme.
//
// Wallpaper is shared per-connection (either member's choice applies to
// both — synced server-side via connectionsApi.setWallpaper, owned by
// ChatPage.ts) — NOT stored here. Style and theme stay per-device
// localStorage preferences, same as before.

interface Appearance {
  style: 'line' | 'bubbles'
  theme: 'light' | 'dark'
}

const KEY = 'appearancePreview'
const DEFAULT: Appearance = { style: 'bubbles', theme: 'dark' }

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

export function applyAppearance(chat: HTMLElement, wallpaper: string): void {
  const a = read()
  chat.classList.toggle('chat--wallpaper-1', wallpaper === '1')
  chat.classList.toggle('chat--wallpaper-2', wallpaper === '2')
  chat.classList.toggle('chat--wallpaper-love', wallpaper === 'love')
  chat.classList.toggle('chat--bubbles', a.style === 'bubbles')
  chat.dataset.theme = a.theme
}

// Small popover anchored to the nav (reuses the .menu positioning).
// `wallpaper` is the connection's current (shared) value; `onWallpaperChange`
// persists a new choice server-side — this module never writes it locally.
export function openAppearance(
  anchor: HTMLElement,
  chat: HTMLElement,
  wallpaper: string,
  onWallpaperChange: (value: string) => void,
): void {
  const existing = anchor.querySelector('.appearance')
  if (existing) {
    existing.remove()
    return
  }

  const panel = document.createElement('div')
  panel.className = 'menu appearance'
  panel.innerHTML = `
    <div class="menu__group-label">WALLPAPER (shared)</div>
    <div class="appearance__row" data-group="wallpaper">
      <button class="appearance__opt" data-value="off">Off</button>
      <button class="appearance__opt" data-value="1">1</button>
      <button class="appearance__opt" data-value="2">2</button>
      <button class="appearance__opt" data-value="love">Love</button>
    </div>
    <div class="menu__divider"></div>
    <div class="menu__group-label">MESSAGE STYLE</div>
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

  const mark = (): void => {
    const cur = read()
    for (const btn of panel.querySelectorAll<HTMLButtonElement>('.appearance__opt')) {
      const group = btn.closest<HTMLElement>('[data-group]')!.dataset.group
      const active = group === 'wallpaper' ? currentWallpaper === btn.dataset.value : cur[group as keyof Appearance] === btn.dataset.value
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
    write({ ...read(), [group as keyof Appearance]: value } as Appearance)
    applyAppearance(chat, currentWallpaper)
    mark()
  })

  const onOutside = (e: MouseEvent): void => {
    if (!panel.contains(e.target as Node) && e.target !== anchor) {
      panel.remove()
      document.removeEventListener('click', onOutside)
    }
  }
  setTimeout(() => document.addEventListener('click', onOutside), 0)
}
