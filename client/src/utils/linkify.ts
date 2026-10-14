// Android messageLinks rules, with bounded domain labels and safe DOM rendering.
const TLD = 'online|site|store|shop|website|tech|space|xyz|live|link|page|blog|club|cloud|digital|world|news|life|fun|art|design|studio|media|today|email|network|agency|company|global|solutions|team|top|pro|biz|com|net|org|io|app|dev|co|in|me|info|edu|gov|ai|uk|us|gg|gl|be|tv|ly|fm|to|so|sh|am|de|fr|es|it|nl|eu|ca|au|nz|jp|kr|cn|ru|br|mx|pk|bd|lk|np|ae|sa|qa|sg|my|id|ph|za|ng|ke'
const URL_PATTERN = new RegExp(String.raw`\b(?:https?://|www\.)[^\s<>]+|(?<![@\w.-])(?:[a-z0-9-]{1,63}\.){1,10}(?:${TLD})\b(?!\.[a-z])(?:/[^\s<>]*)?`, 'gi')
const PHONE_PATTERN = /(?<![\w+(])[+(]?\d[\d ()-]{5,}\d(?!\w)/g
const DATE_PATTERN = /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/

export function safeWebUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname ? url.href : null
  } catch { return null }
}

export function messageLinks(text: string): { start: number; end: number; url: string }[] {
  const links: { start: number; end: number; url: string }[] = []
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0].replace(/[.,!?:;)'"\]}]+$/, '')
    const url = safeWebUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (url) links.push({ start: match.index, end: match.index + raw.length, url })
  }
  for (const match of text.matchAll(PHONE_PATTERN)) {
    const raw = match[0]
    const digits = raw.replace(/\D/g, '')
    const start = match.index
    const end = start + raw.length
    if (digits.length < 7 || digits.length > 15 || DATE_PATTERN.test(raw) || links.some((l) => start < l.end && l.start < end)) continue
    links.push({ start, end, url: `tel:${raw.replace(/[^\d+]/g, '')}` })
  }
  return links.sort((a, b) => a.start - b.start)
}

export function linkifyInto(el: HTMLElement, text: string): void {
  el.textContent = ''
  let last = 0
  for (const link of messageLinks(text)) {
    el.append(document.createTextNode(text.slice(last, link.start)))
    const a = document.createElement('a')
    a.href = link.url
    a.textContent = text.slice(link.start, link.end)
    if (!link.url.startsWith('tel:')) {
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
    }
    a.dataset.messageLink = '1'
    el.append(a)
    last = link.end
  }
  el.append(document.createTextNode(text.slice(last)))
}
