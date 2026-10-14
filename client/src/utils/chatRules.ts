import type { IncomingMessage } from '../services/transport/Transport'

export const EDIT_WINDOW_MS = 30 * 60_000
export const NOTIFICATION_REMINDER_MS = 3 * 24 * 60 * 60_000
export const DELETED_MESSAGE = 'This message was deleted'

type Message = Pick<IncomingMessage, 'senderId' | 'type' | 'createdAt' | 'deletedAt'> & { id?: string }

export function canDelete(message: Message, myUserId: string, now = Date.now()): boolean {
  const age = now - Date.parse(message.createdAt)
  return !!message.id && message.senderId === myUserId && !message.deletedAt &&
    !['alarm', 'call', 'system'].includes(message.type) && age >= 0 && age <= EDIT_WINDOW_MS
}

export function canEdit(message: Message, myUserId: string, now = Date.now()): boolean {
  return message.type === 'text' && canDelete(message, myUserId, now)
}

export function matchRanges(text: string, query: string): { start: number; end: number }[] {
  const q = query.trim()
  if (!q) return []
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'giu')
  return [...text.matchAll(pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length }))
}

export function notificationReminderDue(lastAsked: number, now = Date.now()): boolean {
  return !Number.isFinite(lastAsked) || lastAsked <= 0 || now - lastAsked >= NOTIFICATION_REMINDER_MS
}

// Accept only bounded, raster data; never turn an untrusted MIME into a data URL.
export function previewImageUrl(image: string | null, mime: string | null): string | null {
  if (!image || image.length > 820_000 || !mime || !/^image\/(jpeg|png|webp|gif|x-icon|vnd\.microsoft\.icon)$/.test(mime) || !/^[A-Za-z0-9+/]*={0,2}$/.test(image)) return null
  try {
    const bytes = atob(image)
    const valid = mime === 'image/png' ? bytes.startsWith('\x89PNG\r\n\x1a\n') :
      mime === 'image/jpeg' ? bytes.startsWith('\xff\xd8\xff') :
      mime === 'image/gif' ? /^GIF8[79]a/.test(bytes) :
      mime === 'image/webp' ? bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP' :
      bytes.startsWith('\0\0\x01\0')
    if (!valid) return null
    const data = new DataView(Uint8Array.from(bytes, (byte) => byte.charCodeAt(0)).buffer)
    let width = 0, height = 0
    if (mime === 'image/png' && bytes.slice(12, 16) === 'IHDR') {
      width = data.getUint32(16); height = data.getUint32(20)
    } else if (mime === 'image/gif') {
      width = data.getUint16(6, true); height = data.getUint16(8, true)
    } else if (mime.includes('icon') && bytes.length >= 22 && data.getUint16(4, true) > 0) {
      width = data.getUint8(6) || 256; height = data.getUint8(7) || 256
    } else if (mime === 'image/webp') {
      const kind = bytes.slice(12, 16)
      if (kind === 'VP8X') {
        width = 1 + data.getUint8(24) + (data.getUint8(25) << 8) + (data.getUint8(26) << 16)
        height = 1 + data.getUint8(27) + (data.getUint8(28) << 8) + (data.getUint8(29) << 16)
      } else if (kind === 'VP8L' && data.getUint8(20) === 0x2f) {
        width = 1 + data.getUint8(21) + ((data.getUint8(22) & 0x3f) << 8)
        height = 1 + (data.getUint8(22) >> 6) + (data.getUint8(23) << 2) + ((data.getUint8(24) & 0xf) << 10)
      } else if (kind === 'VP8 ' && bytes.slice(23, 26) === '\x9d\x01\x2a') {
        width = data.getUint16(26, true) & 0x3fff; height = data.getUint16(28, true) & 0x3fff
      }
    } else if (mime === 'image/jpeg') {
      for (let offset = 2; offset + 3 < bytes.length;) {
        if (data.getUint8(offset) !== 0xff) break
        while (data.getUint8(offset + 1) === 0xff) offset++
        const marker = data.getUint8(offset + 1)
        offset += 2
        if (marker === 0xda || marker === 0xd9) break
        const length = data.getUint16(offset)
        if (length < 2 || offset + length > bytes.length) break
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          height = data.getUint16(offset + 3); width = data.getUint16(offset + 5); break
        }
        offset += length
      }
    }
    // A tiny compressed file can still declare an enormous decoded surface.
    return width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16_777_216 ? `data:${mime};base64,${image}` : null
  } catch { return null }
}
