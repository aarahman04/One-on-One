// Turns URLs and phone-like number runs into tappable links, WhatsApp-style.
// Builds text + <a> nodes directly (never innerHTML) so user content stays
// XSS-safe — mirrors the text-node splitting ChatPage's search highlighter uses.

// Runs are length-bounded so a pathological token can't force a long linear
// scan. No lookbehind anywhere (fixed-length-only concern on older iOS
// Safari) — the email guard and local-phone prefix both work around that by
// capturing one boundary character forward instead of asserting backward.

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
// Curated, not exhaustive — a plain "example.co" without a path stays plain
// text (recall/precision trade, same spirit as the phone branch below).
// Split in two so a 2-letter ccTLD (bit.ly, t.co, goo.gl) only counts as a
// domain when it's followed by a path — otherwise ordinary prose ("see you
// at 10.me tomorrow") would light up as a link.
const LONG_TLD = 'com|net|org|dev|app|edu|gov|info|xyz|link|page|site'
const SHORT_TLD = 'io|co|gl|ly|gg|ai|in|uk|us|to|be|tv|so|sh|me'

const PATTERN = new RegExp(
  // 1: email — matched first and left as plain text, so "me@example.com"
  // never gets its domain half peeled off and linked on its own.
  '([^\\s@]{1,256}@[^\\s@]{1,256}\\.[a-z]{2,24})' +
    '|(https?:\\/\\/\\S{1,2000})' + // 2: scheme url
    '|(www\\.\\S{1,256}\\.[a-z]{2,}\\S{0,256})' + // 3: www url
    // 4: bare domain, generic tld — the trailing (?!\.[a-z]) refuses to stop
    // at an interior label that happens to spell a real TLD (e.g. the "app"
    // in maps.app.goo.gl), so branch 5 gets a shot at the true, longer domain.
    `|(\\b(?:${LABEL}\\.){1,10}(?:${LONG_TLD})\\b(?!\\.[a-z])(?:\\/\\S{0,256})?)` +
    `|(\\b(?:${LABEL}\\.){1,10}(?:${SHORT_TLD})(?!\\.[a-z])\\/\\S{0,256})` + // 5: bare domain, cc-tld (path required)
    '|(\\+\\d[\\d\\s().-]{5,16}\\d)' + // 6: intl phone
    // 7: local phone (inner group) — separator-grouped or a bare 10-digit
    // run. The non-capturing leading alternative consumes one boundary char
    // (or none, at start-of-string) so "$07700 900123" or similar can't have
    // its digits misread as touching a preceding token; (?!\d) at the end
    // stops it from grabbing part of a longer run (a 13+ digit id never
    // matches — every possible split still has a digit sitting right after).
    '|(?:^|[^\\d.:/+])((?:\\(\\d{2,4}\\)[\\s.-]?)?\\d{3,4}[\\s.-]?\\d{3,4}(?:[\\s.-]?\\d{2,4})?)(?!\\d)',
  'gi',
)

// A URL swept up by \S also swallows trailing sentence punctuation
// ("https://a.com," or "(https://a.com)") — strip it off the link (and put
// it back as plain text) rather than shipping a link that 404s.
const TRIM_TRAILING = /[.,;:!?)\]}'"]+$/

export function linkifyInto(el: HTMLElement, text: string): void {
  el.textContent = ''
  let last = 0
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index ?? 0
    if (start > last) el.appendChild(document.createTextNode(text.slice(last, start)))

    if (match[1]) {
      // Email — plain text, no anchor, but still consume it here so the
      // next loop iteration's slice doesn't duplicate it.
      el.appendChild(document.createTextNode(match[1]))
      last = start + match[1].length
      continue
    }

    const urlRaw = match[2] ?? match[3] ?? match[4] ?? match[5]
    if (urlRaw !== undefined) {
      const trimLen = urlRaw.match(TRIM_TRAILING)?.[0].length ?? 0
      const raw = trimLen ? urlRaw.slice(0, -trimLen) : urlRaw
      const a = document.createElement('a')
      a.href = match[2] ? raw : `https://${raw}`
      a.textContent = raw
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      el.appendChild(a)
      last = start + raw.length
      continue
    }

    if (match[6]) {
      const a = document.createElement('a')
      a.href = `tel:${match[6].replace(/[\s().-]/g, '')}`
      a.textContent = match[6]
      el.appendChild(a)
      last = start + match[6].length
      continue
    }

    // Local phone: match[0] may carry one leading boundary char ahead of the
    // captured number (group 7) — emit that char as plain text first.
    const number = match[7]
    const prefixLen = match[0].length - number.length
    if (prefixLen > 0) el.appendChild(document.createTextNode(match[0].slice(0, prefixLen)))
    const a = document.createElement('a')
    a.href = `tel:${number.replace(/[\s().-]/g, '')}`
    a.textContent = number
    el.appendChild(a)
    last = start + match[0].length
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)))
}
