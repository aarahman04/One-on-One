import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { Router, raw, type RequestHandler } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import {
  narrationDailyLimiter,
  narrationLimiter,
  speechGlobalDailyLimiter,
  transcribeDailyLimiter,
  transcribeLimiter,
} from '../middleware/rateLimit.js'
import { ConnectionError } from '../utils/connectionError.js'
import { getConnectionForMember, getLiveConnectionForUser } from '../services/connectionAccess.js'
import { getLetterForNarration } from '../services/messageService.js'
import {
  TRANSCRIBE_MAX_BYTES,
  TRANSCRIBE_TYPES,
  narrationParagraphs,
  splitNarration,
  synthesize,
  transcribe,
} from '../services/speechService.js'

export const speechRouter = Router()

const notFound = () => new ConnectionError(404, 'not found', 'not_found')
// A malformed id would be a Postgres cast error (500) instead of the uniform 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Narration of one part of a letter. Text comes only from the DB. Any reason the
// caller can't have it (not a member, other connection, not a letter, deleted,
// bad part) is the same 404 so existence never leaks.
speechRouter.get(
  '/connections/:connectionId/messages/:messageId/narration',
  requireAuth,
  narrationLimiter,
  narrationDailyLimiter,
  speechGlobalDailyLimiter,
  async (req, res) => {
    const connectionId = String(req.params.connectionId)
    if (!UUID_RE.test(connectionId)) throw notFound()
    try {
      await getConnectionForMember(connectionId, req.appUser!.id, { requireLive: true, allowEndedPartner: true })
    } catch (err) {
      if (err instanceof ConnectionError) throw notFound()
      throw err
    }
    const letter = await getLetterForNarration(connectionId, String(req.params.messageId))
    if (!letter) throw notFound()

    const rawPart = req.query.part ?? '0'
    const part = typeof rawPart === 'string' && /^\d{1,4}$/.test(rawPart) ? Number(rawPart) : -1
    const parts = splitNarration(narrationParagraphs(letter))
    if (part < 0 || part >= parts.length) throw notFound()

    const { upstream, ctrl, done } = await synthesize(parts[part])
    res.status(200).set({
      'Content-Type': 'audio/ogg',
      'X-Narration-Part': String(part),
      'X-Narration-Parts': String(parts.length),
      'Cache-Control': 'private, no-store',
    })
    const len = upstream.headers.get('content-length')
    if (len) res.set('Content-Length', len)
    res.on('close', () => {
      done()
      ctrl.abort()
    })
    // Stream through; a mid-body upstream failure just ends the response.
    Readable.fromWeb(upstream.body as WebReadableStream).on('error', () => res.destroy()).pipe(res)
  },
)

// Raw body scoped to this route; an oversize body becomes 413 too_large.
const audioBody: RequestHandler = (req, res, next) =>
  raw({ type: () => true, limit: TRANSCRIBE_MAX_BYTES })(req, res, (err?: unknown) => {
    if ((err as { type?: string } | undefined)?.type === 'entity.too.large') {
      next(new ConnectionError(413, 'audio is too large', 'too_large'))
    } else next(err)
  })

// Speech-to-text for the composer. The client inserts the text; nothing is sent.
speechRouter.post('/transcribe', requireAuth, transcribeLimiter, transcribeDailyLimiter, speechGlobalDailyLimiter, async (req, res, next) => {
  const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  if (!TRANSCRIBE_TYPES.includes(mime)) throw new ConnectionError(415, 'unsupported audio', 'unsupported_audio')
  if (!(await getLiveConnectionForUser(req.appUser!.id))) throw new ConnectionError(409, 'connection is not active')
  audioBody(req, res, async (err?: unknown) => {
    try {
      if (err) throw err
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new ConnectionError(415, 'unsupported audio', 'unsupported_audio')
      const result = await transcribe(req.body, mime)
      if (!result.text) throw new ConnectionError(422, 'no speech detected', 'no_speech')
      res.json(result)
    } catch (e) {
      next(e)
    }
  })
})
