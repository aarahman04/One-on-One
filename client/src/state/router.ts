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
  // Public legal pages — reachable signed-out (mounted by main.ts before the
  // session lookup and the age/consent gate).
  | 'privacy'
  | 'terms'
  | 'child-safety'
  | 'delete-account'

export type Cleanup = () => void
export type Page = (root: HTMLElement, go: (screen: Screen) => void) => Cleanup | void

const pages = new Map<Screen, Page>()

export function registerPage(screen: Screen, page: Page): void {
  pages.set(screen, page)
}

let current: Screen | null = null
let navigate: ((screen: Screen) => void) | null = null

// Hardware-back target per screen. Absent = root screen (the native back
// handler minimizes the app). Navigation only — never a side effect like
// cancelling a request or a leave countdown.
const BACK_TARGET: Partial<Record<Screen, Screen>> = {
  connect: 'connection-id',
  export: 'chat',
  leave: 'chat',
}

export function getCurrentScreen(): Screen | null {
  return current
}

// Returns true if the press was consumed by a screen change.
export function goBackScreen(): boolean {
  const target = current ? BACK_TARGET[current] : undefined
  if (!target || !navigate) return false
  navigate(target)
  return true
}

export function mountRouter(root: HTMLElement, initial: Screen): void {
  let cleanup: Cleanup | void

  const go = (screen: Screen): void => {
    current = screen
    const page = pages.get(screen)
    if (!page) throw new Error(`no page registered for screen: ${screen}`)
    cleanup?.()
    root.innerHTML = ''
    cleanup = page(root, go)
  }
  navigate = go
  go(initial)
}
