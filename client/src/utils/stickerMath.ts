export const STICKER_MAX_BYTES = 100_000
export interface Trim { left: number; top: number; right: number; bottom: number }
export interface Placement { zoom: number; x: number; y: number }
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

// shortcut: exact square WebP identifies stickers, replace when the contract adds a sticker flag.
export function isSticker(message: { type: string; payload: unknown; replyTo?: string | null; deletedAt?: string | null }): boolean {
  const p = message.payload as { mime?: unknown; width?: unknown; height?: unknown } | null
  return message.type === 'image' && !message.deletedAt && !message.replyTo && p?.mime === 'image/webp' && p.width === 512 && p.height === 512
}
export const metaSide = (mine: boolean): 'right' | 'left' => mine ? 'right' : 'left'

export function dragTrim(t: Trim, handle: number, dx: number, dy: number): Trim {
  if (![...Object.values(t), dx, dy].every(Number.isFinite)) throw new Error('Invalid crop.')
  if (handle < 0) {
    dx = clamp(dx, -t.left, 1 - t.right); dy = clamp(dy, -t.top, 1 - t.bottom)
    return { left: t.left + dx, right: t.right + dx, top: t.top + dy, bottom: t.bottom + dy }
  }
  return {
    left: handle % 2 === 0 ? clamp(t.left + dx, 0, t.right - .1) : t.left,
    right: handle % 2 === 1 ? clamp(t.right + dx, t.left + .1, 1) : t.right,
    top: handle < 2 ? clamp(t.top + dy, 0, t.bottom - .1) : t.top,
    bottom: handle >= 2 ? clamp(t.bottom + dy, t.top + .1, 1) : t.bottom,
  }
}
export function stickerPlacement(width: number, height: number, p: Placement) {
  if (![width, height, p.zoom, p.x, p.y].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('Invalid photo dimensions.')
  const zoom = clamp(p.zoom, 1, 6)
  const w = width / Math.max(width, height) * zoom, h = height / Math.max(width, height) * zoom
  const x = clamp(p.x, -Math.max(0, (w - 1) / 2), Math.max(0, (w - 1) / 2))
  const y = clamp(p.y, -Math.max(0, (h - 1) / 2), Math.max(0, (h - 1) / 2))
  return { left: (1 - w) / 2 + x, top: (1 - h) / 2 + y, width: w, height: h, zoom, x, y }
}
export function transformPlacement(width: number, height: number, p: Placement, ratio: number, dx: number, dy: number, fx = 0, fy = 0): Placement {
  if (![ratio, dx, dy, fx, fy].every(Number.isFinite) || ratio <= 0) throw new Error('Invalid placement.')
  const before = stickerPlacement(width, height, p), zoom = clamp(before.zoom * ratio, 1, 6), scale = zoom / before.zoom
  return stickerPlacement(width, height, { zoom, x: fx - (fx - before.x) * scale + dx, y: fy - (fy - before.y) * scale + dy })
}
export async function encodeSticker(encode: (quality: number) => Promise<Blob | null>): Promise<Blob> {
  for (const quality of [1, .95, .9, .85, .8]) {
    const blob = await encode(quality)
    if (!blob?.size || blob.type !== 'image/webp') throw new Error('This browser could not encode WebP.')
    if (blob.size <= STICKER_MAX_BYTES) return blob
  }
  throw new Error('That crop is too detailed to fit 100 KB. Try a tighter crop.')
}
