import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceRoleKey) {
  throw new Error('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

// Service role bypasses RLS — this client is for backend use only, never
// exposed to the browser.
export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
