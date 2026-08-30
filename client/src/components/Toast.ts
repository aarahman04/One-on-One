// Lightweight transient toast — auto-dismisses, no focus trap or decision
// required. For brief status feedback (e.g. "Notifications turned on").
// A real choice (report a message, write a letter) still uses Modal.ts.
let stack: HTMLDivElement | null = null

function ensureStack(): HTMLDivElement {
  if (!stack) {
    stack = document.createElement('div')
    stack.className = 'toast-stack'
    document.body.append(stack)
  }
  return stack
}

export function showToast(message: string, duration = 3200): void {
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = message
  toast.setAttribute('role', 'status')
  toast.setAttribute('aria-live', 'polite')
  ensureStack().append(toast)

  // Add the visible class next frame so the enter transition actually plays
  // (a class present at insertion time doesn't transition from anything).
  requestAnimationFrame(() => toast.classList.add('toast--visible'))

  let dismissed = false
  const dismiss = (): void => {
    if (dismissed) return
    dismissed = true
    toast.classList.remove('toast--visible')
    toast.addEventListener('transitionend', () => toast.remove(), { once: true })
  }
  toast.addEventListener('click', dismiss)
  setTimeout(dismiss, duration)
}
