import { Capacitor } from '@capacitor/core'
import { supabase } from './supabaseClient'

// forceAccountChooser adds Google's `prompt=select_account` so the account
// picker always appears — used by the login screen's "Use a different account"
// escape hatch, where Google would otherwise silently reuse the last account.
//
// Native (Capacitor) and web take different paths: the native build uses Android
// Credential Manager + signInWithIdToken (Google blocks OAuth redirects inside a
// WebView), the web build keeps the browser-redirect OAuth flow unchanged.
//
// Returns true when a session now exists in *this* page, which only the native
// path can do — it resolves in place with nothing reloading, so the caller has
// to route itself. Web returns false: the browser is mid-redirect and will
// re-run the whole app on the way back. A cancelled picker is also false.
export async function signInWithGoogle(forceAccountChooser = false): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    const { signInWithGoogleNative } = await import('./nativeGoogleAuth')
    return signInWithGoogleNative(forceAccountChooser)
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      ...(forceAccountChooser ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  })
  if (error) throw error
  return false
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

// Every sign-out path funnels through here. The push token must be deleted
// server-side BEFORE the session is dropped (the delete needs auth), or the
// next account on this device would inherit the previous one's notifications.
// `skipPush` is for paths where the session is already gone (401 handler,
// deleted account) — the call would only 401 again.
let signingOut = false
export async function signOut(opts: { skipPush?: boolean } = {}): Promise<void> {
  if (signingOut) return
  signingOut = true
  try {
    if (!opts.skipPush) {
      const { clearPushOnSignOut } = await import('../features/pushNotifications')
      await clearPushOnSignOut()
    }
    await supabase.auth.signOut().catch(() => {})
  } finally {
    signingOut = false
  }
}

// Fires when a session becomes available (fresh sign-in or restored on app
// start). Deferred a tick: supabase-js deadlocks if its own auth callback
// awaits another supabase call.
export function onSessionReady(callback: () => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) setTimeout(callback, 0)
  })
  return () => data.subscription.unsubscribe()
}

// Fires on an actual sign-out transition only (not the initial no-session
// state, which would otherwise cause a reload loop on the login screen).
export function onSignedOut(callback: () => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') callback()
  })
  return () => data.subscription.unsubscribe()
}
