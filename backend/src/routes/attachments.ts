import { Router, raw } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { previewLimiter, strictLimiter } from '../middleware/rateLimit.js'
import { ConnectionError } from '../utils/connectionError.js'
import { getConnectionForMember } from '../services/connectionAccess.js'
import { isAttachmentKind, signAttachments, uploadAttachment } from '../services/attachmentService.js'
import { getLiveConnectionForUser } from '../services/connectionAccess.js'
import { attachGif, searchGifs } from '../services/gifService.js'

export const attachmentsRouter = Router()

attachmentsRouter.use(requireAuth)

// Raw body, scoped to this route only — the app-wide express.json() limit
// (32kb) stays put for every other endpoint. 26mb gives the 25mb file cap
// a little headroom for transport overhead.
attachmentsRouter.post(
  '/connections/:id/attachments',
  strictLimiter,
  raw({ type: '*/*', limit: '26mb' }),
  async (req, res) => {
    const user = req.appUser!
    const connectionId = String(req.params.id)
    await getConnectionForMember(connectionId, user.id, { requireLive: true })

    const kind = req.query.kind
    if (!isAttachmentKind(kind)) throw new ConnectionError(400, 'invalid attachment kind')
    if (!Buffer.isBuffer(req.body)) throw new ConnectionError(400, 'missing upload body')

    const contentType = req.headers['content-type']
    const mime = (Array.isArray(contentType) ? contentType[0] : (contentType ?? '')).split(';')[0].trim()
    const result = await uploadAttachment(connectionId, kind, req.body, mime)
    res.status(201).json(result)
  },
)

// GIPHY search / trending (empty q). Only for someone with a live connection.
attachmentsRouter.get('/gifs', previewLimiter, async (req, res) => {
  if (!(await getLiveConnectionForUser(req.appUser!.id))) throw new ConnectionError(409, 'connection is not active')
  res.set('Cache-Control', 'private, max-age=600')
  res.json(await searchGifs(req.query.q, req.query.offset))
})

// Store GIPHY gif {id} as an image/gif attachment; the client then sends a normal image message with it.
attachmentsRouter.post('/connections/:id/gifs', previewLimiter, async (req, res) => {
  const connectionId = String(req.params.id)
  await getConnectionForMember(connectionId, req.appUser!.id, { requireLive: true })
  res.status(201).json(await attachGif(connectionId, req.body?.id))
})

// Private bucket — the client never gets a durable URL, only short-lived
// signed ones it fetches (batched) right before rendering.
attachmentsRouter.post('/connections/:id/attachments/signed', async (req, res) => {
  const user = req.appUser!
  const connectionId = req.params.id
  await getConnectionForMember(connectionId, user.id, { requireLive: true })

  const paths = Array.isArray(req.body?.paths) ? req.body.paths.filter((p: unknown) => typeof p === 'string') : []
  const prefix = `${connectionId}/`
  if (paths.some((p: string) => !p.startsWith(prefix))) {
    throw new ConnectionError(403, 'attachment does not belong to this connection')
  }

  const urls = await signAttachments(paths)
  res.json({ urls })
})
