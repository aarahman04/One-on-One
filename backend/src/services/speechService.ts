// Client for the private `speech` service (speech/, Railway private network).
// Node does no audio or model work: it authorizes, picks the DB text, and
// proxies. See docs/SPEECH-SERVICE.md and API-CONTRACT.md "Speech (2.0.6)".
import { ConnectionError } from '../utils/connectionError.js'

export const NARRATION_PART_CHARS = 400
const TTS_TIMEOUT_MS = 60_000
const STT_TIMEOUT_MS = 90_000

export const TRANSCRIBE_TYPES = ['audio/mp4', 'audio/m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/wav']
export const TRANSCRIBE_MAX_BYTES = 3 * 1024 * 1024

const unavailable = () => new ConnectionError(503, 'speech is unavailable right now', 'speech_unavailable')
const timedOut = () => new ConnectionError(504, 'speech took too long', 'speech_timeout')

// What the letter shows, as spoken paragraphs: salutation, body, signature.
export function narrationParagraphs(letter: { from: string; to: string; body: string }): string[] {
  const body = letter.body.split(/\s*\n\s*/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  return [`Dear ${letter.to.trim()}.`, ...body, `With love, ${letter.from.trim()}.`]
}

// Pieces of one paragraph no longer than max: sentences, then words, and only a
// single word longer than max (e.g. a URL) is cut mid-word.
function pieces(paragraph: string, max: number): string[] {
  const out: string[] = []
  for (const sentence of paragraph.split(/(?<=[.!?…]["'”’)\]]?)\s+/)) {
    if (sentence.length <= max) {
      out.push(sentence)
      continue
    }
    let cur = ''
    for (let word of sentence.split(' ')) {
      while (word.length > max) {
        if (cur) out.push(cur)
        cur = ''
        out.push(word.slice(0, max))
        word = word.slice(max)
      }
      if (!word) continue
      if (cur && cur.length + 1 + word.length > max) {
        out.push(cur)
        cur = word
      } else cur = cur ? `${cur} ${word}` : word
    }
    if (cur) out.push(cur)
  }
  return out
}

// Deterministic: the same letter always yields the same parts, so part N is
// stable across calls. Paragraph breaks stay as "\n\n" (the service pauses there).
export function splitNarration(paragraphs: string[], max = NARRATION_PART_CHARS): string[] {
  const parts: string[] = []
  let cur = ''
  for (const paragraph of paragraphs) {
    pieces(paragraph, max).forEach((piece, i) => {
      const sep = cur ? (i === 0 ? '\n\n' : ' ') : ''
      if (cur && cur.length + sep.length + piece.length > max) {
        parts.push(cur)
        cur = piece
      } else cur += sep + piece
    })
  }
  if (cur) parts.push(cur)
  return parts
}

// fetch to the speech service with its shared token and a hard timeout.
// The timer stays armed until `done()` so a streamed body is covered too.
async function speechFetch(path: string, init: RequestInit, timeoutMs: number): Promise<{ upstream: Response; ctrl: AbortController; done: () => void }> {
  const base = process.env.SPEECH_SERVICE_URL
  const token = process.env.SPEECH_SERVICE_TOKEN
  if (!base || !token) throw unavailable()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs)
  const done = () => clearTimeout(timer)
  let upstream: Response
  try {
    upstream = await fetch(new URL(path, base), {
      ...init,
      headers: { ...(init.headers as Record<string, string>), 'X-Speech-Token': token },
      signal: ctrl.signal,
    })
  } catch {
    done()
    throw ctrl.signal.aborted ? timedOut() : unavailable()
  }
  if (!upstream.ok) {
    done()
    await upstream.body?.cancel().catch(() => {})
    if (upstream.status === 413) throw new ConnectionError(413, 'audio is too long', 'too_large')
    if (upstream.status === 415) throw new ConnectionError(415, 'unsupported audio', 'unsupported_audio')
    if (upstream.status === 504) throw timedOut()
    throw unavailable()
  }
  return { upstream, ctrl, done }
}

export async function synthesize(text: string) {
  return speechFetch(
    '/tts',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: 'af_heart', speed: 1.0 }) },
    TTS_TIMEOUT_MS,
  )
}

export async function transcribe(audio: Buffer, contentType: string): Promise<{ text: string; language: string; durationMs: number }> {
  const { upstream, ctrl, done } = await speechFetch(
    '/stt',
    { method: 'POST', headers: { 'Content-Type': contentType }, body: new Uint8Array(audio) },
    STT_TIMEOUT_MS,
  )
  try {
    const out = (await upstream.json()) as { text?: unknown; language?: unknown; durationMs?: unknown }
    return {
      text: typeof out.text === 'string' ? out.text.trim() : '',
      language: typeof out.language === 'string' ? out.language : '',
      durationMs: Number.isFinite(out.durationMs) ? Number(out.durationMs) : 0,
    }
  } catch {
    throw ctrl.signal.aborted ? timedOut() : unavailable()
  } finally {
    done()
  }
}
