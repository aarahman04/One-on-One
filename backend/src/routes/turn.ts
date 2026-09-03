import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { getIceServers } from '../services/turnService.js'

export const turnRouter = Router()

turnRouter.use(requireAuth)

// No connection/membership check beyond authentication: these credentials
// grant relay access to Cloudflare's TURN network only, not to any
// connection's data, so there's nothing here for membership to gate.
turnRouter.get('/turn-credentials', async (_req, res) => {
  const iceServers = await getIceServers()
  res.json({ iceServers })
})
