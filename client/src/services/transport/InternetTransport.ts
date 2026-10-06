import { io, type Socket } from 'socket.io-client'
import { supabase } from '../supabaseClient'
import type { IncomingMessage, MessageType, ReactionUpdate, ReceiptUpdate, Transport, TransportState } from './Transport'
import type { CallTransport } from './CallTransport'
import { InternetCallTransport } from './InternetCallTransport'

const API_URL = import.meta.env.VITE_API_URL
const CONNECT_TIMEOUT_MS = 15000
const ACK_TIMEOUT_MS = 10000

export class InternetTransport implements Transport {
  private socket: Socket | null = null
  private state: TransportState = 'connecting'
  private connectedOnce = false
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

  private emitWithAck(event: string, payload: unknown): Promise<{ message?: IncomingMessage }> {
    const socket = this.socket
    if (!socket || !socket.connected) throw new Error('not connected')
    return new Promise<{ message?: IncomingMessage }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('send timeout')), ACK_TIMEOUT_MS)
      socket.emit(event, payload, (res: { ok?: boolean; error?: string; message?: IncomingMessage }) => {
        clearTimeout(timer)
        if (res?.error) reject(new Error(res.error))
        else resolve({ message: res?.message })
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
}
