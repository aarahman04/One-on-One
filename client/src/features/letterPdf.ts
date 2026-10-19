import { layoutLetter } from './letterLayout'
import type { LetterPayload } from './letters'
import { downloadBlob } from '../utils/download'

export async function letterPdf(body: string, payload: LetterPayload, createdAt: string): Promise<Blob> {
  const [{ jsPDF }, layout] = await Promise.all([import('jspdf'), layoutLetter(body, payload.to, payload.from, createdAt)])
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const { width, height, margin, line } = layout
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * 2); canvas.height = Math.ceil(height * 2)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('PDF rendering is unavailable in this browser.')
  ctx.scale(2, 2)
  ctx.font = `${layout.size}px "Dancing Script", cursive`
  ctx.textBaseline = 'top'
  for (const [index, page] of layout.pages.entries()) {
    if (index) pdf.addPage()
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#000'
    let y = margin
    const draw = (lines: string[], x: number, right = false) => {
      ctx.textAlign = right ? 'right' : 'left'
      for (const text of lines) { ctx.fillText(text, x, y); y += line }
    }
    if (!index) { draw(layout.date, width - margin, true); y += 18; draw(layout.dear, margin); y += 18 }
    draw(layout.body.slice(page.from, page.to), margin + 28)
    if (page.signature) { y = height - margin - layout.signature.length * line; draw(layout.signature, width - margin, true) }
    // shortcut: raster pages preserve Unicode shaping; embed fallback fonts if selectable PDF text is needed.
    pdf.addImage(canvas.toDataURL('image/jpeg', .95), 'JPEG', 0, 0, width, height)
  }
  return pdf.output('blob')
}

export async function downloadLetterPdf(body: string, payload: LetterPayload, createdAt: string): Promise<void> {
  const name = (payload.to || 'you').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80)
  downloadBlob(`letter-to-${name}.pdf`, await letterPdf(body, payload, createdAt))
}
