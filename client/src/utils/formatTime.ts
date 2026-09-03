export function formatClock(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// Small per-bubble timestamp, WhatsApp-style — e.g. "3:59 AM". Renders in
// the viewer's own local timezone since toLocaleTimeString has no explicit
// timeZone option here (same as the other formatters in this file).
export function formatMessageTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function formatDateSeparator(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
}

export function formatFullTimestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  const day = date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
  return `${day}\n${time}`
}

// mm:ss for voice-note duration/playback position. Caps at 99:59 rather than
// rolling into hours — voice notes are capped well under an hour server-side.
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0))
  const m = Math.min(99, Math.floor(total / 60))
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Call durations, unlike voice-message durations, routinely run past an hour,
// so this shows h:mm:ss once there is an hour to show (formatDuration above
// caps at 99 minutes, which is right for a voice note and wrong for a call).
export function formatCallDuration(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function isSameDay(a: Date, b: Date): boolean {
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
