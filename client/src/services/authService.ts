import { supabase } from './supabaseClient'

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  if (error) throw error
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export function onAuthStateChange(callback: (isSignedIn: boolean) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session !== null)
  })
  return () => data.subscription.unsubscribe()
}
