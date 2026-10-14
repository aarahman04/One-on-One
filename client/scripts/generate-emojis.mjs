import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

// Unicode 17.0 keyboard repertoire; regenerate when upgrading the bundled picker.
const source = 'https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt'
const res = await fetch(source)
assert(res.ok, `Unicode data: ${res.status}`)
const data = await res.text()
assert(data.includes('# Version: 17.0'))
const groups = []
let group
for (const line of data.split('\n')) {
  if (line.startsWith('# group: ')) {
    group = { name: line.slice(9).trim(), emoji: [] }
    groups.push(group)
  }
  const match = line.match(/^([0-9A-F ]+)\s*; fully-qualified\s*# \S+ E[\d.]+ (.+)$/)
  if (match && group) group.emoji.push([String.fromCodePoint(...match[1].trim().split(/\s+/).map((hex) => parseInt(hex, 16))), match[2]])
}
const entries = groups.flatMap((g) => g.emoji)
assert(entries.length > 3500 && entries.every(([emoji]) => emoji.length <= 32))
await writeFile(new URL('../src/features/emojiData.ts', import.meta.url), `// Generated from ${source}\n// Copyright Unicode, Inc. Unicode License v3: see emoji-LICENSE.txt.\nexport default ${JSON.stringify(groups.filter((g) => g.emoji.length))}\n`, 'utf8')
const license = await fetch('https://www.unicode.org/license.txt')
assert(license.ok)
await writeFile(new URL('../src/features/emoji-LICENSE.txt', import.meta.url), await license.text(), 'utf8')
console.log(`Bundled ${entries.length} emoji in ${groups.filter((g) => g.emoji.length).length} categories.`)
