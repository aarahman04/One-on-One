import { Router, raw } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { strictLimiter } from '../middleware/rateLimit.js'
import { ConnectionError } from '../utils/connectionError.js'
import { avatarUrls, removeAvatar, setAvatar } from '../services/avatarService.js'
import { deleteAccount, regenerateConnectionCode } from '../services/userService.js'
import { listBlocks, removeBlock } from '../services/blockService.js'

export const meRouter = Router()

meRouter.get('/me', requireAuth, async (req, res) => {
  const user = req.appUser!
  res.json({ userId: user.id, connectionCode: user.connectionCode })
})

meRouter.post('/me/connection-code/regenerate', requireAuth, async (req, res) => {
  const user = req.appUser!
  const connectionCode = await regenerateConnectionCode(user.id)
  res.json({ connectionCode })
})

// Account deletion (Google Play policy — in-app + web). Backend-enforced:
// deletes the Supabase auth user, which cascades away everything this user owns.
meRouter.delete('/me', requireAuth, async (req, res) => {
  await deleteAccount(req.appUser!)
  res.status(204).end()
})

// Own profile photo. Raw image body (jpeg/png/webp, ≤2 MiB, magic bytes checked).
meRouter.put('/me/avatar', requireAuth, strictLimiter, raw({ type: '*/*', limit: '3mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new ConnectionError(400, 'missing upload body')
  const contentType = req.headers['content-type'] ?? ''
  const mime = (Array.isArray(contentType) ? contentType[0] : contentType).split(';')[0].trim()
  res.json(await setAvatar(req.appUser!.id, req.body, mime))
})

meRouter.delete('/me/avatar', requireAuth, async (req, res) => {
  await removeAvatar(req.appUser!.id)
  res.status(204).end()
})

// Signed (1 h) URLs for your photo and your live partner's — never anyone else's.
meRouter.get('/me/avatars', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'private, no-store')
  res.json(await avatarUrls(req.appUser!.id))
})

meRouter.get('/me/blocks', requireAuth, async (req, res) => {
  const blocks = await listBlocks(req.appUser!.id)
  res.json({ blocks })
})

meRouter.delete('/me/blocks/:blockedUserId', requireAuth, async (req, res) => {
  await removeBlock(req.appUser!.id, String(req.params.blockedUserId))
  res.status(204).end()
})
