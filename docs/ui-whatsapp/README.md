# Chat UI verification

Screenshots use synthetic conversation data rendered by the real ChatPage,
CSS and call-header renderer through Vite. Service replacements apply only
inside the QA browser; no accounts, sockets or backend writes are used.

- `before/`: main `fd00a7e`, legacy stored `line` style, Vite port 5174 in an isolated worktree.
- `after/`: `feat/whatsapp-ui`, the same legacy value normalized to bubbles, Vite port 5173.
- `360-*`: 360×800; `412-*`: 412×915. Each includes dark/light and Off/Love/Samurai.
- Other after images show individual cards, search, menus, reply and header states.
- `keyboard-viewport.png` simulates a shortened visual viewport; it is not a real Android keyboard capture.

Start `npm run dev -- --host 127.0.0.1` in `client/`. In a second PowerShell
terminal in `client/`, run the checks using a temporary Playwright installation
(no app dependency or lockfile changes):

```powershell
$qaDir = Join-Path $env:TEMP 'one-on-one-ui-qa'
npm install --prefix $qaDir playwright
$env:PLAYWRIGHT_MODULE = Join-Path $qaDir 'node_modules/playwright/index.mjs'
$env:CHROME_CHANNEL = 'chrome'
node scripts/chat-ui-check.mjs after
```

The script checks the viewport/theme/wallpaper matrix, card overflow, green
text contrast, touch targets, grouping, batch history layout reads, search,
menus, swipe scheduling, unchanged viewport writes, optimistic and resynced
row indexing, quote navigation, near-bottom sends, pagination, cleanup and
chat remount. It refreshes after screenshots. To refresh before screenshots,
point `UI_URL` at a Vite server serving the baseline checkout and pass `before`.

Remaining device checks: actual Android IME resizing/offsets, reduced-motion
preference and smoothness on a physical phone; two-account send/ack/dedupe,
receipt updates and reconnect/airplane-mode resync; media playback, recording,
uploads, calls, alarm and notifications. Protected behavior remains unchanged.
