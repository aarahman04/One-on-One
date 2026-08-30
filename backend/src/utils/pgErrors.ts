// Postgres / PostgREST error codes surfaced through supabase-js.
export const UNIQUE_VIOLATION = '23505'
// Raised by our own trigger / RPC guards (e.g. the single-active-connection
// trigger in migration 016).
export const RAISE_EXCEPTION = 'P0001'
