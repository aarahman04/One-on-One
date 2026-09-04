// Screen Wake Lock for video calls — without it the phone screen sleeps
// mid-call and the video freezes for both sides. Chrome Android supports it;
// where it's absent (iOS Safari), every call here is a no-op and the call
// still works, the screen just dims on its normal timer.
//
// The OS drops a wake lock whenever the tab is hidden, so callers must
// re-acquire on visibilitychange — hold() is safe to call repeatedly.

let sentinel: WakeLockSentinel | null = null

export async function hold(): Promise<void> {
  if (sentinel || !('wakeLock' in navigator)) return
  try {
    sentinel = await navigator.wakeLock.request('screen')
    // A lock the OS released on its own (tab hidden) should not look held.
    sentinel.addEventListener('release', () => {
      sentinel = null
    })
  } catch {
    /* denied (not focused, battery saver) — nothing we can do, leave it */
  }
}

export function release(): void {
  void sentinel?.release()
  sentinel = null
}
