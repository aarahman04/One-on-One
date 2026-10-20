import { authedFetch } from './apiClient'

export class SpeechFailure extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}
export function canUseDeviceSpeech(error: unknown): boolean {
  return error instanceof SpeechFailure
    ? error.status === 503 || error.status === 504 || (error.status === 429 && error.code === 'quota_exceeded')
    : error instanceof TypeError ||
        (error instanceof DOMException && ['NetworkError', 'TimeoutError'].includes(error.name))
}
export function speechNotice(error: unknown): string {
  if (error instanceof SpeechFailure) {
    if (error.status === 404) return 'This letter is no longer available.'
    if (error.code === 'no_speech') return "Didn't catch that. Try again."
    if (error.status === 413) return 'Keep recordings under two minutes and 3 MB.'
    if (error.status === 429) return 'Too many requests. Try again in a minute.'
  }
  return 'Speech is unavailable. Try again.'
}
async function checked(res: Response) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new SpeechFailure(res.status, body.code || 'speech_failed')
  }
  return res
}
export async function narrationPart(connection: string, message: string, part: number, signal: AbortSignal) {
  const res = await checked(
    await authedFetch(
      `/api/connections/${encodeURIComponent(connection)}/messages/${encodeURIComponent(message)}/narration?part=${part}`,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(95_000)]), cache: 'no-store' },
    ),
  )
  const index = res.headers.get('X-Narration-Part'),
    parts = res.headers.get('X-Narration-Parts'),
    total = Number(parts)
  if (
    index !== String(part) ||
    !parts ||
    !Number.isSafeInteger(total) ||
    total <= part ||
    total > 128 ||
    !res.headers.get('Content-Type')?.startsWith('audio/ogg')
  )
    throw new TypeError('Invalid narration response')
  const blob = await res.blob()
  if (!blob.size) throw new TypeError('Empty narration')
  return { blob, total }
}
export async function transcribe(blob: Blob, signal: AbortSignal): Promise<string> {
  if (blob.size > 3_000_000) throw new SpeechFailure(413, 'too_large')
  const res = await checked(
    await authedFetch('/api/transcribe', {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': blob.type },
      signal: AbortSignal.any([signal, AbortSignal.timeout(125_000)]),
    }),
  )
  const result = await res.json()
  if (typeof result.text !== 'string' || !result.text.trim()) throw new SpeechFailure(422, 'no_speech')
  return result.text.trim()
}
