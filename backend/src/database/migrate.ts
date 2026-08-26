import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', '..', '..', 'database', 'migrations')

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('missing DATABASE_URL')

  const client = new Client({ connectionString: databaseUrl })
  await client.connect()

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `)

    const applied = new Set(
      (await client.query('select filename from schema_migrations')).rows.map((r) => r.filename as string),
    )

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip (already applied): ${file}`)
        continue
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf-8')
      console.log(`applying: ${file}`)
      await client.query('begin')
      try {
        await client.query(sql)
        await client.query('insert into schema_migrations (filename) values ($1)', [file])
        await client.query('commit')
      } catch (err) {
        await client.query('rollback')
        throw err
      }
    }

    console.log('migrations complete')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
