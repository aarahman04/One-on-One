interface RecognitionResult { isFinal: boolean; [index: number]: { transcript: string } }
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export function startVoiceTyping(composer: HTMLElement, input: HTMLTextAreaElement, notice: (text: string) => void): () => void {
  const browser = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition
  if (!Constructor) { notice("Voice typing isn't supported in this browser"); return () => {} }
  const recognition = new Constructor(), bar = document.createElement('div')
  recognition.lang = navigator.language; recognition.interimResults = true; recognition.continuous = false
  bar.className = 'voice-typing'
  bar.innerHTML = '<span role="status">Listening…</span><button type="button" data-stop>Stop</button><button type="button" data-cancel>Cancel</button>'
  composer.before(bar)
  let active = true
  const finish = () => { active = false; clearTimeout(timer); bar.remove(); document.removeEventListener('visibilitychange', hidden) }
  const cancel = () => { if (!active) return; finish(); recognition.abort() }
  const hidden = () => { if (document.hidden) cancel() }
  const timer = setTimeout(() => recognition.stop(), 120_000)
  document.addEventListener('visibilitychange', hidden)
  bar.querySelector('[data-stop]')!.addEventListener('click', () => recognition.stop())
  bar.querySelector('[data-cancel]')!.addEventListener('click', cancel)
  recognition.onresult = (event) => {
    if (!active) return
    let partial = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i], text = result[0].transcript.trim()
      if (result.isFinal && text) {
        const draft = [input.value.trimEnd(), text].filter(Boolean).join(' ')
        const limit = input.maxLength > 0 ? input.maxLength : 4000
        if (draft.length > limit) { notice('Your message is full. Send or shorten it before adding more.'); continue }
        input.value = draft
        input.dispatchEvent(new Event('input', { bubbles: true }))
      } else partial += text
    }
    bar.querySelector('span')!.textContent = partial || 'Listening…'
  }
  recognition.onerror = ({ error }) => {
    if (!active) return
    if (error !== 'aborted') notice(error === 'not-allowed' ? 'Allow microphone access to use voice typing.' : error === 'no-speech' ? "Didn't catch that. Try again." : 'Voice typing could not start. Try again.')
    cancel()
  }
  recognition.onend = () => { if (active) { finish(); input.focus() } }
  try { recognition.start() } catch { cancel(); notice('Voice typing could not start. Try again.') }
  return cancel
}
