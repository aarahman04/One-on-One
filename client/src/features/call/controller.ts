import type { CallTransport, IceServer, IncomingCall } from '../../services/transport/CallTransport'
import { CallSession } from './session'

type CallBarState = 'idle' | 'ringing-out' | 'ringing-in' | 'in-call'

// Batch 2: deliberately minimal — a plain bar, no icons, no overlay styling.
// Proves the signaling + WebRTC pipeline works end to end. Batch 3 replaces
// this with the real header button, incoming-call overlay, and in-call screen.
export function mountCallBar(nav: HTMLElement, transport: CallTransport, peerName: string): () => void {
  const bar = document.createElement('div')
  bar.className = 'call-bar-tmp'
  bar.style.cssText =
    'padding:8px 20px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;font-size:13px;'
  bar.hidden = true
  nav.insertAdjacentElement('afterend', bar)

  const callBtn = document.createElement('button')
  callBtn.type = 'button'
  callBtn.textContent = '📞'
  callBtn.title = 'Audio call'
  const menuBtn = nav.querySelector('.chat__menu-btn')
  if (menuBtn) menuBtn.insertAdjacentElement('beforebegin', callBtn)

  let state: CallBarState = 'idle'
  let session: CallSession | null = null
  let activeCallId: string | null = null
  let remoteAudio: HTMLAudioElement | null = null
  let pendingAcceptedUnsub: (() => void) | null = null

  const render = (label: string, buttons: Array<{ text: string; onClick: () => void }>): void => {
    bar.hidden = false
    bar.innerHTML = ''
    const span = document.createElement('span')
    span.textContent = label
    bar.append(span)
    for (const b of buttons) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = b.text
      btn.onclick = b.onClick
      bar.append(btn)
    }
  }

  const reset = (): void => {
    state = 'idle'
    activeCallId = null
    pendingAcceptedUnsub?.()
    pendingAcceptedUnsub = null
    session?.close()
    session = null
    remoteAudio?.remove()
    remoteAudio = null
    bar.hidden = true
    bar.innerHTML = ''
  }

  const startSession = (callId: string, iceServers: IceServer[], role: 'caller' | 'callee'): void => {
    session = new CallSession(transport, callId, iceServers, {
      onRemoteStream: (stream) => {
        remoteAudio = document.createElement('audio')
        remoteAudio.autoplay = true
        remoteAudio.srcObject = stream
        document.body.append(remoteAudio)
      },
      onStateChange: (s) => {
        if (s === 'connected') {
          state = 'in-call'
          render(`In call with ${peerName}`, [
            { text: 'Mute', onClick: () => toggleMute() },
            { text: 'End', onClick: () => void hangup() },
          ])
        } else if (s === 'ended') {
          reset()
        }
      },
    })
    activeCallId = callId
    if (role === 'caller') void session.startAsCaller()
    else void session.startAsCallee()
  }

  let muted = false
  const toggleMute = (): void => {
    muted = !muted
    session?.setMuted(muted)
  }

  const hangup = async (): Promise<void> => {
    if (!activeCallId) return
    const id = activeCallId
    reset()
    try {
      await transport.end(id)
    } catch {
      /* best-effort — UI already reset locally */
    }
  }

  callBtn.onclick = () => {
    if (state !== 'idle') return
    void (async () => {
      try {
        const { callId, iceServers } = await transport.invite('audio')
        activeCallId = callId
        state = 'ringing-out'
        render(`Calling ${peerName}…`, [{ text: 'Cancel', onClick: () => void hangup() }])
        pendingAcceptedUnsub = transport.onAccepted((acceptedId) => {
          if (acceptedId !== callId) return
          pendingAcceptedUnsub?.()
          pendingAcceptedUnsub = null
          startSession(acceptedId, iceServers, 'caller')
        })
      } catch (err) {
        render(err instanceof Error ? err.message : 'call failed', [])
        setTimeout(reset, 3000)
      }
    })()
  }

  const incomingUnsub = transport.onIncoming((call: IncomingCall) => {
    if (state !== 'idle') return // one call at a time — server also enforces this
    activeCallId = call.callId
    state = 'ringing-in'
    render(`Incoming call from ${peerName}`, [
      {
        text: 'Accept',
        onClick: () => {
          void (async () => {
            try {
              const { iceServers } = await transport.accept(call.callId)
              startSession(call.callId, iceServers, 'callee')
            } catch {
              reset()
            }
          })()
        },
      },
      {
        text: 'Decline',
        onClick: () => {
          void transport.decline(call.callId)
          reset()
        },
      },
    ])
  })

  const endedUnsub = transport.onEnded((callId) => {
    if (callId !== activeCallId) return
    reset()
  })

  return () => {
    incomingUnsub()
    endedUnsub()
    pendingAcceptedUnsub?.()
    session?.close()
    remoteAudio?.remove()
    bar.remove()
    callBtn.remove()
  }
}
