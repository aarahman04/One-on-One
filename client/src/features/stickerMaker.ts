import { openModal } from '../components/Modal'
import { dragTrim, encodeSticker, stickerPlacement, transformPlacement, type Placement, type Trim } from '../utils/stickerMath'
import { mediaEpoch, saveSticker } from './stickerLibrary'

export async function readPhoto(file: Blob, maximum = 1024): Promise<HTMLCanvasElement> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a JPEG, PNG or WebP photo up to 10 MB.')
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    if (bitmap.width > 20_000 || bitmap.height > 20_000) throw new Error('That photo is too large to decode.')
    const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally { bitmap.close() }
}
export const webpCanvas = (canvas: HTMLCanvasElement): Promise<Blob> => encodeSticker((quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality)))
export async function stickerBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/webp' && blob.size <= 100_000) return blob
  const url = URL.createObjectURL(blob), img = new Image()
  try {
    img.src = url; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512
    canvas.getContext('2d')!.drawImage(img, 0, 0, 512, 512)
    return await webpCanvas(canvas)
  } finally { URL.revokeObjectURL(url) }
}
async function cutOut(original: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
  const vision = await FilesetResolver.forVisionTasks('/mediapipe')
  const segmenter = await ImageSegmenter.createFromOptions(vision, { baseOptions: { modelAssetPath: '/stickers/deeplab_v3.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true })
  try {
    const result = segmenter.segment(original)
    try {
      const mask = result.confidenceMasks?.[0]
      if (!mask) throw new Error('No subject found. Try Original.')
      const values = mask.getAsFloat32Array(), canvas = document.createElement('canvas')
      canvas.width = mask.width; canvas.height = mask.height
      const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(mask.width, mask.height)
      let subjects = 0
      values.forEach((background, i) => {
        if (Number.isFinite(background) && background < .5) subjects++
        pixels.data[i * 4 + 3] = Number.isFinite(background) ? Math.round(Math.max(0, Math.min(1, (1 - background - .2) / .6)) * 255) : 0
      })
      if (subjects < Math.max(16, values.length / 200)) throw new Error('No subject found. Try Original.')
      ctx.putImageData(pixels, 0, 0)
      const output = document.createElement('canvas'); output.width = original.width; output.height = original.height
      const out = output.getContext('2d')!; out.drawImage(original, 0, 0); out.globalCompositeOperation = 'destination-in'
      out.drawImage(canvas, 0, 0, output.width, output.height)
      return output
    } finally { result.close() }
  } finally { segmenter.close() }
}

export function openStickerMaker(owner: string, file: File, onSaved: () => void): () => void {
  const start = mediaEpoch(), box = document.createElement('div')
  box.className = 'sticker-maker'
  box.innerHTML = `<h2>Make a sticker</h2><div class="media-tabs"><button type="button" data-original aria-pressed="true">Original</button><button type="button" data-cut aria-pressed="false">Cut-out</button></div>
    <p data-hint>Drag the crop box or its corners. Then place the crop in the square.</p>
    <div class="sticker-maker__photo"><canvas aria-label="Photo preview"></canvas><div class="sticker-maker__crop" aria-label="Move crop" role="button" tabindex="0">${[0, 1, 2, 3].map((i) => `<button type="button" data-handle="${i}" aria-label="Resize ${['top left', 'top right', 'bottom left', 'bottom right'][i]} crop corner"></button>`).join('')}</div></div>
    <label class="sticker-maker__zoom" hidden>Zoom <input type="range" min="1" max="6" step=".05" value="1" aria-label="Sticker zoom"/></label>
    <p class="media-error" role="status"></p><div class="report-dialog__actions"><button type="button" data-cancel>Cancel</button><button type="button" data-reset>Reset</button><button type="button" class="primary" data-next disabled>Place crop</button></div>`
  let closed = false, source: HTMLCanvasElement | null = null, original: HTMLCanvasElement | null = null, cut: HTMLCanvasElement | null = null
  let step: 'crop' | 'place' = 'crop', trim: Trim = { left: 0, top: 0, right: 1, bottom: 1 }, placement: Placement = { zoom: 1, x: 0, y: 0 }
  const modal = openModal(box, { onClose: () => { closed = true } }); modal.panel.setAttribute('aria-label', 'Sticker maker')
  const preview = box.querySelector('canvas')!, frame = box.querySelector<HTMLElement>('.sticker-maker__photo')!, crop = box.querySelector<HTMLElement>('.sticker-maker__crop')!
  const next = box.querySelector<HTMLButtonElement>('[data-next]')!, cutBtn = box.querySelector<HTMLButtonElement>('[data-cut]')!, originalBtn = box.querySelector<HTMLButtonElement>('[data-original]')!
  const error = box.querySelector<HTMLElement>('.media-error')!, zoom = box.querySelector<HTMLInputElement>('input')!, zoomLabel = zoom.parentElement!
  const dimensions = () => ({ width: (source?.width ?? 1) * (trim.right - trim.left), height: (source?.height ?? 1) * (trim.bottom - trim.top) })
  const draw = (): void => {
    if (closed || !source) return
    crop.hidden = step !== 'crop'; zoomLabel.hidden = step !== 'place'
    next.textContent = step === 'crop' ? 'Place crop' : 'Save sticker'
    preview.width = step === 'crop' ? source.width : 512; preview.height = step === 'crop' ? source.height : 512
    frame.style.width = `${Math.min(330, (step === 'crop' ? source.width / source.height : 1) * innerHeight * .42)}px`
    const ctx = preview.getContext('2d')!
    if (step === 'crop') ctx.drawImage(source, 0, 0)
    else {
      const { width, height } = dimensions(), p = stickerPlacement(width, height, placement)
      placement = p; zoom.value = String(p.zoom)
      ctx.drawImage(source, trim.left * source.width, trim.top * source.height, width, height, p.left * 512, p.top * 512, p.width * 512, p.height * 512)
    }
    crop.style.left = `${trim.left * 100}%`; crop.style.top = `${trim.top * 100}%`
    crop.style.width = `${(trim.right - trim.left) * 100}%`; crop.style.height = `${(trim.bottom - trim.top) * 100}%`
  }
  box.querySelector('[data-cancel]')!.addEventListener('click', modal.close)
  box.querySelector('[data-reset]')!.addEventListener('click', () => { step = 'crop'; trim = { left: 0, top: 0, right: 1, bottom: 1 }; placement = { zoom: 1, x: 0, y: 0 }; draw() })
  originalBtn.addEventListener('click', () => { source = original; originalBtn.setAttribute('aria-pressed', 'true'); cutBtn.setAttribute('aria-pressed', 'false'); error.textContent = ''; draw() })
  cutBtn.addEventListener('click', async () => {
    if (!original) return
    cutBtn.disabled = originalBtn.disabled = next.disabled = true; error.textContent = 'Finding the subject…'
    try { cut ??= await cutOut(original); if (closed) return; source = cut; originalBtn.setAttribute('aria-pressed', 'false'); cutBtn.setAttribute('aria-pressed', 'true'); error.textContent = ''; draw() }
    catch (err) { error.textContent = err instanceof Error ? `${err.message} Original is still available.` : 'Cut-out failed. Try Original.' }
    finally { cutBtn.disabled = originalBtn.disabled = next.disabled = false }
  })
  next.addEventListener('click', async () => {
    if (!source) return
    if (step === 'crop') { step = 'place'; error.textContent = ''; draw(); return }
    next.disabled = true
    try {
      const blob = await webpCanvas(preview)
      if (closed) return
      await saveSticker({ owner, id: crypto.randomUUID(), title: 'My sticker', blob, created: Date.now(), used: 0, favourite: false }, start)
      if (!closed) { modal.close(); onSaved() }
    } catch (err) { error.textContent = err instanceof Error ? err.message : 'Could not save. Try again.' }
    finally { next.disabled = false }
  })
  zoom.addEventListener('input', () => { placement.zoom = Number(zoom.value); draw() })
  const pointers = new Map<number, { x: number; y: number }>()
  let handle = -1
  frame.addEventListener('pointerdown', (e) => {
    if (!source) return
    const target = e.target as HTMLElement
    if (step === 'crop' && !target.closest('.sticker-maker__crop')) return
    e.preventDefault(); frame.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    handle = target.dataset.handle === undefined ? -1 : Number(target.dataset.handle)
  })
  frame.addEventListener('pointermove', (e) => {
    const before = pointers.get(e.pointerId)
    if (!before) return
    const rect = preview.getBoundingClientRect(), dx = (e.clientX - before.x) / rect.width, dy = (e.clientY - before.y) / rect.height
    const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)?.[1]
    let ratio = 1, fx = 0, fy = 0
    if (other) {
      const oldDistance = Math.hypot(before.x - other.x, before.y - other.y)
      ratio = Math.hypot(e.clientX - other.x, e.clientY - other.y) / Math.max(1, oldDistance)
      fx = ((before.x + other.x) / 2 - rect.left) / rect.width - .5; fy = ((before.y + other.y) / 2 - rect.top) / rect.height - .5
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (step === 'crop') trim = dragTrim(trim, handle, dx, dy)
    else { const { width, height } = dimensions(); placement = transformPlacement(width, height, placement, ratio, dx / (other ? 2 : 1), dy / (other ? 2 : 1), fx, fy) }
    draw()
  })
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) frame.addEventListener(event, (e) => pointers.delete((e as PointerEvent).pointerId))
  frame.addEventListener('wheel', (e) => {
    if (step !== 'place') return
    e.preventDefault(); const rect = preview.getBoundingClientRect(), { width, height } = dimensions()
    placement = transformPlacement(width, height, placement, Math.exp(-e.deltaY * .002), 0, 0, (e.clientX - rect.left) / rect.width - .5, (e.clientY - rect.top) / rect.height - .5); draw()
  }, { passive: false })
  crop.addEventListener('keydown', (e) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-.01, 0], ArrowRight: [.01, 0], ArrowUp: [0, -.01], ArrowDown: [0, .01] }
    if (!moves[e.key]) return
    e.preventDefault(); const target = e.target as HTMLElement
    trim = dragTrim(trim, target.dataset.handle === undefined ? -1 : Number(target.dataset.handle), ...moves[e.key]!); draw()
  })
  void readPhoto(file).then((canvas) => { if (closed) return; source = original = canvas; next.disabled = false; draw() }).catch((err) => { error.textContent = err instanceof Error ? err.message : 'Could not read photo.' })
  return modal.close
}
