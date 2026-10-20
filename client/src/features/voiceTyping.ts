import { startRecording, type VoiceRecorderHandle } from './voiceRecorder'
import { canUseDeviceSpeech, transcribe, speechNotice } from '../services/speechService'

interface RecognitionResult {
  isFinal: boolean
  [index: number]: { transcript: string }
}
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

function startDeviceVoiceTyping(
  composer: HTMLElement,
  input: HTMLTextAreaElement,
  notice: (text: string) => void,
  done: () => void,
): () => void {
  const browser = window as unknown as {
    SpeechRecognition?: new () => Recognition
    webkitSpeechRecognition?: new () => Recognition
  }
  const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition
  if (!Constructor) {
    notice("Voice typing isn't supported in this browser")
    done()
    return () => {}
  }
  const recognition = new Constructor(),
    bar = document.createElement('div')
  recognition.lang = navigator.language
  recognition.interimResults = true
  recognition.continuous = false
  bar.className = 'voice-typing'
  bar.innerHTML =
    '<span role="status">Listening…</span><button type="button" data-stop>Stop</button><button type="button" data-cancel>Cancel</button>'
  composer.before(bar)
  let active = true
  const finish = () => {
    active = false
    clearTimeout(timer)
    bar.remove()
    document.removeEventListener('visibilitychange', hidden)
    recognition.onresult = recognition.onerror = recognition.onend = null
    done()
  }
  const cancel = () => {
    if (!active) return
    finish()
    recognition.abort()
  }
  const hidden = () => {
    if (document.hidden) cancel()
  }
  const timer = setTimeout(() => recognition.stop(), 120_000)
  document.addEventListener('visibilitychange', hidden)
  bar.querySelector('[data-stop]')!.addEventListener('click', () => recognition.stop())
  bar.querySelector('[data-cancel]')!.addEventListener('click', cancel)
  recognition.onresult = (event) => {
    if (!active) return
    let partial = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i],
        text = result[0].transcript.trim()
      if (result.isFinal && text) {
        const draft = [input.value.trimEnd(), text].filter(Boolean).join(' ')
        const limit = input.maxLength > 0 ? input.maxLength : 4000
        if (draft.length > limit) {
          notice('Your message is full. Send or shorten it before adding more.')
          continue
        }
        input.value = draft
        input.dispatchEvent(new Event('input', { bubbles: true }))
      } else partial += text
    }
    bar.querySelector('span')!.textContent = partial || 'Listening…'
  }
  recognition.onerror = ({ error }) => {
    if (!active) return
    if (error !== 'aborted')
      notice(
        error === 'not-allowed'
          ? 'Allow microphone access to use voice typing.'
          : error === 'no-speech'
            ? "Didn't catch that. Try again."
            : 'Voice typing could not start. Try again.',
      )
    cancel()
  }
  recognition.onend = () => {
    if (active) {
      finish()
      input.focus()
    }
  }
  try {
    recognition.start()
  } catch {
    cancel()
    notice('Voice typing could not start. Try again.')
  }
  return cancel
}

export function startVoiceTyping(
  composer: HTMLElement,
  input: HTMLTextAreaElement,
  notice: (text: string) => void,
): () => void {
  let active = true,
    handle: VoiceRecorderHandle | null = null,
    stopDevice = () => {},
    timer: ReturnType<typeof setInterval> | undefined,
    elapsed = 0,
    uploading = false
  const controller = new AbortController(),
    bar = document.createElement('div')
  composer.dataset.dictating = 'true'
  bar.className = 'voice-typing'
  bar.innerHTML =
    '<span role="status">Starting microphone…</span><button type="button" data-stop>Transcribe</button><button type="button" data-cancel>Cancel</button>'
  composer.before(bar)
  const finish = () => {
    active = false
    clearInterval(timer)
    handle?.cancel()
    handle = null
    bar.remove()
    delete composer.dataset.dictating
    document.removeEventListener('visibilitychange', hidden)
  }
  const cancel = () => {
    if (!active) return
    controller.abort()
    stopDevice()
    finish()
  }
  const hidden = () => {
    if (document.hidden) cancel()
  }
  const fallback = () => {
    finish()
    notice('Natural voice unavailable, using device recognition. Speak again.')
    // Device recognition owns its own cancellation; keep the same returned cancel handle.
    active = true
    composer.dataset.dictating = 'true'
    stopDevice = startDeviceVoiceTyping(composer, input, notice, () => {
      delete composer.dataset.dictating
      active = false
    })
  }
  const append = (text: string) => {
    const draft = [input.value.trimEnd(), text].filter(Boolean).join(' '),
      limit = input.maxLength > 0 ? input.maxLength : 4000
    if (draft.length > limit) {
      notice('Your message is full. Send or shorten it before adding more.')
      return
    }
    input.value = draft
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
  }
  const submit = async () => {
    if (!active || uploading || !handle) return
    uploading = true
    clearInterval(timer)
    bar.querySelector<HTMLButtonElement>('[data-stop]')!.disabled = true
    bar.querySelector('span')!.textContent = 'Transcribing… The first request can take about a minute.'
    try {
      const recording = await handle.stop()
      handle = null
      if (!active) return
      const text = await transcribe(recording.blob, controller.signal)
      if (!active) return
      finish()
      append(text)
    } catch (error) {
      if (!active) return
      if (canUseDeviceSpeech(error)) fallback()
      else {
        finish()
        notice(speechNotice(error))
      }
    }
  }
  bar.querySelector('[data-stop]')!.addEventListener('click', () => {
    void submit()
  })
  bar.querySelector('[data-cancel]')!.addEventListener('click', cancel)
  document.addEventListener('visibilitychange', hidden)
  try {
    if (!localStorage.getItem('speechEnglishHint')) {
      notice('Natural voice and transcription support English only.')
      localStorage.setItem('speechEnglishHint', '1')
    }
  } catch {
    /* hint is optional */
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    fallback()
    return cancel
  }
  void startRecording()
    .then((recording) => {
      if (!active) {
        recording.cancel()
        return
      }
      handle = recording
      bar.querySelector('span')!.textContent = 'Listening… 0:00'
      timer = setInterval(() => {
        elapsed++
        bar.querySelector('span')!.textContent =
          `Listening… ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
        if (elapsed >= 120) void submit()
      }, 1000)
    })
    .catch(() => {
      if (active) {
        finish()
        notice('Allow microphone access to use voice typing.')
      }
    })
  return cancel
}
