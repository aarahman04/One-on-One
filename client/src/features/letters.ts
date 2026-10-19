import { openModal } from '../components/Modal'
import { escapeHtml } from '../utils/download'
import { letterDate } from './letterLayout'

type LetterAppearance = 'dawn' | 'botanical'

export interface LetterPayload {
  appearance: LetterAppearance
  from: string
  to: string
}

const LETTER_THEME_CSS = `
.letter-sheet { padding: clamp(20px, 5vw, 48px); font: 22px/1.7 'Dancing Script', cursive; aspect-ratio: 210 / 297; max-width: 680px; width: 100%; margin: 0 auto; box-sizing: border-box; display: flex; flex-direction: column; background: #fff; color: #000; overflow-wrap: anywhere; }
.letter-sheet__date { text-align: right; margin-bottom: 20px; }
.letter-sheet__body { white-space: pre-wrap; padding-left: 28px; margin-top: 20px; }
.letter-sheet__from { margin-top: auto; padding-top: 32px; text-align: right; white-space: pre-wrap; }
`

function normalize(p: Partial<LetterPayload> | null | undefined): LetterPayload {
  const appearance: LetterAppearance = p?.appearance === 'botanical' ? 'botanical' : 'dawn'
  return { appearance, from: p?.from ?? '', to: p?.to ?? '' }
}

function letterSheetHtml(body: string, p: LetterPayload, createdAt: string): string {
  return `<div class="letter-sheet">
  <div class="letter-sheet__date">${escapeHtml(letterDate(createdAt))}</div>
  <div>Dear ${escapeHtml(p.to)},</div>
  <div class="letter-sheet__body">${escapeHtml(body)}</div>
  <div class="letter-sheet__from">With love,\n${escapeHtml(p.from)}</div>
</div>`
}

function themeStyle(): HTMLStyleElement {
  const s = document.createElement('style')
  s.textContent = LETTER_THEME_CSS
  return s
}

// Viewer: opens a received letter, styled, with a Download button.
export function openLetter(body: string, payload: Partial<LetterPayload> | null, createdAt = new Date().toISOString()): void {
  const p = normalize(payload)
  const wrap = document.createElement('div')
  wrap.className = 'letter-view'

  const holder = document.createElement('div')
  holder.innerHTML = letterSheetHtml(body, p, createdAt) // all user content escaped inside

  const actions = document.createElement('div')
  actions.className = 'letter-view__actions'
  const dl = document.createElement('button')
  dl.className = 'primary'
  dl.textContent = 'Download PDF'
  const status = document.createElement('div')
  status.setAttribute('role', 'status')
  dl.addEventListener('click', async () => {
    dl.disabled = true
    status.textContent = 'Preparing PDF…'
    try {
      const { downloadLetterPdf } = await import('./letterPdf')
      await downloadLetterPdf(body, p, createdAt)
      status.textContent = ''
    } catch {
      status.textContent = 'Could not download the PDF. Try again.'
    } finally { dl.disabled = false }
  })
  actions.append(status, dl)

  wrap.append(themeStyle(), holder, actions)
  openModal(wrap).panel.classList.add('letter-modal')
}

// Composer: write, preview, then send using the existing wire format.
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
  const modal = openModal(container)
  modal.panel.classList.add('letter-modal')

  const renderWrite = (): void => {
    container.innerHTML = `
      <div class="letter-compose__title">Write a letter</div>
      <div class="letter-compose__to">To <strong>${escapeHtml(toName)}</strong></div>
      <textarea id="letter-body" class="letter-compose__body" rows="8" maxlength="4000" aria-label="Letter" placeholder="Dear ${escapeHtml(toName)},"></textarea>
      <input id="letter-from" class="letter-compose__from" maxlength="40" aria-label="Your signature" placeholder="From — your name / signature" />
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
    const p: LetterPayload = { appearance: 'dawn', from: from.trim() || 'me', to: toName }
    container.innerHTML = ''

    const title = document.createElement('div')
    title.className = 'letter-compose__title'
    title.textContent = 'Preview'

    const holder = document.createElement('div')
    holder.innerHTML = letterSheetHtml(body, p, new Date().toISOString())

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

    container.append(title, themeStyle(), holder, actions)
  }

  renderWrite()
}
