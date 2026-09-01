import { Router, raw } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { strictLimiter } from '../middleware/rateLimit.js'
import { ConnectionError } from '../utils/connectionError.js'
import { getConnectionForMember } from '../services/connectionAccess.js'
import { isAttachmentKind, signAttachments, uploadAttachment } from '../services/attachmentService.js'

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
