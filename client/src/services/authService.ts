import { supabase } from './supabaseClient'

// forceAccountChooser adds Google's `prompt=select_account` so the account
// picker always appears — used by the login screen's "Use a different account"
// escape hatch, where Google would otherwise silently reuse the last account.
export async function signInWithGoogle(forceAccountChooser = false): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      ...(forceAccountChooser ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  })
  if (error) throw error
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
