import { letterDate, wrapLetterLines } from './letterLayout'
import type { LetterPayload } from './letters'

export async function downloadLetterPdf(body: string, payload: LetterPayload, createdAt: string): Promise<void> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), document.fonts.load('20px "Dancing Script"')])
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const width = pdf.internal.pageSize.getWidth(), height = pdf.internal.pageSize.getHeight()
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * 2); canvas.height = Math.ceil(height * 2)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('PDF rendering is unavailable in this browser.')
  ctx.scale(2, 2)
  ctx.font = '20px "Dancing Script", cursive'
  ctx.textBaseline = 'top'
  const margin = 64, lineHeight = 28
  let y = margin
  const clear = (): void => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#000'; y = margin }
  // shortcut: pages contain raster text to preserve browser Unicode shaping; use embedded fallback fonts if selectable PDF text is needed.
  const savePage = (): void => { pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, width, height) }
  const nextPage = (): void => { savePage(); pdf.addPage(); clear() }
  const draw = (line: string, x: number, right = false): void => {
    if (y + lineHeight > height - margin) nextPage()
    ctx.textAlign = right ? 'right' : 'left'; ctx.fillText(line, x, y); y += lineHeight
  }
  const measure = (text: string): number => ctx.measureText(text).width
  clear()
  draw(letterDate(createdAt), width - margin, true)
  y += 18
  for (const line of wrapLetterLines(`Dear ${payload.to},`, measure, width - margin * 2)) draw(line, margin)
  y += 18
  for (const line of wrapLetterLines(body, measure, width - margin * 2 - 28)) draw(line, margin + 28)
  const signature = ['With love,', ...wrapLetterLines(payload.from, measure, width - margin * 2)]
  if (y + 18 + signature.length * lineHeight > height - margin) nextPage()
  y = Math.max(y + 18, height - margin - signature.length * lineHeight)
  for (const line of signature) draw(line, width - margin, true)
  savePage()
  const name = (payload.to || 'you').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80)
  pdf.save(`letter-to-${name}.pdf`)
}
