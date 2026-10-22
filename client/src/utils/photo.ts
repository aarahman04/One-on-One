export function photoFitSize(width: number, height: number, maximum = 2048) {
  if (![width, height, maximum].every((n) => Number.isFinite(n) && n > 0)) throw new Error('Invalid photo dimensions.')
  const scale = Math.min(1, maximum / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function normalizePhoto(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024)
    throw new Error('Choose a JPEG, PNG, WebP or GIF up to 10 MB.')
  // Decode orientation once; canvas strips the EXIF tag so it cannot be applied again.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    if (bitmap.width > 20_000 || bitmap.height > 20_000) throw new Error('That photo is too large to decode.')
    if (file.type === 'image/gif') return { blob: file, width: bitmap.width, height: bitmap.height }
    const { width, height } = photoFitSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0, width, height)
    const pixels = ctx.getImageData(0, 0, width, height).data
    let transparent = false
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) { transparent = true; break }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, transparent ? 'image/png' : 'image/jpeg', .85))
    if (!blob) throw new Error('Could not encode photo.')
    return { blob, width, height }
  } finally { bitmap.close() }
}
