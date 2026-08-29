import { supabase } from './supabaseClient'

const API_URL = import.meta.env.VITE_API_URL
const TIMEOUT_MS = 15000

let onUnauthorized: (() => void) | null = null

// main.ts registers what to do on a 401 (sign out + back to login). Kept out
// of this module so it has no dependency on the router.
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

export async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) {
    onUnauthorized?.()
    throw new Error('not signed in')
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${session.access_token}`,
    },
    signal: init?.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  })

  if (res.status === 401) {
    onUnauthorized?.()
    throw new Error('session expired')
  }
  return res
}

export interface Me {
  connectionCode: string
}

export async function fetchMe(): Promise<Me> {
  const res = await authedFetch('/api/me')
  if (!res.ok) throw new Error(`failed to load connection id (${res.status})`)
  return res.json()
}
