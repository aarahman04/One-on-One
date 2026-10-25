import { io, type Socket } from 'socket.io-client'
import { supabase } from '../supabaseClient'
import type { IncomingMessage, LinkPreview, MessageType, PinState, PresenceUpdate, ReactionUpdate, ReceiptUpdate, Transport, TransportState, TypingUpdate } from './Transport'
import { authedFetch } from '../apiClient'
import type { CallTransport } from './CallTransport'
import { InternetCallTransport } from './InternetCallTransport'
import { decodeMatch, type MatchAck, type MatchAction, type MatchSnapshot, type PongFrame, type MatchReaction, type PaddleTiming, type PaddleSample } from './MatchTransport'

const API_URL = import.meta.env.VITE_API_URL
const CONNECT_TIMEOUT_MS = 15000
const ACK_TIMEOUT_MS = 10000

export class InternetTransport implements Transport {
  private socket: Socket | null = null
  private state: TransportState = 'connecting'
  private connectedOnce = false
  private pendingAcks = new Set<(error: Error) => void>()
  private stateListeners = new Set<(state: TransportState, reconnected: boolean) => void>()
  private onlineHandler = (): void => this.setState(this.socket?.connected ? 'connected' : 'connecting', false)
  private offlineHandler = (): void => {
    if (!this.socket?.connected) this.setState('offline', false)
  }

  private setState(next: TransportState, reconnected: boolean): void {
    if (next === this.state && !reconnected) return
    this.state = next
    for (const cb of this.stateListeners) cb(next, reconnected)
  }

  getState(): TransportState {
    return this.state
  }

  onStateChange(callback: (state: TransportState, reconnected: boolean) => void): () => void {
    this.stateListeners.add(callback)
    return () => {
      this.stateListeners.delete(callback)
    }
  }

  async connect(): Promise<void> {
    // Auth as a callback so socket.io reconnects fetch a *fresh* token — a
    // token captured once expires after ~1h and every reconnect then fails.
    const socket = io(API_URL, {
      auth: (cb) => {
        void supabase.auth.getSession().then(({ data }) => cb({ token: data.session?.access_token ?? '' }))
      },
    })
    this.socket = socket

    socket.on('connect', () => {
      const reconnected = this.connectedOnce
      this.connectedOnce = true
      this.setState('connected', reconnected)
    })
    socket.on('disconnect', () => this.setState(navigator.onLine === false ? 'offline' : 'connecting', false))
    socket.io.on('reconnect_attempt', () => {
      if (this.state === 'connected') this.setState('connecting', false)
    })
    window.addEventListener('online', this.onlineHandler)
    window.addEventListener('offline', this.offlineHandler)

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('connect timeout')), CONNECT_TIMEOUT_MS)
        socket.once('connect', () => {
          clearTimeout(timer)
          resolve()
        })
        socket.once('connect_error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
      })
    } catch (err) {
      // Don't leave a zombie socket retrying in the background with nobody listening.
      socket.disconnect()
      this.socket = null
      window.removeEventListener('online', this.onlineHandler)
      window.removeEventListener('offline', this.offlineHandler)
      throw err
    }
  }

  disconnect(): void {
    for (const cancel of this.pendingAcks) cancel(new Error('not connected'))
    window.removeEventListener('online', this.onlineHandler)
    window.removeEventListener('offline', this.offlineHandler)
    this.stateListeners.clear()
    this.socket?.disconnect()
    this.socket = null
  }

  // Calls ride this same authenticated socket rather than opening a second
  // connection — see messageService.getCallTransport(), the sanctioned entry
  // point for call UI/features (spec §22: never touch Socket.IO directly).
  getCallTransport(): CallTransport {
    if (!this.socket) throw new Error('not connected')
    return new InternetCallTransport(this.socket)
  }

  private emitWithAck(event: string, payload: unknown): Promise<{ message?: IncomingMessage; pin?: PinState }> {
    const socket = this.socket
    if (!socket || !socket.connected) throw new Error('not connected')
    return new Promise<{ message?: IncomingMessage; pin?: PinState }>((resolve, reject) => {
      const cancel = (error: Error) => { clearTimeout(timer); this.pendingAcks.delete(cancel); reject(error) }
      const timer = setTimeout(() => cancel(new Error('send timeout')), ACK_TIMEOUT_MS)
      this.pendingAcks.add(cancel)
      socket.emit(event, payload, (res: { ok?: boolean; error?: string; message?: IncomingMessage; pin?: PinState }) => {
        clearTimeout(timer)
        this.pendingAcks.delete(cancel)
        if (res?.error) reject(new Error(res.error))
        else if (!res?.ok) reject(new Error('Server did not confirm the action.'))
        else resolve(res)
      })
    })
  }

  async sendMessage(
    content: string,
    type: MessageType = 'text',
    payload: unknown = null,
    replyTo: string | null = null,
    tempId?: string,
  ): Promise<IncomingMessage | undefined> {
    // The ack carries the saved message (the ORIGINAL one on a deduped resend),
    // so a sender whose echo was lost can still reconcile its optimistic row.
    const res = await this.emitWithAck('message:send', { content, type, payload, replyTo, tempId })
    return res.message
  }

  onMessage(callback: (message: IncomingMessage) => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    socket.on('message:new', callback)
    return () => {
      socket.off('message:new', callback)
    }
  }

  async editMessage(messageId: string, content: string): Promise<IncomingMessage> {
    const { message } = await this.emitWithAck('message:edit', { messageId, content })
    if (!message?.id) throw new Error('Server did not confirm the edit.')
    return message
  }

  async deleteMessage(messageId: string): Promise<IncomingMessage> {
    const { message } = await this.emitWithAck('message:delete', { messageId })
    if (!message?.id) throw new Error('Server did not confirm the deletion.')
    return message
  }

  onMessageUpdate(callback: (message: IncomingMessage) => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    socket.on('message:update', callback)
    return () => { socket.off('message:update', callback) }
  }

  async pinMessage(messageId: string | null): Promise<PinState> {
    const { pin } = await this.emitWithAck('message:pin', { messageId })
    if (!pin) throw new Error('Server did not confirm the pin.')
    return pin
  }

  onPin(callback: (pin: PinState) => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    socket.on('pin:update', callback)
    return () => { socket.off('pin:update', callback) }
  }

  sendTyping(typing: boolean): void {
    // Never buffer ephemeral typing while offline.
    if (this.socket?.connected) this.socket.emit('typing', { typing })
  }

  sendPresence(active: boolean): void {
    if (this.socket?.connected) this.socket.emit('presence', { active })
  }

  onPresence(callback: (update: PresenceUpdate) => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    socket.on('presence', callback)
    return () => { socket.off('presence', callback) }
  }

  onTyping(callback: (update: TypingUpdate) => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    socket.on('typing', callback)
    return () => { socket.off('typing', callback) }
  }

  async getLinkPreview(url: string): Promise<LinkPreview | null> {
    const res = await authedFetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
    if (!res.ok) throw new Error('Could not load the link preview.')
    return ((await res.json()) as { preview: LinkPreview | null }).preview
  }

  async sendReaction(messageId: string, emoji: string, op: 'add' | 'remove'): Promise<void> {
    await this.emitWithAck(op === 'add' ? 'reaction:add' : 'reaction:remove', { messageId, emoji })
  }

  onReaction(callback: (update: ReactionUpdate) => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    socket.on('reaction:update', callback)
    return () => {
      socket.off('reaction:update', callback)
    }
  }

  onReceipt(callback: (update: ReceiptUpdate) => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    socket.on('receipt:update', callback)
    return () => {
      socket.off('receipt:update', callback)
    }
  }

  onConnectionEnded(callback: () => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    socket.on('connection:ended', callback)
    return () => {
      socket.off('connection:ended', callback)
    }
  }

  async markRead(connectionId: string): Promise<void> {
    await this.emitWithAck('message:read', { connectionId })
  }

  async sendMatch(event: MatchAction, payload: Record<string, unknown> = {}): Promise<MatchAck> {
    const socket = this.socket
    if (!socket?.connected) throw new Error('not connected')
    return new Promise((resolve, reject) => {
      socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (error: Error | null, ack: MatchAck) => {
        if (error) { reject(new Error('send timeout')); return }
        if (!ack || typeof ack.ok !== 'boolean') { reject(new Error('invalid acknowledgement')); return }
        if (ack.match && !decodeMatch(ack.match)) { reject(new Error('invalid match')); return }
        resolve(ack)
      })
    })
  }

  sendPaddle(matchId: string, x: number, y?: number, released?: boolean, touch?: [number, number], timing?: PaddleTiming, samples?: PaddleSample[]): void {
    // A release immediately follows the held flush; volatile would drop it while that write is in flight.
    if (this.socket?.connected && Number.isFinite(x) && (y === undefined || Number.isFinite(y)))
      (released ? this.socket : this.socket.volatile).emit('match:paddle', { matchId, x, ...(y === undefined ? {} : { y }), ...(released ? { released: true } : {}),
        ...(touch ? { touch } : {}), ...timing, ...(samples ? { samples } : {}) })
  }

  onMatchReaction(callback: (reaction: MatchReaction) => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    socket.on('match:reaction', callback)
    return () => { socket.off('match:reaction', callback) }
  }

  onMatch(callback: (match: MatchSnapshot) => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    const handler = (value: unknown) => { const match = decodeMatch(value); if (match) callback(match) }
    socket.on('match:state', handler)
    return () => { socket.off('match:state', handler) }
  }

  onPong(callback: (frame: PongFrame) => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    socket.on('match:pong', callback)
    return () => { socket.off('match:pong', callback) }
  }
}
