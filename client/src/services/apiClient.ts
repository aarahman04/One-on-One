import { supabase } from './supabaseClient'

const API_URL = import.meta.env.VITE_API_URL

export async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('not signed in')

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${session.access_token}`,
    },
  })
}

export interface Me {
  connectionCode: string
}

export async function fetchMe(): Promise<Me> {
  const res = await authedFetch('/api/me')
  if (!res.ok) throw new Error(`failed to load connection id (${res.status})`)
  return res.json()
}
