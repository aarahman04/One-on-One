const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function isSingleEmoji(text: string): boolean {
  const parts = [...segmenter.segment(text.trim())]
  if (parts.length !== 1) return false
  const value = parts[0].segment
  if (/^[\p{Emoji_Modifier}\uFE0F\u200D]+$/u.test(value)) return false
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|^[#*0-9]\uFE0F?\u20E3$/u.test(value)
}
