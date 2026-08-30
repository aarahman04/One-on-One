import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { strictLimiter } from '../middleware/rateLimit.js'
import { emitConnectionEnded } from '../websocket/socketServer.js'
import {
  acceptConnection,
  advanceLeave,
  cancelLeave,
  cancelRequest,
  confirmEndLeave,
  declineConnection,
  getCurrentConnection,
  markRead,
  requestConnection,
  setNickname,
  setWallpaper,
} from '../services/connectionService.js'

export const connectionsRouter = Router()

connectionsRouter.use(requireAuth)

connectionsRouter.get('/connections/current', async (req, res) => {
  const user = req.appUser!
  const current = await getCurrentConnection(user.id)
  res.json({ connection: current })
})

connectionsRouter.post('/connections/request', strictLimiter, async (req, res) => {
  const user = req.appUser!
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

connectionsRouter.post('/connections/:id/cancel', async (req, res) => {
  const user = req.appUser!
  const connection = await cancelRequest(req.params.id, user.id)
  res.json({ connection })
})

connectionsRouter.post('/connections/:id/accept', async (req, res) => {
  const user = req.appUser!
  const connection = await acceptConnection(req.params.id, user.id)
  res.json({ connection })
})

connectionsRouter.post('/connections/:id/decline', async (req, res) => {
  const user = req.appUser!
  const connection = await declineConnection(req.params.id, user.id)
  res.json({ connection })
})

connectionsRouter.patch('/connections/:id/nickname', async (req, res) => {
  const user = req.appUser!
  const nickname = String(req.body?.nickname ?? '')
  await setNickname(req.params.id, user.id, nickname)
  res.status(204).end()
})

connectionsRouter.post('/connections/:id/leave', async (req, res) => {
  const user = req.appUser!
  const result = await advanceLeave(req.params.id, user.id)
  if (result.terminated) emitConnectionEnded(req.params.id)
  res.json({ leave: result })
})

connectionsRouter.post('/connections/:id/leave/cancel', async (req, res) => {
  const user = req.appUser!
  const result = await cancelLeave(req.params.id, user.id)
  res.json({ leave: result })
})

connectionsRouter.post('/connections/:id/leave/confirm-end', async (req, res) => {
  const user = req.appUser!
  const result = await confirmEndLeave(req.params.id, user.id)
  if (result.terminated) emitConnectionEnded(req.params.id)
  res.json({ leave: result })
})

connectionsRouter.patch('/connections/:id/wallpaper', async (req, res) => {
  const user = req.appUser!
  await setWallpaper(req.params.id, user.id, String(req.body?.wallpaper ?? ''))
  res.status(204).end()
})

connectionsRouter.post('/connections/:id/read', async (req, res) => {
  const user = req.appUser!
  await markRead(req.params.id, user.id)
  res.status(204).end()
})
