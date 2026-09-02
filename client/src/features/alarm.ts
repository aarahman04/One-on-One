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
  /** Begin the full in-app alert for a newly raised, unacknowledged alarm. */
  start: () => void
  /** Stop sound + vibration only — call when the chat becomes visible/focused.
   *  The visual glow/card persist until acknowledged or auto-cleared. */
  stopSound: () => void
  /** Full stop (acknowledged or auto-cleared). */
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

  const start = (): void => {
    stopAll()
    void audio.play().catch(() => {
      /* blocked (no prior gesture this session) — vibration + red glow still fire */
    })
    if (navigator.vibrate) {
      navigator.vibrate(VIBRATE_PATTERN)
      const cycleMs = VIBRATE_PATTERN.reduce((a, b) => a + b, 0)
      vibrateTimer = setInterval(() => navigator.vibrate?.(VIBRATE_PATTERN), cycleMs)
    }
    autoClearTimer = setTimeout(() => {
      stopAll()
      autoClearCb?.()
    }, AUTO_CLEAR_MS)
  }

  return {
    start,
    stopSound,
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
