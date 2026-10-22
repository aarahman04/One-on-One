# Web parity with Android 2.0.10

Reference: the read-only sibling Android repository's `docs/PROGRESS.md` from
"Chess: smoother piece motion (2026-10-21)" through the 2026-10-22 dictation revert,
the matching architecture/Xiaomi notes, and the game, letter, media, sticker and
call sources. API authority: this repository's unchanged `docs/API-CONTRACT.md`,
especially sections 5, 9, 11 and 12. Started at `origin/main` `3b5475a`.

"Done" means implemented and covered by the checks below. It does not claim
authenticated production, physical-device, real speech quality or network latency testing.

| Item | Android behaviour | Web before | Done / gap |
| --- | --- | --- | --- |
| A1 Ping Pong | Relative 2D racket drag, cubic height flights, spin/razor trail, 300 ms bounce pulse, 55-degree tilt, 150 ms prediction, service countdown, configurable 1-99 points, hit/bounce sounds | Retired x-only renderer, fake walls/height/racket holds, score capped at 7 | Done; client renders authoritative flights and sends x/y/released; server owns aim/power/spin/rules |
| A2 Reversi/hub | Green felt, legal dots, drop and edge-on flip wave, pass notice/counts/results; Dots retired from hub | No Reversi; Dots in hub | Done; exact five-game hub, old Dots invites/history still decoded; server supplies legal moves/flips |
| A3 Clocks | Presets/custom time and bonus; sensible per-game defaults; server timeout | None | Done; 10 s-3 h, 0-60 s bonus; null hides clocks; local display never decides outcome |
| A4 Chess | Distance-scaled 150-280 ms slide, pointer release glide/return, spring lift, landing capture fade; white/jet-black squares | Fixed slide, drop snap, green board | Done |
| A5 Connect 4/Tic-Tac-Toe | Immediate local preview; drop/free-fall/hop; delayed win marks; animations start at zero | Waited for server; fixed drop; animation could restart on UI updates | Done; preview rolls back on rejection; same-board updates retain animation progress |
| A6 Reactions | Eight emoji/eight lines/comment; 60 code points; silent throttle; 3.5 s slots and polite live region | Missing | Done; match/player validation, one-line slots, no chat persistence |
| A7 Action bar | Back/avatar/name/react header; notice then equal draw/resign/leave; chess claim | Split controls, chess-only draw | Done; confirmations retained |
| A8 Draws | Every game including Ping Pong; offer/decline/accept and agreement result | Chess only | Done; decline notice takes priority over a recent self reaction |
| A9 Invites | Centered icon/name/options card; Play/Not now; X/Escape/outside decline | Banner | Done; shared modal handles dismissal/focus |
| A10 Results away | Closing results sends leave; absent partner has no rematch | Leave only when own rematch was pending | Done; New game also leaves old results |
| A11 Logos | Central Pong grip and circular Tic-Tac-Toe O | Different silhouettes | Done; Android's original vector paths reused in hub/results/history cards |
| B1 From | myNickname, saved signature, me; editable To/From | Saved signature or empty; To fixed | Done; current connection nickname refreshes with polling |
| B2 Preview voice | Browser voice for unsent text; stop on Edit/Send/close/hidden; one narrator | No preview speaker | Done; no unsent text request; one active narrator across previews/viewers |
| B3 Sent narration | Server parts with visible device fallback; short first part supplied by server | Already supported | Retained; no speech/backend change |
| B4 Dictation | Record, Stop, server transcription, append once; reverted live mode | Same flow, 120 s cap | Done; 118 s cap submits; punctuation preserved; existing one-utterance browser fallback retained |
| B5 Letter mic | Label-aligned, >=40 px accessible target, large 4000-character body | Missing | Done |
| C1 Check-in | Creation removed; history/push/export retained | Slash command and composer available | Done; creation UI removed, legacy type/card/export retained |
| C2 Photos/avatar | Exactly one EXIF pass; opaque JPEG 85 <=2048; alpha PNG; animated GIF bytes unchanged | Full-size photos, inconsistent compression | Done; createImageBitmap orientation once; avatar/sticker existing decode already used same one-pass orientation |
| C3 Pending photo | Immediate local preview/spinner, visible failure, account/conversation ownership | Local preview existed without upload state | Done; upload uses captured conversation/page and sign-out media epoch; no pending send before upload completes |
| C4 Photo bubbles | Payload ratio, path URL cache, no loading text, GIF <=200 long side | Existing signing cache; incomplete ratio/GIF handling | Done; cached URLs hydrate synchronously and broadcast URLs populate path cache; portrait geometry preserved |
| C5 Viewers | Dark translucent photo/avatar viewer with easy zoom/close | Photo modal only; avatar inert | Done; 94% scrim, pan/pinch/double-click/zoom button, profile-photo accessible name |
| C6 Big emoji | Exactly one emoji grapheme, bare, with time/receipt | Normal text bubble | Done; Intl.Segmenter and family/tone/flag/keycap tests; lone modifier/flag half rejected |
| C7 Latest | Arrow after ~1.5 screens; smooth return, stays pinned | Manual scroll only | Done; accessible name and reduced-motion support |
| C8 Reaction sizes | Pill 12.5 / quick bar 19 | 15 / 22 | Done |
| C9 Calls | Local finish before socket-wait/end; no late event revival; one server card | End failed immediately offline; invite/accept event races | Done; attempt ownership, early accepted/ended tracking, retired call IDs, stale media cleanup; history remains deduplicated by server message ID |
| C10 Manual sticker | Offset Erase/Restore, adjustable size/distance, bounded undo/redo | Auto/crop/place only | Done; 32 strokes, <=1024 points per stroke, Done flattens a new baseline; original pixels/alpha restored |
| C10 BiRefNet | Downloaded 192 MB model and Android ONNX runtime | Existing MediaPipe/DeepLab auto tool | Deliberate gap: no BiRefNet or new ML runtime/model added; existing Auto is retained and does not claim Android cut-out quality |

## Implementation decisions

- Game rules, scores, timeouts, Reversi passes/legal moves/flips and draw outcomes
  remain server-authoritative. Chess/grid previews are display-only, never authorization.
- Ping Pong follows the final rebuilt protocol, including open edges. The obsolete
  wall reflection/cosmetic height/racket-hold test was updated rather than preserving
  mechanics the server no longer has. Audio uses short browser-synthesized tones;
  autoplay still requires a user gesture. Range inputs supplement 2D pointer controls.
- Clocks display the server snapshot minus elapsed receipt time for the moving
  side. Clock ticking never resubmits a move or declares timeout.
- Signed attachment URLs remain private, path-keyed and short-lived. A pending
  photo is never queued as a message until upload succeeds. Teardown or sign-out
  retires the upload; it cannot adopt a later page's partner/account.
- Manual editing needs no network/model. The browser retains its existing bounded
  photo canvas (1024 px) and WebP save path. Undo/redo applies within the active
  brush session; Done commits it. Automatic segmentation is explicitly separate.
- No backend, database, speech, API-contract, workflow, Android, environment,
  deployment-setting, version, runtime dependency or lockfile change. No migration.

## Verification

- `cd client && npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: PASS, 47 tests. Includes emoji graphemes, fit dimensions, reaction
  code points, clock bounds/defaults, From fallback, Reversi decoding, optimistic
  grid rollback, 2D Pong/prediction, result leave, brush bounds, offline call end
  and an accelerated 118-second dictation cap that appends punctuated text once.
- `npm run build`: PASS. Existing Vite pushNotifications static/dynamic import
  warning remains; it does not fail the build.
- `test/web210.browser.mjs`: real client in isolated Chromium contexts at desktop
  and 360 px, fixture identity/HTTP, and actual read-only server match rules and
  Pong simulation. No production API, push, database or speech service is used.
  Reproduction and screenshot details: [browser evidence](ui-web-2.0.10/README.md).
- Self-review includes protected-path checks and `git diff --check`.

## Remaining gaps and manual two-browser checklist

The deliberate feature gap is BiRefNet. No item requires an additional backend
change under the current contract. Deployed two-account play/calls, real natural
speech quality/latency, touch hardware and Safari/Firefox behavior remain unverified.
This is build/unit and local-fixture browser verification, not production parity certification.

- [ ] Sign in with two actual accounts; invite/play all five games, then rematch,
  reconnect, offer/decline/accept draws and close one results screen.
- [ ] Ping Pong: relative drag from anywhere, gentle/committed/smash depth, angled
  shots, brush/rare hot spin, service every two points, sounds, custom target.
- [ ] Try No limit, each preset, custom minimum/maximum and increment; wait for a
  genuine server timeout. Test Reversi pass and final unequal/equal counts.
- [ ] Drag chess legally/illegally, capture/castle/promote; check first-frame and
  landing motion. Finish Connect 4/Tic-Tac-Toe and watch delayed winning marks.
- [ ] Send emoji/ready line/60-code-point comment both ways, including a throttled
  tap. Dismiss invites with Not now/X/Escape/outside.
- [ ] Dictate into chat/letter through Stop and cap; preview/read sent letters,
  pause/resume/fallback, switch playback, edit/send/close/background.
- [ ] Send all eight EXIF camera orientations, alpha PNG and animated GIF; inspect
  pending/failure/account-switch behavior, aspect ratio, viewer/zoom and avatar.
- [ ] Inspect single family/tone/flag/keycap versus multiple emoji, reaction sizes,
  scroll up/arrow/new-message pinning, and historical check-in/game/call cards.
- [ ] Complete audio/video calls from either end, disconnect/reconnect around the
  30-second server grace, answer on one device and decline on another; exactly
  one server-authored history row per call.
- [ ] Manually erase/restore with offset/size changes and undo/redo, Done/new session,
  crop/place/save/reopen/send; verify original alpha and accessible footer controls.
