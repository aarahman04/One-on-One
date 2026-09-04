// Transport abstraction (spec §22). V1 ships only InternetTransport; a
// future BluetoothTransport implements this same interface so the chat UI
// and MessageService never change.

export type MessageType = 'text' | 'letter' | 'voice' | 'image' | 'file' | 'ask' | 'countdown' | 'checkin' | 'thisorthat' | 'alarm' | 'call' | 'location'

export interface IncomingMessage {
  id: string
  senderId: string
  content: string
  createdAt: string
  type: MessageType
  payload: unknown | null
  replyTo: string | null
  tempId?: string // echoed back to the sender for optimistic reconciliation
}

export interface ReactionUpdate {
  messageId: string
  emoji: string
  userId: string
  op: 'add' | 'remove'
}

export interface Transport {
  connect(): Promise<void>
  disconnect(): void
  sendMessage(
    content: string,
    type?: MessageType,
    payload?: unknown,
    replyTo?: string | null,
    tempId?: string,
  ): Promise<void>
  onMessage(callback: (message: IncomingMessage) => void): () => void
  sendReaction(messageId: string, emoji: string, op: 'add' | 'remove'): Promise<void>
  onReaction(callback: (update: ReactionUpdate) => void): () => void
  onConnectionEnded(callback: () => void): () => void
}
