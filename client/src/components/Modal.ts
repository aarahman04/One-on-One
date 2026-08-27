// Minimal reusable overlay modal (dimmed backdrop + centered panel). Closes on
// ✕, backdrop click, or Esc. Used by the letter composer/viewer; reusable for
// future features.
export interface Modal {
  close: () => void
  panel: HTMLElement
}

export function openModal(node: HTMLElement, opts: { onClose?: () => void } = {}): Modal {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'

  const panel = document.createElement('div')
  panel.className = 'modal-panel'

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'modal-close'
  closeBtn.textContent = '✕'
  closeBtn.setAttribute('aria-label', 'Close')

  panel.append(closeBtn, node)
  overlay.append(panel)
  document.body.append(overlay)

  const close = (): void => {
    overlay.remove()
    document.removeEventListener('keydown', onKey)
    opts.onClose?.()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })
  closeBtn.addEventListener('click', close)
  document.addEventListener('keydown', onKey)

  return { close, panel }
}
