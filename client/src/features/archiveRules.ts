import type { HistoryMessage } from '../services/connectionsApi'

export function archiveContent(message: HistoryMessage): string {
  if (message.type !== 'call') return message.content
  const p = (message.payload ?? {}) as { kind?: string; outcome?: string; durationSec?: number }
  const outcomes: Record<string, string> = { missed: 'Missed', declined: 'Declined', cancelled: 'Cancelled', completed: 'Completed', failed: 'Failed', unreachable: 'Not reached' }
  const seconds = Math.max(0, Math.round(p.durationSec || 0))
  return `${p.kind === 'video' ? 'Video call' : 'Voice call'} · ${outcomes[p.outcome || ''] || 'Ended'}${seconds ? ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : ''}`
}

export function archiveMessages(messages: HistoryMessage[]): HistoryMessage[] {
  return messages.filter((m) => m.id && !m.deletedAt && m.type !== 'system')
}

export function safeArchiveName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim().replace(/^\.+|[. ]+$/g, '').slice(0, 100) || 'file'
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(safe) ? `_${safe}` : safe
}

export function archiveDate(at: string): string {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? 'undated' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function archiveFilename(partner: string, at = new Date().toISOString()): string {
  return `one-on-one-${safeArchiveName(partner).slice(0, 40)}-${archiveDate(at)}.zip`
}

const extensions: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
}

export function archiveFiles(messages: HistoryMessage[]): { message: HistoryMessage; name: string }[] {
  const taken = new Set<string>()
  return archiveMessages(messages).flatMap((message) => {
    const p = (message.payload ?? {}) as { mime?: string; width?: number; height?: number; name?: string; to?: string; path?: string }
    let folder: string, base: string, ext: string
    if (message.type === 'letter') { folder = 'letters'; base = `${archiveDate(message.createdAt)}-${safeArchiveName(p.to || 'you')}`; ext = 'pdf' }
    else {
      ext = extensions[p.mime ?? '']
      if (!ext || !p.path || !['image', 'voice', 'file'].includes(message.type)) return []
      folder = message.type === 'voice' ? 'voice' : message.type === 'file' ? 'files' : p.mime === 'image/webp' && p.width === 512 && p.height === 512 ? 'images/stickers' : 'images'
      base = message.type === 'file' ? safeArchiveName(p.name || 'file').replace(/\.[^.]*$/, '') || 'file' : archiveDate(message.createdAt)
    }
    let name = `${folder}/${base}.${ext}`, n = 1
    while (taken.has(name.toLowerCase())) name = `${folder}/${base} (${++n}).${ext}`
    taken.add(name.toLowerCase())
    return [{ message, name }]
  })
}
