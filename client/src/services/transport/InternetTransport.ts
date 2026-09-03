import { io, type Socket } from 'socket.io-client'
import { supabase } from '../supabaseClient'
import type { IncomingMessage, MessageType, ReactionUpdate, Transport } from './Transport'
import type { CallTransport } from './CallTransport'
import { InternetCallTransport } from './InternetCallTransport'

const API_URL = import.meta.env.VITE_API_URL
const CONNECT_TIMEOUT_MS = 15000
const ACK_TIMEOUT_MS = 10000

export class InternetTransport implements Transport {
  private socket: Socket | null = null

  async connect(): Promise<void> {
    // Auth as a callback so socket.io reconnects fetch a *fresh* token — a
    // token captured once expires after ~1h and every reconnect then fails.
    const socket = io(API_URL, {
      auth: (cb) => {
        void supabase.auth.getSession().then(({ data }) => cb({ token: data.session?.access_token ?? '' }))
      },
    })
    this.socket = socket

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
      throw err
    }
  }

  disconnect(): void {
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

  private emitWithAck(event: string, payload: unknown): Promise<void> {
    const socket = this.socket
    if (!socket || !socket.connected) throw new Error('not connected')
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('send timeout')), ACK_TIMEOUT_MS)
      socket.emit(event, payload, (res: { ok?: boolean; error?: string }) => {
        clearTimeout(timer)
        if (res?.error) reject(new Error(res.error))
        else resolve()
      })
    })
  }

  async sendMessage(
    content: string,
    type: MessageType = 'text',
    payload: unknown = null,
    replyTo: string | null = null,
    tempId?: string,
  ): Promise<void> {
    await this.emitWithAck('message:send', { content, type, payload, replyTo, tempId })
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

  onConnectionEnded(callback: () => void): () => void {
    const socket = this.socket
    if (!socket) throw new Error('not connected')
    socket.on('connection:ended', callback)
    return () => {
      socket.off('connection:ended', callback)
    }
  }
}
