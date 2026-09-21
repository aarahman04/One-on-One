// Single active-panel registry: the menu dropdown, the appearance popover,
// and the message context/emoji popover are mutually exclusive — opening one
// must close whatever else is open, in either direction. A shared Escape
// listener closes whichever one is currently registered.
let active: (() => void) | null = null

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeActivePanel()
}

// Call when a panel opens. Closes any previously-registered panel first, then
// records `close` as the new active one (with a shared document Escape
// listener while anything is active). Returns an unregister function the
// panel's own close() must call so a later open doesn't try to re-close it.
export function openPanel(close: () => void): () => void {
  closeActivePanel()
  active = close
  document.addEventListener('keydown', onKey)
  return () => {
    if (active === close) {
      active = null
      document.removeEventListener('keydown', onKey)
    }
  }
}

export function closeActivePanel(): void {
  const close = active
  active = null
  document.removeEventListener('keydown', onKey)
  close?.()
}
