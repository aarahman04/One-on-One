// Turns URLs and phone-like number runs into tappable links, WhatsApp-style.
// Builds text + <a> nodes directly (never innerHTML) so user content stays
// XSS-safe — mirrors the text-node splitting ChatPage's search highlighter uses.

// Runs are length-bounded so a pathological token can't force a long linear
// scan. The phone branch requires a leading "+" (was: any 8+ digit run, which
// swallowed dates and IDs as tel: links).
const PATTERN = /(https?:\/\/\S{1,2000})|(www\.\S{1,256}\.[a-z]{2,}\S{0,256})|(\+\d[\d\s().-]{5,16}\d)/gi

export function linkifyInto(el: HTMLElement, text: string): void {
  el.textContent = ''
  let last = 0
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index ?? 0
    if (start > last) el.appendChild(document.createTextNode(text.slice(last, start)))
    const raw = match[0]
    const a = document.createElement('a')
    if (match[1]) a.href = raw
    else if (match[2]) a.href = `https://${raw}`
    else a.href = `tel:${raw.replace(/[\s().-]/g, '')}`
    a.textContent = raw
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    el.appendChild(a)
    last = start + raw.length
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)))
}
