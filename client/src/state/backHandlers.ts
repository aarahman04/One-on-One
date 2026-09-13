// LIFO stack of "something transient is open" back-handlers — modals, menus,
// the search bar, the call screen. Only the native hardware/gesture back
// button drives this (features/nativeBack.ts); on the web nothing calls it.
// A handler returns true when it consumed the press.
type BackHandler = () => boolean

const handlers: BackHandler[] = []

export function pushBackHandler(handler: BackHandler): () => void {
  handlers.push(handler)
  return () => {
    const i = handlers.lastIndexOf(handler)
    if (i !== -1) handlers.splice(i, 1)
  }
}

export function runBackHandlers(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return true
  }
  return false
}
