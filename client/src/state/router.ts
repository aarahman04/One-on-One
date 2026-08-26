export type Screen =
  | 'login'
  | 'connection-id'
  | 'connect'
  | 'request'
  | 'nickname'
  | 'chat'
  | 'export'
  | 'leave'

export type Page = (root: HTMLElement, go: (screen: Screen) => void) => void

const pages = new Map<Screen, Page>()

export function registerPage(screen: Screen, page: Page): void {
  pages.set(screen, page)
}

export function mountRouter(root: HTMLElement, initial: Screen): void {
  const go = (screen: Screen): void => {
    const page = pages.get(screen)
    if (!page) throw new Error(`no page registered for screen: ${screen}`)
    root.innerHTML = ''
    page(root, go)
  }
  go(initial)
}
