import type { Screen } from '../state/router'

export function mountMenuDropdown(nav: HTMLElement, anchor: HTMLButtonElement, go: (screen: Screen) => void): void {
  let panel: HTMLDivElement | null = null

  const close = (): void => {
    panel?.remove()
    panel = null
    document.removeEventListener('click', onOutsideClick)
  }

  const onOutsideClick = (e: MouseEvent): void => {
    if (panel && !panel.contains(e.target as Node) && e.target !== anchor) close()
  }

  anchor.addEventListener('click', (e) => {
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
      <button class="menu__item" data-action="search" disabled>Search</button>
      <div class="menu__divider"></div>
      <div class="menu__group-label">CONNECTION</div>
      <button class="menu__item menu__item--danger" data-action="leave">Leave connection</button>
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
    panel.querySelector('[data-action="leave"]')!.addEventListener('click', () => {
      close()
      go('leave')
    })

    document.addEventListener('click', onOutsideClick)
  })
}
