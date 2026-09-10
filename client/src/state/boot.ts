import type { Screen } from './router'
import { getSession } from '../services/authService'
import { getCurrentConnection } from '../services/connectionsApi'
import { nextScreenFor } from './nextScreen'
import { ensureFirstRunGates } from '../features/ageGate'

// Where the app belongs given the current session + connection state.
// Runs at cold boot (main.ts) and again after a native sign-in.
export async function resolveScreenForSession(): Promise<Screen> {
  const session = await getSession()
  if (!session) return 'login'

  // Mark this device as having signed in before, so the login screen knows
  // to offer "Use a different account" next time (e.g. after signing out).
  try {
    localStorage.setItem('hasSignedInBefore', '1')
  } catch {
    /* private mode — the switch-account link just won't show next time */
  }

  const current = await getCurrentConnection()
  if (!current) return 'connection-id'
  return nextScreenFor(current)
}

// Post-sign-in routing for the native flow. The web flow never needs this: the
// OAuth redirect reloads the page, so main.ts's boot path re-runs and routes.
// Credential Manager just resolves a promise in place, so the already-mounted
// router has to be told to move — applying the same first-run gate the cold
// boot applies, so a native first-timer can't skip the 18+/Terms screen.
export async function goToPostSignInScreen(
  root: HTMLElement,
  go: (screen: Screen) => void,
): Promise<void> {
  const screen = await resolveScreenForSession()
  if (screen !== 'login') await ensureFirstRunGates(root)
  go(screen)
}
