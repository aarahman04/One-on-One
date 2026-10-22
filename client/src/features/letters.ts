import { openModal } from '../components/Modal'
import { escapeHtml } from '../utils/download'
import { layoutLetter } from './letterLayout'
import { SPEAKER_ICON, MIC_ICON } from './chatIcons'
import { mountLetterNarrator } from './letterNarrator'
import { letterFromDefault } from './letterDefaults'
import { startVoiceTyping } from './voiceTyping'

type LetterAppearance = 'dawn' | 'botanical'

export interface LetterPayload {
  appearance: LetterAppearance
  from: string
  to: string
}

const LETTER_THEME_CSS = `
.letter-sheet { display: block; font-family: 'Dancing Script', cursive; aspect-ratio: 210 / 297; width: 100%; max-width: 680px; margin: 0 auto 16px; background: #fff; color: #000; fill: #000; }
.letter-sheet__date { text-align: right; margin-bottom: 20px; }
.letter-sheet__body { white-space: pre-wrap; padding-left: 28px; margin-top: 20px; }
.letter-sheet__from { margin-top: auto; padding-top: 32px; text-align: right; white-space: pre-wrap; }
`

function normalize(p: Partial<LetterPayload> | null | undefined): LetterPayload {
  const appearance: LetterAppearance = p?.appearance === 'botanical' ? 'botanical' : 'dawn'
  return { appearance, from: p?.from ?? '', to: p?.to ?? '' }
}

function letterSheet(body: string, p: LetterPayload, createdAt: string): HTMLElement {
  const holder = document.createElement('div')
  holder.className = 'letter-pages'
  void layoutLetter(body, p.to, p.from, createdAt).then((layout) => {
    const ns = 'http://www.w3.org/2000/svg'
    for (const [index, page] of layout.pages.entries()) {
      const sheet = document.createElementNS(ns, 'svg')
      sheet.classList.add('letter-sheet')
      sheet.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`)
      sheet.setAttribute('role', 'img')
      sheet.setAttribute('aria-label', `Letter page ${index + 1}: ${index === 0 ? `Dear ${p.to}. ` : ''}${layout.body.slice(page.from, page.to).join(' ')}${page.signature ? ` With love, ${p.from}.` : ''}`)
      let y = layout.margin
      const draw = (lines: string[], x: number, right = false, className = '') => {
        const group = document.createElementNS(ns, 'g')
        if (className) group.classList.add(className)
        for (const text of lines) {
          const node = document.createElementNS(ns, 'text')
          node.setAttribute('x', String(x)); node.setAttribute('y', String(y))
          node.setAttribute('dominant-baseline', 'text-before-edge'); node.setAttribute('text-anchor', right ? 'end' : 'start')
          node.setAttribute('font-size', String(layout.size)); node.textContent = text
          if (group.childNodes.length) group.append(document.createTextNode('\n'))
          group.append(node); y += layout.line
        }
        sheet.append(group)
      }
      if (!index) { draw(layout.date, layout.width - layout.margin, true, 'letter-sheet__date'); y += 18; draw(layout.dear, layout.margin); y += 18 }
      draw(layout.body.slice(page.from, page.to), layout.margin + 28, false, 'letter-sheet__body')
      if (page.signature) { y = layout.height - layout.margin - layout.signature.length * layout.line; draw(layout.signature, layout.width - layout.margin, true, 'letter-sheet__from') }
      holder.append(sheet)
    }
  }).catch(() => { holder.textContent = 'Could not display this letter. Close and try again.' })
  return holder
}

function themeStyle(): HTMLStyleElement {
  const s = document.createElement('style')
  s.textContent = LETTER_THEME_CSS
  return s
}

// Viewer: opens a received letter, styled, with a Download button.
export function openLetter(body: string, payload: Partial<LetterPayload> | null, createdAt = new Date().toISOString(), ids?: {connection:string;message:string}): () => void {
  const p = normalize(payload)
  const wrap = document.createElement('div')
  wrap.className = 'letter-view'

  const holder = letterSheet(body, p, createdAt)

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

  const heading = document.createElement('div')
  heading.className = 'letter-view__heading'
  const title = document.createElement('h2'); title.textContent = 'Letter'
  const speaker = document.createElement('button'); speaker.type = 'button'
  speaker.innerHTML = SPEAKER_ICON
  const speechControls = document.createElement('div'); speechControls.className = 'letter-speech-controls'
  const stop = mountLetterNarrator(speaker, speechControls, status, `Dear ${p.to}. ${body}. With love, ${p.from}.`, ids)
  heading.append(title, speaker)
  actions.prepend(speechControls)
  wrap.append(themeStyle(), heading, holder, actions)
  const modal = openModal(wrap, { onClose: stop })
  modal.panel.classList.add('letter-modal')
  return modal.close
}

// Composer: write, preview, then send using the existing wire format.
export function openLetterComposer(opts: { toName: string; myNickname?: string | null; notice?: (text: string) => void; onSend: (body: string, payload: LetterPayload) => void }): () => void {
  const { toName, onSend } = opts
  const container = document.createElement('div')
  container.className = 'letter-compose'

  let body = ''
  let to = toName
  let from = ''
  try {
    from = localStorage.getItem('letterFrom') ?? ''
  } catch {
    /* ignore */
  }
  from = letterFromDefault(opts.myNickname, from)
  let stopReading = () => {}, stopDictation = () => {}
  const stop = () => { stopReading(); stopDictation() }
  const modal = openModal(container, { onClose: stop })
  modal.panel.classList.add('letter-modal')

  const renderWrite = (): void => {
    stop()
    container.innerHTML = `
      <div class="letter-compose__title">Write a letter</div>
      <label class="letter-compose__to">To <input id="letter-to" maxlength="40" aria-label="Letter recipient" /></label>
      <div class="letter-compose__label"><label for="letter-body">Your letter</label><button type="button" id="letter-mic" aria-label="Dictate your letter">${MIC_ICON}</button></div>
      <textarea id="letter-body" class="letter-compose__body" rows="8" maxlength="4000" aria-label="Letter" placeholder="Dear ${escapeHtml(toName)},"></textarea>
      <input id="letter-from" class="letter-compose__from" maxlength="40" aria-label="Your signature" placeholder="From — your name / signature" />
      <div class="letter-compose__actions">
        <button type="button" id="letter-cancel">Cancel</button>
        <button type="button" id="letter-next" class="primary">Next</button>
      </div>
    `
    const bodyEl = container.querySelector<HTMLTextAreaElement>('#letter-body')!
    const fromEl = container.querySelector<HTMLInputElement>('#letter-from')!
    const toEl = container.querySelector<HTMLInputElement>('#letter-to')!
    toEl.value = to
    toEl.addEventListener('input', () => (to = toEl.value))
    bodyEl.value = body
    fromEl.value = from
    bodyEl.addEventListener('input', () => (body = bodyEl.value))
    fromEl.addEventListener('input', () => (from = fromEl.value))
    container.querySelector('#letter-mic')!.addEventListener('click', () => {
      stopDictation()
      stopDictation = startVoiceTyping(container.querySelector('.letter-compose__label')!, bodyEl, opts.notice || (() => {}))
    })
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
    stop()
    const p: LetterPayload = { appearance: 'dawn', from: from.trim() || 'me', to: to.trim() || toName }
    container.innerHTML = ''

    const title = document.createElement('div')
    title.className = 'letter-compose__title'
    title.textContent = 'Preview'

    const holder = letterSheet(body, p, new Date().toISOString())

    const actions = document.createElement('div')
    actions.className = 'letter-compose__actions'
    const back = document.createElement('button')
    back.type = 'button'
    back.textContent = 'Edit'
    back.addEventListener('click', renderWrite)
    const send = document.createElement('button')
    send.type = 'button'
    send.className = 'primary'
    send.textContent = 'Send letter'
    send.addEventListener('click', () => {
      stop()
      try {
        localStorage.setItem('letterFrom', from.trim())
      } catch {
        /* ignore */
      }
      onSend(body.trim(), p)
      modal.close()
    })
    actions.append(back, send)
    const speaker = document.createElement('button'); speaker.type = 'button'; speaker.innerHTML = SPEAKER_ICON
    const controls = document.createElement('div'); controls.className = 'letter-speech-controls'
    const status = document.createElement('p'); status.setAttribute('role', 'status')
    stopReading = mountLetterNarrator(speaker, controls, status, `Dear ${p.to}. ${body}. With love, ${p.from}.`)
    title.append(speaker)
    container.append(title, themeStyle(), holder, controls, status, actions)
  }

  renderWrite()
  return modal.close
}
