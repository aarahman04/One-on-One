# Web 2.0.7 verification

These are disposable contract fixtures, not screenshots of production conversations.
Android files were read only. Full feature/source checklist and decisions:
[WEB-ANDROID-PARITY-2.0.7.md](../WEB-ANDROID-PARITY-2.0.7.md).

## Commands

From `client/`:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
node test/web207.browser.mjs
PARITY_SCREENSHOT_DIR=../../docs/ui-web-2.0.7/regression/ node test/web206.browser.mjs
PARITY_SCREENSHOT_DIR=../../docs/ui-web-2.0.7/regression/ node test/parity.browser.mjs
```

`lint` uses the project's existing TypeScript unused-symbol/parameter and control-flow
checks. `typecheck` uses the existing tsconfig. No linter or runtime dependency was
added. Browser scripts accept `PLAYWRIGHT_MODULE` pointing at an installed
`playwright/index.mjs`; the tool was installed outside the repository. Build the
backend first because `web207.browser.mjs` imports its compiled match handlers.

From `backend/`: `npm ci`, `npm test`, `npm run build`.

Results: client static checks/build and **34 unit tests** pass; backend build and
**82 tests** pass. Runtime dependency audit: zero findings. Existing development
dependency audit findings (3 moderate, 5 high, 1 critical) and the mixed
static/dynamic push-import build warning remain outside this change.

## Browser coverage

- Chromium, two independent browser contexts, 1280×900 and 360×900: full chess
  checkmate; white/black orientation; keyboard and lifted drag; reload sync;
  side-swapping rematch/series; agreed draw; original-art four-choice promotion,
  Escape cancel and server promotion. Late-game positions are explicit test-only
  fixtures; normal full games use the unchanged production match handlers/rules.
- Full table tennis to seven using the actual backend simulation; both clients'
  frames/scores, paddle controls, background away/pause and resume countdown.
- Full tic-tac-toe, Connect 4 and all 60 Dots edges through UI buttons and the
  production match protocol. No `game:*` event is sent by the web.
- Narration makes ID-only authenticated requests for both parts, plays valid
  deterministic Ogg fixtures, and falls back on daily quota. Dictation uses fake
  browser microphone hardware, uploads raw audio, appends to the current draft
  without sending, and ignores a cancelled late response. This verifies transport
  and controls, not the sound of Kokoro or recognition quality.
- Existing 2.0.6 regression: gates/cache migration, device speech fallback and
  cancellation, cards/receipts, reaction sheet, ZIP contents/deleted filtering and
  cancellation, leave/partner-left, persisted old-chat acceptance warning, sign-in
  logo and normalized keyboard ID input.
- Existing chat/media suite: both widths/themes/all wallpapers, selection,
  reactions/edit/delete/pins, typing/presence, search, preview security, failures,
  attachment/sticker/GIF/profile flows and real local MediaPipe cut-out inference.

## Screenshots

| View | Desktop | Phone |
| --- | --- | --- |
| Chess dark | [1280](1280-dark-chess.png) | [360](360-dark-chess.png) |
| Chess light | [1280](1280-light-chess.png) | [360](360-light-chess.png) |
| Final board, white | [1280](1280-chess-final-white.png) | [360](360-chess-final-white.png) |
| Final board, black | [1280](1280-chess-final-black.png) | [360](360-chess-final-black.png) |
| Promotion | [1280](1280-chess-promotion.png) | [360](360-chess-promotion.png) |
| Table tennis dark | [1280](1280-dark-pong-countdown.png) | [360](360-dark-pong-countdown.png) |
| Table tennis light | [1280](1280-light-pong-countdown.png) | [360](360-light-pong-countdown.png) |
| Table tennis result | [1280](1280-pong-result.png) | [360](360-pong-result.png) |
| Tic-tac-toe | [1280](1280-tictactoe.png) | [360](360-tictactoe.png) |
| Connect 4 | [1280](1280-connect4.png) | [360](360-connect4.png) |
| Dots | [1280](1280-dots.png) | [360](360-dots.png) |
| Device voice fallback | [1280](1280-letter-device-fallback.png) | [360](360-letter-device-fallback.png) |

The [regression directory](regression/) contains chat, media, letter, sign-in,
choice composer, leave and partner-left screenshots.

## Remaining verification

The deployed web app was opened and Google sign-in completed with the existing
reviewer account. It stopped at the account's incomplete date-of-birth gate. No
birth date was invented and no terms accepted. Authenticated deployed games,
web-to-Android physical-device play, actual Kokoro narration (including a Railway
cold wake), real microphone recognition and mobile audio/keyboard behavior remain
manual checks. No production connection or message was created or changed.

The pending-connection contract cannot identify an ended chat the browser has
never observed; the warning has the same account-scoped cache limit as Android.
No migration or infrastructure setting changed. The small backend CORS header fix
must deploy through the existing backend pipeline for cross-origin narration.
