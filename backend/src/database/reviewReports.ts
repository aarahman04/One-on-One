// Moderation review tool (Google Play UGC policy: reports must reach a real
// review process, not a dead form). Lists message_reports newest-first with
// reporter / reported / category / note / time and the decrypted message
// snapshot. Read-only — taking action (delete a message row, terminate a
// connection, delete an account) is done deliberately by hand per
// docs/MODERATION.md.
//
//   npm run reports:review              # all open reports
//   npm run reports:review -- --category child_safety
//   npm run reports:review -- --limit 50
//
// Loads crypto, which fails fast if ENCRYPTION_KEY_V1 is unset.

import { supabaseAdmin } from './supabaseAdmin.js'
import { decrypt, isEncrypted } from '../services/crypto.js'

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : undefined
}

function safeDecrypt(value: string | null): string {
  if (!value) return '(no snapshot — person-level report)'
  if (!isEncrypted(value)) return value // pre-encryption legacy plaintext
  try {
    return decrypt(value)
  } catch (err) {
    return `(could not decrypt: ${(err as Error).message})`
  }
}

interface ReportRow {
  id: string
  message_id: string | null
  reporter_id: string
  reported_user_id: string | null
  category: string | null
  reason: string | null
  message_content: string | null
  created_at: string
}

async function main(): Promise<void> {
  const category = argValue('--category')
  const limit = Number(argValue('--limit') ?? 100)

  let q = supabaseAdmin
    .from('message_reports')
    .select('id, message_id, reporter_id, reported_user_id, category, reason, message_content, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (category) q = q.eq('category', category)

  const { data, error } = await q
  if (error) throw error
  const rows = (data ?? []) as ReportRow[]

  console.log(`=== ${rows.length} report(s)${category ? ` in category "${category}"` : ''} ===\n`)
  for (const r of rows) {
    console.log(`report ${r.id}  ${r.created_at}`)
    console.log(`  category:  ${r.category ?? '(none)'}`)
    console.log(`  reporter:  ${r.reporter_id}`)
    console.log(`  reported:  ${r.reported_user_id ?? '(user deleted)'}`)
    console.log(`  message:   ${r.message_id ?? '(person-level, no message)'}`)
    if (r.reason) console.log(`  note:      ${r.reason}`)
    console.log(`  snapshot:  ${safeDecrypt(r.message_content)}`)
    console.log('')
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('reports:review failed:', err)
    process.exit(1)
  },
)
