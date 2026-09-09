import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
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

meRouter.get('/me/blocks', requireAuth, async (req, res) => {
  const blocks = await listBlocks(req.appUser!.id)
  res.json({ blocks })
})

meRouter.delete('/me/blocks/:blockedUserId', requireAuth, async (req, res) => {
  await removeBlock(req.appUser!.id, String(req.params.blockedUserId))
  res.status(204).end()
})
