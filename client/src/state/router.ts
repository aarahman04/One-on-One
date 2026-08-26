export type Screen =
  | 'login'
  | 'connection-id'
  | 'connect'
  | 'waiting'
  | 'request'
  | 'nickname'
  | 'chat'
  | 'export'
  | 'leave'

export type Cleanup = () => void
export type Page = (root: HTMLElement, go: (screen: Screen) => void) => Cleanup | void

const pages = new Map<Screen, Page>()

export function registerPage(screen: Screen, page: Page): void {
  pages.set(screen, page)
}

export function mountRouter(root: HTMLElement, initial: Screen): void {
  let cleanup: Cleanup | void

  const go = (screen: Screen): void => {
    const page = pages.get(screen)
    if (!page) throw new Error(`no page registered for screen: ${screen}`)
    cleanup?.()
    root.innerHTML = ''
    cleanup = page(root, go)
  }
  go(initial)
}
