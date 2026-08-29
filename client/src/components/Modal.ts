// Minimal reusable overlay modal (dimmed backdrop + centered panel). Closes on
// ✕, backdrop click, or Esc. Used by the letter composer/viewer; reusable for
// future features.
export interface Modal {
  close: () => void
  panel: HTMLElement
}

interface StackEntry {
  overlay: HTMLElement
  panel: HTMLElement
  close: () => void
}

// Stacked modals: one shared keydown listener, only the top modal reacts to Esc
// and traps Tab (previously every open modal added its own listener, so one Esc
// closed the whole stack — e.g. a notice popped over the report modal).
const stack: StackEntry[] = []

const onKey = (e: KeyboardEvent): void => {
  const top = stack[stack.length - 1]
  if (!top) return
  if (e.key === 'Escape') {
    top.close()
    return
  }
  if (e.key === 'Tab') {
    const focusable = top.panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey && (active === first || !top.panel.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

export function openModal(node: HTMLElement, opts: { onClose?: () => void } = {}): Modal {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'

  const panel = document.createElement('div')
  panel.className = 'modal-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'modal-close'
  closeBtn.textContent = '✕'
  closeBtn.setAttribute('aria-label', 'Close')

  panel.append(closeBtn, node)
  overlay.append(panel)
  document.body.append(overlay)

  const previouslyFocused = document.activeElement as HTMLElement | null

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    overlay.remove()
    const i = stack.findIndex((e) => e.overlay === overlay)
    if (i !== -1) stack.splice(i, 1)
    if (stack.length === 0) document.removeEventListener('keydown', onKey)
    previouslyFocused?.focus?.()
    opts.onClose?.()
  }

  // Backdrop dismiss only when the press *started* on the backdrop — a
  // text-selection drag that happens to end on the backdrop must not close.
  let pressStartedOnOverlay = false
  overlay.addEventListener('mousedown', (e) => {
    pressStartedOnOverlay = e.target === overlay
  })
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && pressStartedOnOverlay) close()
    pressStartedOnOverlay = false
  })
  closeBtn.addEventListener('click', close)

  if (stack.length === 0) document.addEventListener('keydown', onKey)
  stack.push({ overlay, panel, close })

  // Move focus into the panel so Tab-trapping has an anchor.
  ;(panel.querySelector<HTMLElement>(
    'textarea, input, button:not(.modal-close)',
  ) ?? closeBtn).focus()

  return { close, panel }
}
