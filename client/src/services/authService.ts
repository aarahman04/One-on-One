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

export async function signOut(): Promise<void> {
  await supabase.auth.signOut().catch(() => {})
}

// Fires on an actual sign-out transition only (not the initial no-session
// state, which would otherwise cause a reload loop on the login screen).
export function onSignedOut(callback: () => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') callback()
  })
  return () => data.subscription.unsubscribe()
}
