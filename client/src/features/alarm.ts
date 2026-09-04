import { openModal } from '../components/Modal'

// The /alarm emergency command: an unmistakable in-app alert (looping siren +
// vibration + a pulsing red glow, wired in ChatPage) plus a raise/acknowledge
// flow riding the existing message-type + replyTo pattern (see thisorthat.ts
// for the same reply-linked shape — no message-mutation endpoint exists or
// is needed). No platform lets web push bypass OS Do Not Disturb, and iOS
// PWA push cannot play a custom sound or vibrate at all (see sw.js) — this
// file's sound/vibration only ever fire while the app is open, which is the
// one reliably intrusive surface available to a PWA.

const VIBRATE_PATTERN = [300, 150, 300, 150, 300, 150, 300]
const AUTO_CLEAR_MS = 2 * 60_000 // visual auto-clears if nobody acknowledges

// Autoplay policies require a prior user gesture on the page before `play()`
// is allowed to produce sound; that permission is sticky for the tab's
// lifetime once granted. Rather than require the alarm itself to be the
// first gesture (too late), prime silently on the very first tap/keystroke
// anywhere in the app.
let primed = false
function primeAudioOnce(): void {
  if (primed) return
  primed = true
  const probe = new Audio()
  probe.muted = true
  probe.play().catch(() => {
    /* ignore — a real alarm still attempts play() on its own */
  })
}
window.addEventListener('pointerdown', primeAudioOnce, { once: true })
window.addEventListener('keydown', primeAudioOnce, { once: true })

export interface AlarmController {
  /** Begin the full in-app alert for a newly raised, unacknowledged alarm.
   *  `silent` skips sound/vibration (used for your own raise — you don't
   *  need alerting to something you just sent) but still runs the
   *  auto-clear timer. */
  start: (opts?: { silent?: boolean }) => void
  /** Full stop — sound, vibration and the auto-clear timer (acknowledged or
   *  auto-cleared). Sound/vibration run until one of those two things; being
   *  visible/focused no longer silences them. */
  stopAll: () => void
  /** Fires once if nobody acknowledges within the auto-clear window. */
  onAutoClear: (cb: () => void) => void
  dispose: () => void
}

export function createAlarmController(): AlarmController {
  const audio = new Audio('/alarm.wav')
  audio.loop = true

  let vibrateTimer: ReturnType<typeof setInterval> | null = null
  let autoClearTimer: ReturnType<typeof setTimeout> | null = null
  let autoClearCb: (() => void) | null = null

  const stopVibrate = (): void => {
    if (vibrateTimer) {
      clearInterval(vibrateTimer)
      vibrateTimer = null
    }
    navigator.vibrate?.(0)
  }

  const stopSound = (): void => {
    audio.pause()
    audio.currentTime = 0
    stopVibrate()
  }

  const clearAutoTimer = (): void => {
    if (autoClearTimer) {
      clearTimeout(autoClearTimer)
      autoClearTimer = null
    }
  }

  const stopAll = (): void => {
    stopSound()
    clearAutoTimer()
  }

  const start = (opts: { silent?: boolean } = {}): void => {
    stopAll()
    if (!opts.silent) {
      // Whether this actually makes sound is out of the app's control once
      // the tab is backgrounded: mobile browsers throttle or fully suspend a
      // hidden tab's timers/audio, may drop the WebSocket during that window
      // (so this call never even fires until the tab wakes), and autoplay
      // engagement can lapse independently of the priming above. That's a
      // platform restriction, not a bug — see docs/PROGRESS.md. Logged (not
      // surfaced to the user) so a real regression is still distinguishable
      // from this expected inconsistency.
      void audio.play().catch((err) => {
        console.warn('alarm: audio.play() blocked', err)
      })
      if (navigator.vibrate) {
        navigator.vibrate(VIBRATE_PATTERN)
        const cycleMs = VIBRATE_PATTERN.reduce((a, b) => a + b, 0)
        vibrateTimer = setInterval(() => navigator.vibrate?.(VIBRATE_PATTERN), cycleMs)
      }
    }
    autoClearTimer = setTimeout(() => {
      stopAll()
      autoClearCb?.()
    }, AUTO_CLEAR_MS)
  }

  return {
    start,
    stopAll,
    onAutoClear: (cb) => {
      autoClearCb = cb
    },
    dispose: () => {
      stopAll()
      audio.src = ''
    },
  }
}

// An emergency alert is too easy to misfire without a confirm step.
export function confirmSendAlarm(onConfirm: () => void): void {
  const container = document.createElement('div')
  container.className = 'alarm-confirm'
  container.innerHTML = `
    <div class="msg-compose__title">Send emergency alarm?</div>
    <p class="alarm-confirm__body">This sounds an alarm and shows a red alert on their screen. Use it only for a genuine emergency.</p>
    <div class="msg-compose__actions">
      <button type="button" id="alarm-cancel">Cancel</button>
      <button type="button" id="alarm-send" class="primary">Send alarm</button>
    </div>
  `
  const modal = openModal(container)
  container.querySelector('#alarm-cancel')!.addEventListener('click', () => modal.close())
  container.querySelector('#alarm-send')!.addEventListener('click', () => {
    modal.close()
    onConfirm()
  })
}
