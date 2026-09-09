// One-off: rasterize client/public/icon.svg into the PNG set the PWA manifest
// and the Play listing need. Run from the repo root: `npm run gen-icons`.
// First-pass aesthetic — flagged for user review (see docs/PROGRESS.md).
//
// Source mark: dark rounded square (#0d1117) with two overlapping circles,
// green (#7ee787) + blue (#79c0ff @ 0.85). The circles' bounding box is
// centred on (96,96) in the 192-unit design space.

import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Web icons the manifest references vs. Play Console listing assets (not served
// from the site — they live with the other store docs).
const webDir = resolve(root, 'client/public/icons')
const storeDir = resolve(root, 'docs/playstore/store-assets')

const BG = '#0d1117'
const GREEN = '#7ee787'
const BLUE = '#79c0ff'

// Full-bleed mark, parametric on canvas size. `rx` rounds the square (0 = none).
const markSvg = (size, rx) => {
  const k = size / 192
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="${rx}" fill="${BG}"/>
  <circle cx="76" cy="96" r="40" fill="${GREEN}"/>
  <circle cx="116" cy="96" r="40" fill="${BLUE}" fill-opacity="0.85"/>
</svg>`
}

// Maskable: content scaled to the inner 80% safe zone, centred, on a full-bleed
// dark field so any platform mask (circle, squircle, rounded rect) stays clean.
const maskableSvg = (size) => {
  const scale = (size / 192) * 0.8
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(-96 -96)">
    <circle cx="76" cy="96" r="40" fill="${GREEN}"/>
    <circle cx="116" cy="96" r="40" fill="${BLUE}" fill-opacity="0.85"/>
  </g>
</svg>`
}

// Feature graphic: mark on the left, wordmark to its right, on the dark field.
const featureSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
  <rect width="1024" height="500" fill="${BG}"/>
  <g transform="translate(150 250) scale(1.6) translate(-96 -96)">
    <circle cx="76" cy="96" r="40" fill="${GREEN}"/>
    <circle cx="116" cy="96" r="40" fill="${BLUE}" fill-opacity="0.85"/>
  </g>
  <text x="470" y="250" font-family="Georgia, 'Times New Roman', serif" font-size="72" fill="#e6edf3" dominant-baseline="middle">One on One</text>
  <text x="472" y="312" font-family="sans-serif" font-size="26" fill="#9aa4af" dominant-baseline="middle">one connection. nothing else.</text>
</svg>`

const pngFromSvg = (svg, w, h) =>
  sharp(Buffer.from(svg))
    .resize(w, h, { fit: 'fill' })
    .flatten({ background: BG })
    .png()
    .toBuffer()

const targets = [
  { dir: webDir, file: 'icon-192.png', svg: markSvg(192, 40), w: 192, h: 192 },
  { dir: webDir, file: 'icon-512.png', svg: markSvg(512, 107), w: 512, h: 512 },
  { dir: webDir, file: 'maskable-512.png', svg: maskableSvg(512), w: 512, h: 512 },
  { dir: storeDir, file: 'play-store-icon-512.png', svg: markSvg(512, 0), w: 512, h: 512 },
  { dir: storeDir, file: 'feature-graphic-1024x500.png', svg: featureSvg(), w: 1024, h: 500 },
]

for (const t of targets) {
  await mkdir(t.dir, { recursive: true })
  await writeFile(resolve(t.dir, t.file), await pngFromSvg(t.svg, t.w, t.h))
  console.log('wrote', resolve(t.dir, t.file).replace(root + '\\', '').replace(/\\/g, '/'))
}
