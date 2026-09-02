// One-off backfill for encryption at rest (Option C — Chunk 4 of 4, see
// docs/DECISIONS-encryption-at-rest.md). Encrypts every pre-existing plaintext
// row so nothing is left readable in the DB after the Chunk 3 wiring shipped:
//   - messages.content + messages.payload
//   - message_reports.message_content (the moderation snapshot)
//
// Idempotent: rows already carrying a ciphertext envelope are skipped, so it is
// safe to re-run. DEFAULT IS DRY-RUN — it only reports counts. Pass --apply to
// actually write. Run the dry-run first, and only apply after the Chunk 3
// manual sign-off has confirmed live send/receive works.
//
//   npm run backfill:encrypt            # dry-run (no writes)
//   npm run backfill:encrypt -- --apply # writes
//
// Loads crypto, which fails fast if ENCRYPTION_KEY_V1 is unset.

import { supabaseAdmin } from './supabaseAdmin.js'
import { encrypt, isEncrypted } from '../services/crypto.js'

const PAGE = 500
const APPLY = process.argv.includes('--apply')

function isPayloadEncrypted(payload: unknown): boolean {
  return payload !== null && typeof payload === 'object' && typeof (payload as { enc?: unknown }).enc === 'string'
}

// The encrypted field values for a message row, or null if it is already fully
// encrypted (nothing to do). Content and payload are checked independently so a
// partially-migrated row still converges. Pure — unit-tested without a DB.
export function planMessageRow(row: { content: string; payload: unknown }): { content: string; payload: unknown } | null {
  const contentEnc = isEncrypted(row.content)
  const payloadEnc = row.payload === null || isPayloadEncrypted(row.payload)
  if (contentEnc && payloadEnc) return null
  return {
    content: contentEnc ? row.content : encrypt(row.content),
    payload: payloadEnc ? row.payload : { enc: encrypt(JSON.stringify(row.payload)) },
  }
}

// The ciphertext for a report snapshot, or null to skip (already encrypted, or
// no snapshot). The snapshot is independent evidence, so its own plaintext is
// encrypted with the current key rather than reusing the message's ciphertext.
export function planSnapshot(value: string | null): string | null {
  if (value === null || isEncrypted(value)) return null
  return encrypt(value)
}

async function backfillMessages(): Promise<{ scanned: number; changed: number }> {
  let cursor = ''
  let scanned = 0
  let changed = 0
  for (;;) {
    let q = supabaseAdmin.from('messages').select('id, content, payload').order('id', { ascending: true }).limit(PAGE)
    if (cursor) q = q.gt('id', cursor)
    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data as Array<{ id: string; content: string; payload: unknown }>) {
      scanned++
      const plan = planMessageRow(row)
      if (!plan) continue
      changed++
      if (APPLY) {
        const { error: uErr } = await supabaseAdmin.from('messages').update(plan).eq('id', row.id)
        if (uErr) throw uErr
      }
    }
    cursor = data[data.length - 1].id
  }
  return { scanned, changed }
}

async function backfillReports(): Promise<{ scanned: number; changed: number }> {
  let cursor = ''
  let scanned = 0
  let changed = 0
  for (;;) {
    let q = supabaseAdmin
      .from('message_reports')
      .select('id, message_content')
      .order('id', { ascending: true })
      .limit(PAGE)
    if (cursor) q = q.gt('id', cursor)
    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data as Array<{ id: string; message_content: string | null }>) {
      scanned++
      const ciphertext = planSnapshot(row.message_content)
      if (ciphertext === null) continue
      changed++
      if (APPLY) {
        const { error: uErr } = await supabaseAdmin
          .from('message_reports')
          .update({ message_content: ciphertext })
          .eq('id', row.id)
        if (uErr) throw uErr
      }
    }
    cursor = data[data.length - 1].id
  }
  return { scanned, changed }
}

async function main(): Promise<void> {
  console.log(APPLY ? '=== backfill: APPLY (writing) ===' : '=== backfill: DRY-RUN (no writes; pass --apply to write) ===')
  const messages = await backfillMessages()
  const reports = await backfillReports()
  console.log(`messages:        scanned ${messages.scanned}, ${APPLY ? 'encrypted' : 'to encrypt'} ${messages.changed}`)
  console.log(`report snapshots: scanned ${reports.scanned}, ${APPLY ? 'encrypted' : 'to encrypt'} ${reports.changed}`)
  if (!APPLY && (messages.changed || reports.changed)) {
    console.log('\nDry-run only. Re-run with --apply to write these changes.')
  }
}

// Only run when invoked directly (npm run backfill:encrypt), not when the pure
// planners above are imported (e.g. by a test).
import { pathToFileURL } from 'node:url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error('backfill failed:', err)
      process.exit(1)
    },
  )
}
