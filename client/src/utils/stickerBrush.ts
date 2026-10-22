export interface BrushPoint { x: number; y: number }
export interface BrushStroke { points: BrushPoint[]; radius: number; restore: boolean }
export function appendBrushPoint(points: BrushPoint[], point: BrushPoint): BrushPoint[] {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid brush point')
  if (points.at(-1)?.x === point.x && points.at(-1)?.y === point.y) return points
  // shortcut: decimate strokes beyond 1024 points; use path simplification if detail loss is reported.
  return [...(points.length >= 1024 ? points.filter((_, i) => i % 2 === 0) : points), point]
}

export function brushSticker(base: HTMLCanvasElement, original: HTMLCanvasElement, strokes: BrushStroke[]): HTMLCanvasElement {
  if (strokes.length > 32 || base.width !== original.width || base.height !== original.height) throw new Error('Invalid brush session')
  const canvas = document.createElement('canvas'); canvas.width = base.width; canvas.height = base.height
  const ctx = canvas.getContext('2d')!; ctx.drawImage(base, 0, 0)
  for (const stroke of strokes) {
    const path = new Path2D(), radius = stroke.radius
    if (!stroke.points.length || stroke.points.length > 1024 || !Number.isFinite(radius) || radius <= 0) throw new Error('Invalid brush stroke')
    stroke.points.forEach((p, i) => {
      path.moveTo(p.x + radius, p.y); path.arc(p.x, p.y, radius, 0, Math.PI * 2)
      if (!i) return
      const before = stroke.points[i - 1], angle = Math.atan2(p.y - before.y, p.x - before.x), x = Math.sin(angle) * radius, y = Math.cos(angle) * radius
      path.moveTo(before.x + x, before.y - y); path.lineTo(p.x + x, p.y - y); path.lineTo(p.x - x, p.y + y); path.lineTo(before.x - x, before.y + y); path.closePath()
    })
    ctx.save(); ctx.clip(path); ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (stroke.restore) ctx.drawImage(original, 0, 0)
    ctx.restore()
  }
  return canvas
}
