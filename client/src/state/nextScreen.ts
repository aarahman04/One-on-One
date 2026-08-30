import type { Screen } from './router'
import type { CurrentConnection } from '../services/connectionsApi'

// Single source of truth for "given the current connection, which screen?".
// Used by the initial boot resolve (main.ts) and the pages that poll
// /connections/current and route on a state change (ConnectionIdPage,
// WaitingPage). Callers handle the no-connection case themselves — the rule
// there differs per page.
export function nextScreenFor(c: CurrentConnection): Screen {
  if (c.status === 'pending') return c.isRequester ? 'waiting' : 'request'
  if (c.status === 'active' || c.status === 'leave_pending') {
    return c.otherNickname ? 'chat' : 'nickname'
  }
  return 'connection-id' // terminated / declined — nothing to be in
}
