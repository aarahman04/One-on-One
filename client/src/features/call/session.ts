import type { CallTransport, IceServer } from '../../services/transport/CallTransport'
import { acquireLocalStream, stopStream } from './media'

export type CallSessionState = 'connected' | 'ended'

export interface CallSessionHandlers {
  onRemoteStream?: (stream: MediaStream) => void
  onStateChange?: (state: CallSessionState) => void
}

interface SignalPayload {
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

// Wraps one RTCPeerConnection for the lifetime of one call. Signaling rides
// CallTransport only — never touches Socket.IO directly (spec §22).
//
// The offer is created only by startAsCaller(), which the controller calls
// after call:accepted fires (not right after invite()) — so the callee
// always has its own CallSession constructed and listening for call:signal
// before any offer is sent, with no buffering needed for the race that would
// otherwise exist between "invited" and "accepted."
export class CallSession {
  private transport: CallTransport
  private callId: string
  private handlers: CallSessionHandlers
  private pc: RTCPeerConnection
  private localStream: MediaStream | null = null
  private unsubSignal: () => void

  constructor(transport: CallTransport, callId: string, iceServers: IceServer[], handlers: CallSessionHandlers = {}) {
    this.transport = transport
    this.callId = callId
    this.handlers = handlers
    this.pc = new RTCPeerConnection({ iceServers })

    this.pc.onicecandidate = (e) => {
      if (e.candidate) void this.transport.sendSignal(this.callId, { candidate: e.candidate.toJSON() })
    }
    this.pc.ontrack = (e) => {
      const stream = e.streams[0]
      if (stream) this.handlers.onRemoteStream?.(stream)
    }
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState
      if (state === 'connected') this.handlers.onStateChange?.('connected')
      else if (state === 'failed' || state === 'closed' || state === 'disconnected') this.handlers.onStateChange?.('ended')
    }

    this.unsubSignal = transport.onSignal((callId, data) => {
      if (callId === this.callId) void this.handleSignal(data)
    })
  }

  async startAsCaller(): Promise<void> {
    await this.attachLocalTracks()
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    await this.transport.sendSignal(this.callId, { sdp: offer })
  }

  // Attaches local tracks only; the caller's offer arrives separately via
  // call:signal and is handled by handleSignal (constructor already
  // subscribed by the time this resolves).
  async startAsCallee(): Promise<void> {
    await this.attachLocalTracks()
  }

  private async attachLocalTracks(): Promise<void> {
    this.localStream = await acquireLocalStream('audio')
    for (const track of this.localStream.getTracks()) this.pc.addTrack(track, this.localStream)
  }

  private async handleSignal(data: unknown): Promise<void> {
    const msg = data as SignalPayload
    if (msg.sdp) {
      await this.pc.setRemoteDescription(msg.sdp)
      if (msg.sdp.type === 'offer') {
        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(answer)
        await this.transport.sendSignal(this.callId, { sdp: answer })
      }
    } else if (msg.candidate) {
      try {
        await this.pc.addIceCandidate(msg.candidate)
      } catch (err) {
        console.error('CallSession: failed to add ICE candidate', err)
      }
    }
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
  }

  close(): void {
    this.unsubSignal()
    this.pc.close()
    if (this.localStream) stopStream(this.localStream)
  }
}
