import { openModal } from '../components/Modal'
import { escapeHtml, downloadFile } from '../utils/download'

export type LetterAppearance = 'dawn' | 'botanical'

export interface LetterPayload {
  appearance: LetterAppearance
  from: string
  to: string
}

export const LETTER_APPEARANCES: { id: LetterAppearance; label: string }[] = [
  { id: 'dawn', label: 'Dawn' },
  { id: 'botanical', label: 'Botanical' },
]

// Single source of truth for the letter look — drives the compose preview, the
// in-app viewer, and the downloaded standalone HTML.
const LETTER_THEME_CSS = `
.letter-sheet { padding: 40px 36px; border-radius: 10px; font-size: 16px; line-height: 1.75; max-width: 560px; width: 100%; margin: 0 auto; box-sizing: border-box; }
.letter-sheet__meta { font-size: 13px; opacity: 0.65; margin-bottom: 18px; letter-spacing: 0.04em; }
.letter-sheet__body { white-space: pre-wrap; word-wrap: break-word; }
.letter-sheet__from { margin-top: 26px; font-style: italic; text-align: right; }
.letter-sheet--dawn { background: linear-gradient(160deg, #ffe7d0 0%, #ffd1dc 38%, #cfe6ff 100%); color: #3a2e3a; font-family: Georgia, 'Times New Roman', serif; }
.letter-sheet--botanical { background: #f7f3e8; color: #34432f; font-family: 'Palatino Linotype', Palatino, Georgia, serif; border: 1px solid #b9c9a6; box-shadow: inset 0 0 0 6px rgba(120, 150, 90, 0.12); }
`

function normalize(p: Partial<LetterPayload> | null | undefined): LetterPayload {
  const appearance: LetterAppearance = p?.appearance === 'botanical' ? 'botanical' : 'dawn'
  return { appearance, from: p?.from ?? '', to: p?.to ?? '' }
}

function letterSheetHtml(body: string, p: LetterPayload): string {
  return `<div class="letter-sheet letter-sheet--${p.appearance}">
  <div class="letter-sheet__meta">To ${escapeHtml(p.to)}</div>
  <div class="letter-sheet__body">${escapeHtml(body)}</div>
  <div class="letter-sheet__from">— ${escapeHtml(p.from)}</div>
</div>`
}

export function buildLetterHtml(body: string, payload: Partial<LetterPayload> | null): string {
  const p = normalize(payload)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>A letter to ${escapeHtml(p.to)}</title>
<style>body{margin:0;padding:24px;min-height:100vh;box-sizing:border-box;background:#0d1117;display:flex;align-items:center;}${LETTER_THEME_CSS}</style>
</head><body>
${letterSheetHtml(body, p)}
</body></html>`
}

function themeStyle(): HTMLStyleElement {
  const s = document.createElement('style')
  s.textContent = LETTER_THEME_CSS
  return s
}

// Viewer: opens a received letter, styled, with a Download button.
export function openLetter(body: string, payload: Partial<LetterPayload> | null): void {
  const p = normalize(payload)
  const wrap = document.createElement('div')
  wrap.className = 'letter-view'

  const holder = document.createElement('div')
  holder.innerHTML = letterSheetHtml(body, p) // all user content escaped inside

  const actions = document.createElement('div')
  actions.className = 'letter-view__actions'
  const dl = document.createElement('button')
  dl.className = 'primary'
  dl.textContent = 'Download .html'
  dl.addEventListener('click', () => downloadFile(`letter-to-${p.to || 'you'}.html`, 'text/html', buildLetterHtml(body, p)))
  actions.append(dl)

  wrap.append(themeStyle(), holder, actions)
  openModal(wrap)
}

// Composer: two steps (write → preview + appearance), then onSend.
export function openLetterComposer(opts: { toName: string; onSend: (body: string, payload: LetterPayload) => void }): void {
  const { toName, onSend } = opts
  const container = document.createElement('div')
  container.className = 'letter-compose'

  let body = ''
  let from = ''
  try {
    from = localStorage.getItem('letterFrom') ?? ''
  } catch {
    /* ignore */
  }
  let appearance: LetterAppearance = 'dawn'

  const modal = openModal(container)

  const renderWrite = (): void => {
    container.innerHTML = `
      <div class="letter-compose__title">Write a letter</div>
      <div class="letter-compose__to">To <strong>${escapeHtml(toName)}</strong></div>
      <textarea id="letter-body" class="letter-compose__body" rows="8" placeholder="Dear ${escapeHtml(toName)},"></textarea>
      <input id="letter-from" class="letter-compose__from" placeholder="From — your name / signature" />
      <div class="letter-compose__actions">
        <button type="button" id="letter-cancel">Cancel</button>
        <button type="button" id="letter-next" class="primary">Next</button>
      </div>
    `
    const bodyEl = container.querySelector<HTMLTextAreaElement>('#letter-body')!
    const fromEl = container.querySelector<HTMLInputElement>('#letter-from')!
    bodyEl.value = body
    fromEl.value = from
    bodyEl.addEventListener('input', () => (body = bodyEl.value))
    fromEl.addEventListener('input', () => (from = fromEl.value))
    container.querySelector('#letter-cancel')!.addEventListener('click', () => modal.close())
    container.querySelector('#letter-next')!.addEventListener('click', () => {
      if (!body.trim()) {
        bodyEl.focus()
        return
      }
      renderPreview()
    })
    bodyEl.focus()
  }

  const renderPreview = (): void => {
    const p: LetterPayload = { appearance, from: from.trim() || 'me', to: toName }
    container.innerHTML = ''

    const title = document.createElement('div')
    title.className = 'letter-compose__title'
    title.textContent = 'Preview'

    const picker = document.createElement('div')
    picker.className = 'letter-compose__picker'
    for (const a of LETTER_APPEARANCES) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = a.label
      btn.className = 'letter-appearance-opt' + (a.id === appearance ? ' letter-appearance-opt--active' : '')
      btn.addEventListener('click', () => {
        appearance = a.id
        renderPreview()
      })
      picker.append(btn)
    }

    const holder = document.createElement('div')
    holder.innerHTML = letterSheetHtml(body, p)

    const actions = document.createElement('div')
    actions.className = 'letter-compose__actions'
    const back = document.createElement('button')
    back.type = 'button'
    back.textContent = 'Back'
    back.addEventListener('click', renderWrite)
    const send = document.createElement('button')
    send.type = 'button'
    send.className = 'primary'
    send.textContent = 'Send letter'
    send.addEventListener('click', () => {
      try {
        localStorage.setItem('letterFrom', from.trim())
      } catch {
        /* ignore */
      }
      onSend(body.trim(), p)
      modal.close()
    })
    actions.append(back, send)

    container.append(title, picker, themeStyle(), holder, actions)
  }

  renderWrite()
}
