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
