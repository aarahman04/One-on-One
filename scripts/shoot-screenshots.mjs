// Interactive Play Store screenshot helper.
//
// The app is entirely behind Google OAuth and its router has no URLs, so this
// can't be fully headless. It opens a real browser at a phone viewport; you
// sign in, pair two accounts, and drive the UI yourself; pressing keys in the
// terminal captures the current screen to docs/playstore/screenshots/.
//
//   npm i -D puppeteer            # one-off
//   node scripts/shoot-screenshots.mjs [baseUrl]
//
// Default baseUrl: https://one-on-one-mu.vercel.app/
//
// Play wants 2–8 phone screenshots, 9:16, min 320px on the short side. This
// shoots 1080×1920. Suggested set: login, connection-ID screen, a chat with a
// few messages, a call, a slash-command card, the ••• menu (block/report/delete
// visible).

import { mkdir } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let puppeteer
try {
  puppeteer = (await import('puppeteer')).default
} catch {
  console.error('puppeteer not installed. Run: npm i -D puppeteer')
  process.exit(1)
}

const baseUrl = process.argv[2] || 'https://one-on-one-mu.vercel.app/'
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/playstore/screenshots')
await mkdir(outDir, { recursive: true })

const SHOTS = [
  'login',
  'connection-id',
  'chat',
  'call',
  'slash-card',
  'menu',
]

const browser = await puppeteer.launch({
  headless: false,
  defaultViewport: { width: 1080, height: 1920, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  args: ['--window-size=560,1000'],
})
const [page] = await browser.pages()
await page.goto(baseUrl, { waitUntil: 'networkidle2' })

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => new Promise((r) => rl.question(q, r))

console.log(`\nOpen. Sign in and set up the UI you want to capture.\n`)
console.log(`Commands: a shot name (${SHOTS.join(', ')}), any other text = custom name, "q" to quit.\n`)

for (;;) {
  const name = (await ask('capture > ')).trim()
  if (name === 'q' || name === '') break
  const file = resolve(outDir, `${name.replace(/[^a-z0-9-_]/gi, '-')}.png`)
  await page.screenshot({ path: file })
  console.log('  wrote', file)
}

rl.close()
await browser.close()
