import type { CallTransport, IceServer, IncomingCall } from '../../services/transport/CallTransport'
import { formatCallDuration } from '../../utils/formatTime'
import { showToast } from '../../components/Toast'
import { callingSupported } from './media'
import { CallSession } from './session'
import {
  CALL_HANGUP_ICON,
  CALL_MIC_ICON,
  CALL_MIC_OFF_ICON,
  CALL_PHONE_ICON,
  CALL_SPEAKER_ICON,
  CALL_SPEAKER_OFF_ICON,
  CALL_VIDEO_ICON,
} from './icons'

type CallState = 'idle' | 'ringing-out' | 'ringing-in' | 'in-call' | 'reconnecting'

// Speaker/earpiece routing is not controllable from a web page on Android —
// there is no API for it, and the browser routes WebRTC audio to the
// loudspeaker by default. setSinkId is the only related API and exists on
// desktop Chrome only, so the button is shown only where it can actually do
// something rather than lying about it (see the plan's Android notes).
function speakerControlSupported(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
}

function callErrorMessage(err: Error): string {
  if (err.name === 'NotAllowedError') return 'Microphone access was denied'
  if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') return 'No microphone found'
  return 'Call failed'
}

export function mountCallBar(nav: HTMLElement, transport: CallTransport, peerName: string): () => void {
  // --- Header buttons: video, phone, then the ••• menu (WhatsApp's order) ---
  // They go inside .chat__nav-actions so the nav's space-between sees one
  // actions child and keeps the whole group pinned right.
  const actions = nav.querySelector('.chat__nav-actions')
  const menuBtn = nav.querySelector('.chat__menu-btn')

  const videoBtn = document.createElement('button')
  videoBtn.type = 'button'
  videoBtn.className = 'chat__call-btn'
  videoBtn.disabled = true // video calling isn't built yet — see PROGRESS.md
  videoBtn.title = 'Video call — not available yet'
  videoBtn.setAttribute('aria-label', 'Video call (not available yet)')
  videoBtn.innerHTML = CALL_VIDEO_ICON

  const callBtn = document.createElement('button')
  callBtn.type = 'button'
  callBtn.className = 'chat__call-btn'
  callBtn.title = 'Audio call'
  callBtn.setAttribute('aria-label', 'Start audio call')
  callBtn.innerHTML = CALL_PHONE_ICON

  if (menuBtn) menuBtn.insertAdjacentElement('beforebegin', videoBtn)
  else actions?.append(videoBtn)
  if (menuBtn) menuBtn.insertAdjacentElement('beforebegin', callBtn)
  else actions?.append(callBtn)

  // --- Full-screen call surface (built once, shown per state) --------------
  const screen = document.createElement('div')
  screen.className = 'call-screen'
  screen.hidden = true
  screen.innerHTML = `
    <div class="call-screen__top">
      <div class="call-screen__name"></div>
      <div class="call-screen__status"></div>
    </div>
    <div class="call-screen__avatar"><span></span></div>
    <div class="call-screen__controls"></div>
  `
  document.body.append(screen)

  const nameEl = screen.querySelector<HTMLElement>('.call-screen__name')!
  const statusEl = screen.querySelector<HTMLElement>('.call-screen__status')!
  const avatarEl = screen.querySelector<HTMLElement>('.call-screen__avatar span')!
  const controlsEl = screen.querySelector<HTMLElement>('.call-screen__controls')!

  nameEl.textContent = peerName
  avatarEl.textContent = peerName.trim().charAt(0).toUpperCase() || '?'

  let state: CallState = 'idle'
  let session: CallSession | null = null
  let activeCallId: string | null = null
  let remoteAudio: HTMLAudioElement | null = null
  let pendingAcceptedUnsub: (() => void) | null = null
  let muted = false
  let speakerOn = true
  let connectedAt = 0
  let timerId: ReturnType<typeof setInterval> | null = null

  // One circular icon button with a label under it, WhatsApp-style.
  const controlBtn = (
    label: string,
    icon: string,
    variant: 'neutral' | 'danger' | 'accept',
    onClick: () => void,
    active = false,
  ): HTMLElement => {
    const wrap = document.createElement('div')
    wrap.className = 'call-screen__control'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `call-screen__btn call-screen__btn--${variant}` + (active ? ' call-screen__btn--active' : '')
    btn.innerHTML = icon
    btn.setAttribute('aria-label', label)
    btn.onclick = onClick
    const text = document.createElement('span')
    text.className = 'call-screen__control-label'
    text.textContent = label
    wrap.append(btn, text)
    return wrap
  }

  const stopTimer = (): void => {
    if (timerId) clearInterval(timerId)
    timerId = null
  }

  const renderControls = (): void => {
    controlsEl.innerHTML = ''
    if (state === 'ringing-in') {
      controlsEl.append(
        controlBtn('Decline', CALL_HANGUP_ICON, 'danger', () => {
          if (activeCallId) void transport.decline(activeCallId)
          reset()
        }),
        controlBtn('Accept', CALL_PHONE_ICON, 'accept', () => void acceptCall()),
      )
      return
    }
    if (state === 'ringing-out') {
      controlsEl.append(controlBtn('Cancel', CALL_HANGUP_ICON, 'danger', () => void hangup()))
      return
    }
    // in-call / reconnecting: speaker (where supported), mute, end.
    if (speakerControlSupported()) {
      controlsEl.append(
        controlBtn(
          'Speaker',
          speakerOn ? CALL_SPEAKER_ICON : CALL_SPEAKER_OFF_ICON,
          'neutral',
          () => void toggleSpeaker(),
          speakerOn,
        ),
      )
    }
    controlsEl.append(
      controlBtn('Mute', muted ? CALL_MIC_OFF_ICON : CALL_MIC_ICON, 'neutral', () => toggleMute(), muted),
      controlBtn('End', CALL_HANGUP_ICON, 'danger', () => void hangup()),
    )
  }

  // The avatar ring reads call state on its own (breathing while ringing,
  // steady in "their" blue once connected), so the status line never has to
  // repeat what the ring already says.
  const applyStateClass = (): void => {
    screen.classList.toggle('call-screen--ringing', state === 'ringing-in' || state === 'ringing-out')
    screen.classList.toggle('call-screen--connected', state === 'in-call')
    screen.classList.toggle('call-screen--reconnecting', state === 'reconnecting')
  }

  const show = (status: string): void => {
    screen.hidden = false
    statusEl.textContent = status
    applyStateClass()
    renderControls()
  }

  const reset = (): void => {
    state = 'idle'
    activeCallId = null
    muted = false
    connectedAt = 0
    stopTimer()
    pendingAcceptedUnsub?.()
    pendingAcceptedUnsub = null
    session?.close()
    session = null
    remoteAudio?.remove()
    remoteAudio = null
    screen.hidden = true
    applyStateClass()
    controlsEl.innerHTML = ''
  }

  const startTimer = (): void => {
    stopTimer()
    connectedAt = Date.now()
    const tick = (): void => {
      statusEl.textContent = formatCallDuration(Math.floor((Date.now() - connectedAt) / 1000))
    }
    tick()
    timerId = setInterval(tick, 1000)
  }

  const toggleMute = (): void => {
    muted = !muted
    session?.setMuted(muted)
    renderControls()
  }

  const toggleSpeaker = async (): Promise<void> => {
    speakerOn = !speakerOn
    const el = remoteAudio as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
    try {
      // '' is the system default output; 'communications' is the earpiece-ish
      // device where the platform exposes one.
      await el?.setSinkId?.(speakerOn ? '' : 'communications')
    } catch {
      /* platform refused the switch — leave routing as-is */
    }
    renderControls()
  }

  // May throw synchronously (e.g. `new RTCPeerConnection` in a browser that
  // lacks it despite passing callingSupported()'s check) — callers wrap it.
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
          const wasReconnecting = state === 'reconnecting'
          state = 'in-call'
          screen.hidden = false
          applyStateClass()
          // Keep counting through a blip rather than restarting the clock.
          if (!wasReconnecting || !timerId) startTimer()
          renderControls()
        } else if (s === 'reconnecting') {
          state = 'reconnecting'
          stopTimer()
          show('Reconnecting…')
        } else {
          // Died on its own (reconnect grace expired). Still tell the server,
          // or its registry keeps this call "in progress" forever and every
          // later call on this connection is refused as busy.
          void hangup()
        }
      },
      // Setup failure (mic permission/device) — the server already thinks
      // this call is live at this point, so tell it to end rather than just
      // vanishing locally and leaving its registry stuck.
      onError: (err) => {
        console.error('CallSession setup failed', err)
        show(callErrorMessage(err))
        setTimeout(() => void hangup(), 2000)
      },
    })
    activeCallId = callId
    if (role === 'caller') void session.startAsCaller()
    else void session.startAsCallee()
  }

  const acceptCall = async (): Promise<void> => {
    const callId = activeCallId
    if (!callId) return
    if (!callingSupported()) {
      showToast("Calls aren't supported in this browser")
      void transport.decline(callId)
      reset()
      return
    }
    let accepted: { iceServers: IceServer[] }
    try {
      accepted = await transport.accept(callId)
    } catch {
      // The server never registered the accept — a plain local reset is correct.
      reset()
      return
    }
    state = 'in-call'
    show('Connecting…')
    try {
      startSession(callId, accepted.iceServers, 'callee')
    } catch (err) {
      // The accept DID register server-side — tell it to end, not just reset.
      show(err instanceof Error ? callErrorMessage(err) : 'Call failed')
      setTimeout(() => void hangup(), 2000)
    }
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
    if (!callingSupported()) {
      showToast("Calls aren't supported in this browser")
      return
    }
    void (async () => {
      try {
        const { callId, iceServers } = await transport.invite('audio')
        activeCallId = callId
        state = 'ringing-out'
        show('Calling…')
        // The offer is only created once they actually answer — see session.ts.
        pendingAcceptedUnsub = transport.onAccepted((acceptedId) => {
          if (acceptedId !== callId) return
          pendingAcceptedUnsub?.()
          pendingAcceptedUnsub = null
          state = 'in-call'
          show('Connecting…')
          try {
            startSession(acceptedId, iceServers, 'caller')
          } catch (err) {
            show(err instanceof Error ? callErrorMessage(err) : 'Call failed')
            setTimeout(() => void hangup(), 2000)
          }
        })
      } catch (err) {
        state = 'ringing-out'
        show(err instanceof Error ? err.message : 'Call failed')
        setTimeout(reset, 2500)
      }
    })()
  }

  const incomingUnsub = transport.onIncoming((call: IncomingCall) => {
    if (state !== 'idle') return // one call at a time — server also enforces this
    activeCallId = call.callId
    state = 'ringing-in'
    show('Incoming call')
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400])
  })

  const endedUnsub = transport.onEnded((callId) => {
    if (callId !== activeCallId) return
    reset()
  })

  return () => {
    incomingUnsub()
    endedUnsub()
    pendingAcceptedUnsub?.()
    stopTimer()
    session?.close()
    remoteAudio?.remove()
    screen.remove()
    callBtn.remove()
    videoBtn.remove()
  }
}
