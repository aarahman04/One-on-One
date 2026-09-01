// MediaRecorder wrapper for voice notes. One instance per recording: start
// asks for mic permission and begins capturing, stop()/cancel() end it.

export interface VoiceRecording {
  blob: Blob
  durationSec: number
}

export interface VoiceRecorderHandle {
  stop: () => Promise<VoiceRecording>
  cancel: () => void
}

// Rough preference order — the first the browser's MediaRecorder actually
// supports wins. Chrome/Android produce webm/opus; Safari only does mp4/aac.
// All are in the backend's voice mime allowlist (attachmentService.ts).
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']

function pickMimeType(): string {
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return ''
}

export async function startRecording(): Promise<VoiceRecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = pickMimeType()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: BlobPart[] = []
  const startedAt = Date.now()

  recorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  })

  const stopTracks = (): void => {
    for (const track of stream.getTracks()) track.stop()
  }

  recorder.start()

  const waitForStop = (): Promise<Blob> =>
    new Promise((resolve) => {
      recorder.addEventListener(
        'stop',
        () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' })),
        { once: true },
      )
      if (recorder.state !== 'inactive') recorder.stop()
    })

  return {
    stop: async () => {
      const blob = await waitForStop()
      stopTracks()
      return { blob, durationSec: (Date.now() - startedAt) / 1000 }
    },
    cancel: () => {
      if (recorder.state !== 'inactive') recorder.stop()
      stopTracks()
    },
  }
}
