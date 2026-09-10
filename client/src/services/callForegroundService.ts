import { Capacitor, registerPlugin } from '@capacitor/core'

export interface CallServicePlugin {
  start(options: { kind: 'audio' | 'video'; peerName: string }): Promise<void>
  stop(): Promise<void>
}

const CallService = registerPlugin<CallServicePlugin>('CallService')

// Keeps an active call's media alive while the app is backgrounded on the
// native Android build. A no-op on web. Failures are swallowed: a foreground
// service that won't start must degrade to today's behaviour (call works,
// dies when backgrounded), never break the call.

export async function startCallService(kind: 'audio' | 'video', peerName: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await CallService.start({ kind, peerName })
  } catch (err) {
    console.warn('CallService.start failed', err)
  }
}

export async function stopCallService(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await CallService.stop()
  } catch (err) {
    console.warn('CallService.stop failed', err)
  }
}
