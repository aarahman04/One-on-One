import { Capacitor, registerPlugin } from '@capacitor/core'

// Thin bridge to android AlarmPlugin (AlarmForegroundService). Every export is
// a no-op on web and swallows native failures: a missing/failed bridge must
// degrade to the in-app alarm, never break chat.

interface AlarmPlugin {
  stop(options: { alarmId?: string }): Promise<void>
  isRinging(): Promise<{ ringing: boolean; alarmId: string | null; lastStoppedAlarmId: string | null }>
  setChatActive(options: { active: boolean }): Promise<void>
  canUseFullScreenIntent(): Promise<{ value: boolean }>
  openFullScreenIntentSettings(): Promise<void>
}

const Alarm = registerPlugin<AlarmPlugin>('Alarm')
const isNative = Capacitor.isNativePlatform()

export interface NativeAlarmState {
  ringing: boolean
  alarmId: string | null
  lastStoppedAlarmId: string | null
}

export async function stopNativeAlarm(alarmId?: string | null): Promise<void> {
  if (!isNative) return
  try {
    await Alarm.stop({ alarmId: alarmId ?? undefined })
  } catch (err) {
    console.warn('Alarm.stop failed', err)
  }
}

export async function getNativeAlarmState(): Promise<NativeAlarmState> {
  const none = { ringing: false, alarmId: null, lastStoppedAlarmId: null }
  if (!isNative) return none
  try {
    return await Alarm.isRinging()
  } catch {
    return none
  }
}

// Tells native the chat page is (not) the active surface, so a raise rings
// natively whenever the app is open on any OTHER screen.
export async function setNativeChatActive(active: boolean): Promise<void> {
  if (!isNative) return
  try {
    await Alarm.setChatActive({ active })
  } catch {
    /* ignore */
  }
}

// Android 14+ can revoke the full-screen-intent permission. Shows a one-time
// hint (per install) linking to the system toggle; returns true if shown.
const FSI_HINT_KEY = 'alarmFsiHintShown'
export async function maybePromptFullScreenIntent(): Promise<void> {
  if (!isNative) return
  try {
    if (localStorage.getItem(FSI_HINT_KEY)) return
    const { value } = await Alarm.canUseFullScreenIntent()
    if (value) return
    localStorage.setItem(FSI_HINT_KEY, '1')
    if (window.confirm('Allow full-screen alerts so an emergency alarm can wake your locked screen? Tap OK to open the setting.')) {
      await Alarm.openFullScreenIntentSettings()
    }
  } catch {
    /* ignore */
  }
}

// Alarms the user has silenced / that auto-cleared on this device. Persisted so
// reopening the app never re-rings an alarm that was already dealt with.
const SILENCED_KEY = 'silencedAlarmIds'
const SILENCED_MAX = 30

function readSilenced(): string[] {
  try {
    const raw = localStorage.getItem(SILENCED_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function markAlarmSilenced(alarmId: string | null | undefined): void {
  if (!alarmId) return
  try {
    const ids = readSilenced().filter((id) => id !== alarmId)
    ids.push(alarmId)
    localStorage.setItem(SILENCED_KEY, JSON.stringify(ids.slice(-SILENCED_MAX)))
  } catch {
    /* private mode — falls back to the age/ack checks */
  }
}

export function isAlarmSilenced(alarmId: string): boolean {
  return readSilenced().includes(alarmId)
}
