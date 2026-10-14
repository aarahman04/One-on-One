import { InternetTransport } from './transport/InternetTransport'
import type { LinkPreview, Transport } from './transport/Transport'
import type { CallTransport } from './transport/CallTransport'

export type { IncomingMessage, LinkPreview, MessageType, PinState, ReactionUpdate, ReceiptUpdate, Transport, TransportState, TypingUpdate } from './transport/Transport'
export type { CallTransport }

// History can render before the socket connects; REST previews use the same transport.
const previewTransport = new InternetTransport()
const previews = new Map<string, Promise<LinkPreview | null>>()

export function getLinkPreview(url: string): Promise<LinkPreview | null> {
  let pending = previews.get(url)
  if (!pending) {
    if (previews.size >= 200) previews.clear()
    pending = previewTransport.getLinkPreview(url).catch(() => {
      previews.delete(url)
      return null
    })
    previews.set(url, pending)
  }
  return pending
}

let activeTransport: InternetTransport | null = null

// The chat talks to this, not to any transport directly. Swapping in a
// BluetoothTransport later (spec §22) means changing only this factory.
export async function connectMessaging(): Promise<Transport> {
  const transport = new InternetTransport()
  await transport.connect()
  activeTransport = transport
  return transport
}

// Calls ride the same connected socket as messaging (see
// InternetTransport.getCallTransport) — call only after connectMessaging()
// has resolved.
export function getCallTransport(): CallTransport {
  if (!activeTransport) throw new Error('not connected')
  return activeTransport.getCallTransport()
}
