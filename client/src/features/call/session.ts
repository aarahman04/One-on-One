import type { CallTransport, IceServer } from '../../services/transport/CallTransport'
import { acquireLocalStream, stopStream } from './media'

export type CallSessionState = 'connected' | 'reconnecting' | 'ended'

// WebRTC's 'disconnected' is normally TRANSIENT — a NAT rebind or a wifi↔cellular
// handoff trips it and the same call recovers seconds later. Treating it as fatal
// is what silently killed calls a couple of minutes in. Instead: show
// "reconnecting", ask ICE to restart, and only give up if it hasn't recovered
// within this window.
const RECONNECT_GRACE_MS = 20_000

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
  // Only the original offerer drives renegotiation, so both sides can't race
  // to ICE-restart the same call (classic offer glare).
  private isOfferer = false
  private restartInFlight = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private ended = false

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
      if (this.ended) return
      const state = this.pc.connectionState
      if (state === 'connected') {
        this.clearReconnectTimer()
        this.restartInFlight = false
        this.handlers.onStateChange?.('connected')
      } else if (state === 'disconnected' || state === 'failed') {
        this.handlers.onStateChange?.('reconnecting')
        this.startReconnectTimer()
        if (this.isOfferer) void this.attemptIceRestart()
      } else if (state === 'closed') {
        this.handlers.onStateChange?.('ended')
      }
    }

    this.unsubSignal = transport.onSignal((callId, data) => {
      if (callId === this.callId) void this.handleSignal(data)
    })
  }

  async startAsCaller(): Promise<void> {
    this.isOfferer = true
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

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  // One timer per disconnected episode: if the connection hasn't come back by
  // the time it fires, the call really is gone.
  private startReconnectTimer(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.ended) return
      if (this.pc.connectionState !== 'connected') this.handlers.onStateChange?.('ended')
    }, RECONNECT_GRACE_MS)
  }

  // Fresh ICE gathering over the existing signaling channel. The peer needs no
  // new code for this — handleSignal already answers any offer it receives.
  private async attemptIceRestart(): Promise<void> {
    if (this.ended || this.restartInFlight) return
    this.restartInFlight = true
    try {
      const offer = await this.pc.createOffer({ iceRestart: true })
      await this.pc.setLocalDescription(offer)
      await this.transport.sendSignal(this.callId, { sdp: offer })
    } catch (err) {
      console.error('CallSession: ICE restart failed', err)
      this.restartInFlight = false
    }
  }

  private async handleSignal(data: unknown): Promise<void> {
    const msg = data as SignalPayload
    if (msg.sdp) {
      await this.pc.setRemoteDescription(msg.sdp)
      if (msg.sdp.type === 'offer') {
        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(answer)
        await this.transport.sendSignal(this.callId, { sdp: answer })
      } else {
        this.restartInFlight = false // an ICE-restart answer landed
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
    this.ended = true // stops the 'closed' event below re-firing handlers
    this.clearReconnectTimer()
    this.unsubSignal()
    this.pc.close()
    if (this.localStream) stopStream(this.localStream)
  }
}
