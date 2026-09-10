import { SocialLogin } from '@capgo/capacitor-social-login'
import { supabase } from './supabaseClient'

// Google "Web" OAuth client ID (Google Cloud project one-on-one-508202). This is
// a public value — it's the `aud` claim in every Google ID token — so hardcoding
// it is fine, the same way an Android app ships default_web_client_id in
// strings.xml. Overridable at build time if it ever needs to change per env.
//
// Credential Manager wants the *Web* client ID as the token audience even on
// Android; the *Android* OAuth client (package + SHA-1) is matched by the OS
// from the APK signature and is never referenced here.
const GOOGLE_WEB_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID ??
  '628827083956-au0n92v35p0un0kob10254j7rhc0tcft.apps.googleusercontent.com'

let initialized: Promise<void> | null = null
function ensureInitialized(): Promise<void> {
  initialized ??= SocialLogin.initialize({ google: { webClientId: GOOGLE_WEB_CLIENT_ID } })
  return initialized
}

// Google embeds the SHA-256 hash of the nonce in the ID token's `nonce` claim;
// Supabase re-hashes the raw nonce we give it and compares. So Google gets the
// hash, Supabase gets the raw value.
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Resolves true once Supabase has a session; false if the user dismissed the
// account picker. Never navigates — the caller routes on true.
export async function signInWithGoogleNative(forceAccountChooser: boolean): Promise<boolean> {
  await ensureInitialized()

  if (forceAccountChooser) {
    // Clear Credential Manager's remembered account so the picker really reopens
    // instead of silently reusing the last one.
    await SocialLogin.logout({ provider: 'google' }).catch(() => {})
  }

  const rawNonce = crypto.randomUUID()
  let idToken: string | null
  try {
    const { result } = await SocialLogin.login({
      provider: 'google',
      options: { nonce: await sha256Hex(rawNonce) },
    })
    idToken = 'idToken' in result ? result.idToken : null
  } catch (err) {
    // User dismissed the account picker — not an error worth surfacing.
    if ((err as { code?: string }).code === 'USER_CANCELLED') return false
    throw err
  }

  if (!idToken) throw new Error('Google sign-in returned no ID token.')

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    nonce: rawNonce,
  })
  if (error) throw error
  return true
}
