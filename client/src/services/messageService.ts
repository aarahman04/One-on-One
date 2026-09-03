import { InternetTransport } from './transport/InternetTransport'
import type { IncomingMessage, MessageType, ReactionUpdate, Transport } from './transport/Transport'
import type { CallTransport } from './transport/CallTransport'

export type { IncomingMessage, MessageType, ReactionUpdate, Transport, CallTransport }

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
