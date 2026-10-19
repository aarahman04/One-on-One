export function letterDate(createdAt: string): string {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export function wrapLetterLines(text: string, measure: (text: string) => number, width: number): string[] {
  const lines: string[] = []
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let rest = Array.from(segmenter.segment(paragraph), (part) => part.segment)
    if (!rest.length) lines.push('')
    while (rest.length) {
      let end = 1
      while (end < rest.length && measure(rest.slice(0, end + 1).join('')) <= width) end++
      if (end < rest.length) {
        const space = rest.slice(0, end + 1).findLastIndex((part) => /\s/u.test(part))
        if (space > 0) end = space
      }
      lines.push(rest.slice(0, end).join('').trimEnd())
      rest = rest.slice(end)
      while (rest.length && /^\s+$/u.test(rest[0])) rest.shift()
    }
  }
  return lines
}

export interface LetterMetrics { header: number; lines: number[]; signature: number }
export interface LetterPage { from: number; to: number; signature: boolean }

// Same three-line keep rule and font steps as Android's LetterLayout.kt.
export function planLetterPages(metrics: LetterMetrics, content: number): LetterPage[] {
  const pages: LetterPage[] = []
  const { lines } = metrics
  let from = 0, used = metrics.header
  for (let i = 0; i < lines.length; i++) {
    if (used + lines[i] > content && i > from) { pages.push({ from, to: i, signature: false }); from = i; used = 0 }
    used += lines[i]
  }
  const keep = Math.min(3, lines.length), count = lines.length - from
  if (used + 18 + metrics.signature <= content && (from === 0 || count >= keep)) return [...pages, { from, to: lines.length, signature: true }]
  if (count > keep) {
    pages.push({ from, to: lines.length - keep, signature: false })
    return [...pages, { from: lines.length - keep, to: lines.length, signature: true }]
  }
  if (from > 0 && count < keep) {
    const previous = pages.pop()!
    const start = Math.max(previous.from, lines.length - keep)
    if (start > previous.from) pages.push({ from: previous.from, to: start, signature: false })
    return [...pages, { from: start, to: lines.length, signature: true }]
  }
  return [...pages, { from, to: lines.length, signature: true }]
}

export function chooseLetterSize(content: number, measure: (size: number) => LetterMetrics): { size: number; pages: LetterPage[] } {
  const full = measure(20)
  const overflow = full.header + full.lines.reduce((a, b) => a + b, 0) + 18 + full.signature - content
  if (overflow <= full.signature + 18 + full.lines.slice(-3).reduce((a, b) => a + b, 0)) {
    for (const size of [20, 18, 17]) {
      const metrics = measure(size)
      if (metrics.header + metrics.lines.reduce((a, b) => a + b, 0) + 18 + metrics.signature <= content) return { size, pages: planLetterPages(metrics, content) }
    }
  }
  return { size: 20, pages: planLetterPages(full, content) }
}

export async function layoutLetter(body: string, to: string, from: string, createdAt: string) {
  await document.fonts.load('20px "Dancing Script"')
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) throw new Error('Letter rendering is unavailable in this browser.')
  const width = 595.28, height = 841.89, margin = 64
  const blocks = (size: number) => {
    ctx.font = `${size}px "Dancing Script", cursive`
    const measure = (text: string) => ctx.measureText(text).width
    return {
      date: wrapLetterLines(letterDate(createdAt), measure, width - 2 * margin),
      dear: wrapLetterLines(`Dear ${to},`, measure, width - 2 * margin),
      body: wrapLetterLines(body, measure, width - 2 * margin - 28),
      signature: ['With love,', ...wrapLetterLines(from, measure, width - 2 * margin)],
    }
  }
  const metrics = (size: number) => {
    const b = blocks(size), line = size + 8
    return { header: (b.date.length + b.dear.length) * line + 36, lines: b.body.map(() => line), signature: b.signature.length * line }
  }
  const plan = chooseLetterSize(height - margin * 2, metrics)
  return { ...plan, ...blocks(plan.size), width, height, margin, line: plan.size + 8 }
}
