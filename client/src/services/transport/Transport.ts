// Transport abstraction (spec §22). V1 ships only InternetTransport; a
// future BluetoothTransport implements this same interface so the chat UI
// and MessageService never change.

export type MessageType = 'text' | 'letter' | 'voice' | 'image' | 'file' | 'ask' | 'countdown' | 'checkin' | 'thisorthat' | 'alarm' | 'call' | 'location' | 'system'

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

export interface ReceiptUpdate {
  userId: string // whose read/delivered position moved
  lastReadAt?: string
  lastDeliveredAt?: string
}

// 'connected' | 'connecting' (reconnecting, network up) | 'offline' (no network).
// UI text: "connecting…" / "waiting for network".
export type TransportState = 'connected' | 'connecting' | 'offline'

export interface Transport {
  connect(): Promise<void>
  disconnect(): void
  sendMessage(
    content: string,
    type?: MessageType,
    payload?: unknown,
    replyTo?: string | null,
    tempId?: string,
  ): Promise<IncomingMessage | undefined>
  onMessage(callback: (message: IncomingMessage) => void): () => void
  sendReaction(messageId: string, emoji: string, op: 'add' | 'remove'): Promise<void>
  onReaction(callback: (update: ReactionUpdate) => void): () => void
  onConnectionEnded(callback: () => void): () => void
  onReceipt(callback: (update: ReceiptUpdate) => void): () => void
  // Fires on every state change. `reconnected` is true when state becomes
  // 'connected' again after having been connected before (the signal to resync
  // anything missed while away).
  onStateChange(callback: (state: TransportState, reconnected: boolean) => void): () => void
  getState(): TransportState
}
