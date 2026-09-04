// Screen Wake Lock for video calls — without it the phone screen sleeps
// mid-call and the video freezes for both sides. Chrome Android supports it;
// where it's absent (iOS Safari), every call here is a no-op and the call
// still works, the screen just dims on its normal timer.
//
// The OS drops a wake lock whenever the tab is hidden, so callers must
// re-acquire on visibilitychange — hold() is safe to call repeatedly.

let sentinel: WakeLockSentinel | null = null
// True between hold() and release(). Guards the gap where a call ends while a
// request() is still in flight — without it that late-resolving lock would
// never be released and the screen would stay awake.
let wanted = false

export async function hold(): Promise<void> {
  wanted = true
  if (sentinel || !('wakeLock' in navigator)) return
  try {
    const s = await navigator.wakeLock.request('screen')
    if (!wanted) {
      void s.release()
      return
    }
    sentinel = s
    sentinel.addEventListener('release', () => {
      sentinel = null
    })
  } catch {
    /* denied (not focused, battery saver) — nothing we can do, leave it */
  }
}

export function release(): void {
  wanted = false
  void sentinel?.release()
  sentinel = null
}
