// Plays an element's CSS exit-animation class before removing it, instead of
// yanking it out instantly. Skips the animation (removes immediately) under
// prefers-reduced-motion. A safety timeout backs up `animationend` in case
// the animation doesn't fire (e.g. the class has no matching keyframes).
export function animateOutAndRemove(el: HTMLElement, closingClass: string, fallbackMs = 200): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.remove()
    return
  }
  let done = false
  const finish = (): void => {
    if (done) return
    done = true
    el.remove()
  }
  el.addEventListener('animationend', finish, { once: true })
  setTimeout(finish, fallbackMs)
  el.classList.add(closingClass)
}
