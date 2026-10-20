import { canUseDeviceSpeech, narrationPart, speechNotice } from '../services/speechService'

export function mountLetterNarrator(
  speaker: HTMLButtonElement,
  controls: HTMLElement,
  status: HTMLElement,
  text: string,
  ids?: { connection: string; message: string },
) {
  let state: 'idle' | 'loading' | 'playing' | 'paused' = 'idle',
    generation = 0,
    controller: AbortController | null = null,
    audio: HTMLAudioElement | null = null,
    url = '',
    device = false,
    utterance: SpeechSynthesisUtterance | null = null,
    paused = false,
    trackReady = false
  const pause = document.createElement('button'),
    stopButton = document.createElement('button')
  pause.type = stopButton.type = 'button'
  stopButton.textContent = 'Stop reading'
  controls.append(pause, stopButton)
  const update = () => {
    speaker.setAttribute('aria-label', state === 'idle' ? 'Read letter aloud' : 'Stop reading')
    speaker.setAttribute('aria-busy', String(state === 'loading'))
    controls.hidden = state === 'idle'
    pause.textContent = paused ? 'Resume reading' : 'Pause reading'
    pause.disabled = state === 'loading' && !audio
  }
  const releaseAudio = () => {
    trackReady = false
    if (audio) {
      audio.pause()
      audio.onended = audio.onerror = null
      audio.removeAttribute('src')
      audio.load()
      audio = null
    }
    if (url) {
      URL.revokeObjectURL(url)
      url = ''
    }
  }
  const stop = () => {
    generation++
    controller?.abort()
    controller = null
    releaseAudio()
    if (device) window.speechSynthesis?.cancel()
    if (utterance) utterance.onend = utterance.onerror = null
    utterance = null
    device = false
    paused = false
    state = 'idle'
    status.textContent = ''
    update()
  }
  const fallback = (run: number) => {
    if (run !== generation) return
    controller?.abort()
    releaseAudio()
    if (!window.speechSynthesis) {
      stop()
      status.textContent = 'Reading aloud is not supported in this browser.'
      return
    }
    status.textContent = 'Natural voice unavailable, using device voice.'
    device = true
    state = 'playing'
    paused = false
    utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-US'
    utterance.onend = () => {
      if (run === generation) stop()
    }
    utterance.onerror = () => {
      if (run === generation) {
        stop()
        status.textContent = 'Could not read the letter aloud. Try again.'
      }
    }
    window.speechSynthesis.speak(utterance)
    update()
  }
  const start = async () => {
    stop()
    const run = generation
    controller = new AbortController()
    const signal = controller.signal
    state = 'loading'
    status.textContent = 'Loading natural voice… The first request can take about a minute.'
    update()
    if (!ids) {
      fallback(run)
      return
    }
    try {
      const first = await narrationPart(ids.connection, ids.message, 0, signal)
      let next: Promise<{ blob: Blob; total: number } | { error: unknown }> = Promise.resolve(first)
      for (let part = 0; part < first.total; part++) {
        const loaded = await next
        if (run !== generation) return
        if ('error' in loaded) throw loaded.error
        if (loaded.total !== first.total) throw new TypeError('Narration changed')
        if (part + 1 < first.total)
          next = narrationPart(ids.connection, ids.message, part + 1, signal).catch((error: unknown) => ({ error }))
        if (url) URL.revokeObjectURL(url)
        url = URL.createObjectURL(loaded.blob)
        audio ??= new Audio()
        audio.src = url
        trackReady = true
        state = paused ? 'paused' : 'playing'
        status.textContent = `Natural voice · part ${part + 1} of ${first.total} · English`
        update()
        await new Promise<void>((resolve, reject) => {
          const player = audio!
          const abort = () => reject(new DOMException('Stopped', 'AbortError'))
          signal.addEventListener('abort', abort, { once: true })
          const finish = (error?: unknown) => {
            trackReady = false
            signal.removeEventListener('abort', abort)
            if (error) reject(error)
            else resolve()
          }
          player.onended = () => finish()
          player.onerror = () => finish(new TypeError('Audio playback failed'))
          if (!paused)
            void player.play().catch((error) => {
              if (error instanceof DOMException && error.name === 'NotAllowedError') {
                paused = true
                state = 'paused'
                status.textContent = 'Tap Resume reading to hear this letter.'
                update()
              } else finish(error)
            })
        })
        if (run === generation) {
          state = 'loading'
          update()
        }
      }
      if (run === generation) stop()
    } catch (error) {
      if (run !== generation) return
      if (canUseDeviceSpeech(error)) fallback(run)
      else {
        stop()
        status.textContent = speechNotice(error)
      }
    }
  }
  speaker.onclick = () => {
    if (state !== 'idle') stop()
    else void start()
  }
  stopButton.onclick = stop
  pause.onclick = () => {
    paused = !paused
    state = paused ? 'paused' : 'playing'
    if (device) {
      if (paused) window.speechSynthesis.pause()
      else window.speechSynthesis.resume()
    } else if (audio && trackReady) {
      if (paused) audio.pause()
      else
        void audio.play().catch(() => {
          stop()
          status.textContent = 'Tap the speaker to try again.'
        })
    }
    update()
  }
  const hidden = () => {
    if (document.hidden) stop()
  }
  document.addEventListener('visibilitychange', hidden)
  update()
  return () => {
    stop()
    document.removeEventListener('visibilitychange', hidden)
  }
}
