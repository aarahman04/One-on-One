import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { getOrCreateUser } from '../services/userService.js'
import {
  acceptConnection,
  declineConnection,
  getCurrentConnection,
  requestConnection,
  setNickname,
} from '../services/connectionService.js'

export const connectionsRouter = Router()

connectionsRouter.use(requireAuth)

connectionsRouter.get('/connections/current', async (req, res) => {
  const user = await getOrCreateUser(req.authUserId!)
  const current = await getCurrentConnection(user.id)
  res.json({ connection: current })
})

connectionsRouter.post('/connections/request', async (req, res) => {
  const user = await getOrCreateUser(req.authUserId!)
  const code = String(req.body?.connectionCode ?? '')
    .trim()
    .toUpperCase()
  if (!code) {
    res.status(400).json({ error: 'connectionCode is required' })
    return
  }
  const connection = await requestConnection(user.id, code)
  res.status(201).json({ connection })
})

connectionsRouter.post('/connections/:id/accept', async (req, res) => {
  const user = await getOrCreateUser(req.authUserId!)
  const connection = await acceptConnection(req.params.id, user.id)
  res.json({ connection })
})

connectionsRouter.post('/connections/:id/decline', async (req, res) => {
  const user = await getOrCreateUser(req.authUserId!)
  const connection = await declineConnection(req.params.id, user.id)
  res.json({ connection })
})

connectionsRouter.patch('/connections/:id/nickname', async (req, res) => {
  const user = await getOrCreateUser(req.authUserId!)
  const nickname = String(req.body?.nickname ?? '')
  await setNickname(req.params.id, user.id, nickname)
  res.status(204).end()
})
