# Web parity with Android 2.0.7

Reference: sibling Android `docs/PROGRESS.md`, all 2.0.5/2.0.6/2.0.7 entries, and its `app/src/main/java/app/web/oneonone/` sources below. Android reference HEAD: `116f14d709256e221a6297d52c2c327421ca7c28`; its unrelated working-tree edits were untouched. Android is read-only. API authority: this repository's `docs/API-CONTRACT.md` §§11–12, on main `37d5fbe`.

`has` means implemented, not a claim of physical-phone or authenticated production verification. Existing 2.0.5/2.0.6 behavior is retained unless a difference is identified here.

| Shipped feature | Android reference (relative to Java root above) | Starting web | Result |
| --- | --- | --- | --- |
| Server age/terms gates, same-account cache, sign-out retention | `ui/AppViewModel.kt`, `data/DevicePreferences.kt` | has | has; regression checked |
| Centered composer, rotating slash hints, dimmer bubble times | `ui/chat/ChatScreen.kt`, `ui/chat/Composer.kt` | has | has; regression checked |
| Share connection code with Play/web links; copy code on tap | `ui/AppNavigation.kt` | has | has; regression checked |
| White handwritten letters, A4 PDF, date/indent/signature; no appearance picker | `ui/chat/FeatureUi.kt`, `data/chat/LetterLayout.kt` | has | has; regression checked |
| Keep signature with final three body lines; 20/18/17pt one-page fit | `data/chat/LetterLayout.kt` | has | has; unit/regression checked |
| Long-press cards selects letter/photo/file; alarm stops locally on acknowledge | `ui/chat/ChatScreen.kt`, `ui/chat/MessageBubble.kt` | has | has; regression checked |
| Live presence, receipt fallback, immediate read/delivered ticks | `data/chat/MessageService.kt`, `ui/chat/ChatViewModel.kt` | has | has; regression checked |
| Instant leave/save-first/cancel and read-only partner-left recovery | `ui/chat/LeaveUi.kt`, `ui/AppViewModel.kt` | has | has; regression checked |
| ZIP of full history, media, PDFs; progress/cancel; deleted rows excluded | `data/chat/ChatExport.kt`, `ui/chat/LeaveUi.kt` | has | has; regression checked |
| Warn before accepting a new request over a known ended chat | `ui/AppNavigation.kt`, `ui/AppViewModel.kt` | missing | has; same-account persisted ended-chat hint |
| /ask footer, /thisorthat tiles/reveal, directional scroll-safe reply gesture | `ui/chat/MessageBubble.kt`, `ui/chat/ChatScreen.kt` | has | has; regression checked |
| One reaction pill; sheet names reactors, own row removes, Add reaction | `ui/chat/ChatScreen.kt`, `ui/chat/MessageBubble.kt` | partial | has; added details sheet |
| Vector card/call headings, human labels, encryption-at-rest copy, blocked list | `ui/chat/MessageBubble.kt`, `ui/SettingsScreens.kt` | has | has; regression checked |
| Matching theme colors, Figtree headings, spacing/radii/motion, light/dark | `ui/theme/{Tokens,Type,BubbleTokens}.kt` | partial | has; corrected dark background and display font, shared game tokens |
| Pre-chat logo/title, request/ID copy, paste/back/uppercase ID input | `ui/AppNavigation.kt` | partial | has; matched source copy and input behavior, retained browser OAuth/legal links |
| Games hub/invites/expiry/cancel/accept/decline/resign/leave | `ui/games/{GameHost,GameViewModel}.kt` | partial (relay) | has; authoritative snapshots/actions only |
| Reconnect sync, dedupe, away grace, series and side-swapping rematches | `data/games/{MatchSession,Match}.kt` | missing | has; version/seq ordering; one identical move retry after lost ack |
| Chess green board, original Staunton art, inside coordinates/highlights/hints | `ui/games/ChessUi.kt`, `data/games/Boards.kt` | missing | has; original generator copied and run in web repo |
| Chess prediction/revert, 170ms slides, capture fade, lifted drag/click moves | `ui/games/ChessUi.kt`, `data/games/Boards.kt` | missing | has; chess.js used only for hints/prediction |
| Chess promotion strip, captured/material bars, SAN history, draw/claim, final board | `ui/games/ChessUi.kt`, `ui/games/GameHost.kt` | partial | has; server decides every rule/outcome |
| Chess move/capture/check/end sounds | `ui/games/GameSounds.kt` | missing | has; original synthesized Oggs |
| Portrait table tennis, rotated seat 2, round rackets, server first-to-seven | `ui/games/PongUi.kt`, `data/games/PongGame.kt` | missing | has; canvas, no client physics/scoring |
| Ball extrapolation/shadow/height/bounce, racket hold, ~30/s paddles, away pause | `ui/games/PongUi.kt`, `data/games/{PongGame,MatchSession}.kt` | missing | has; bounded 150ms extrapolation and latest-paddle throttle |
| Tic-tac-toe, Connect Four, 5×5 Dots visuals and server-owned turn/result | `ui/games/GameBoards.kt` | partial (relay) | has; keyboard buttons and arrow navigation |
| Natural letter narration, parts, loading, one-part prefetch, pause/resume/stop | `data/media/{SpeechRepository,LetterNarrator}.kt`, `ui/chat/SpeechViewModel.kt` | missing | has; authenticated IDs-only GET, memory-only audio |
| Recorded /audio, timer/cancel, current-draft append without sending | `data/media/SpeechTranscriber.kt`, `ui/chat/SpeechViewModel.kt` | partial (device only) | has; raw audio POST, 120s/3MB limits, recorder exclusion |
| Speech cold wake/timeouts, quota/network/device fallback, English limitation | `data/media/SpeechRepository.kt` | missing | has; 95s/125s, fallback only for network/503/504/429 quota_exceeded |

## Decisions and contract gaps

- `match.version` orders all snapshot changes; `seq` orders moves. Same-seq draw/away/rematch changes remain visible. New match IDs retire old IDs, so a late acknowledgement cannot restore the previous game. `match:sync` is independent of REST history resync. A late null sync cannot erase a newer push. Results survive null sync like Android. A backgrounded table-tennis tab reasserts away after reconnect sync; its initial racket position comes from the server until the user drags.
- Table geometry and colors follow the final Android `PongUi.kt`/`PongClient`, not the obsolete horizontal web relay game. Only InternetTransport imports Socket.IO for games. Backend `game:*` remains intact for old installed clients.
- One unavoidable backend fix: narration exposes its existing `X-Narration-Part` and `X-Narration-Parts` headers through CORS. Without it, browser JavaScript cannot read the number of parts. Android payloads, authorization, speech service, auth, settings and database are unchanged. **No migration.**
- The pending-connection response does not identify an older ended chat. Like Android, the accept warning uses an account-scoped hint from a previously observed ended response. If the browser never saw it, no warning is possible with this contract. The backend still decides access and deletion.
- Browser-specific behavior: keyboard/hover controls are retained; a range input supplements pointer table-tennis controls; screen wake lock is best effort. Browser refresh reconnects to the server match. Browser device voices/recognition and autoplay permission vary. If autoplay is blocked, Resume reading plays the prepared part on a user gesture.
- Existing browser ZIP assembly still uses memory and PDF text is rasterized to preserve Unicode. Platform-specific Android notification/ringtone, rotation/audio-focus and Play workflows are not web features; no Android file was changed.

## Verification

Commands and screenshot evidence are in [ui-web-2.0.7/README.md](ui-web-2.0.7/README.md). Browser games use two isolated contexts, the actual backend match handlers/rules/simulation, and fixture authentication/REST. Speech tests use deterministic audio/HTTP responses, not a claim of hearing Kokoro in production.

Production limitation: opened the deployed web app and completed Google sign-in using the existing reviewer account. Its adult date-of-birth gate was not yet complete. No birth date was invented and no terms accepted. Authenticated deployed matches and actual natural-voice playback therefore remain unverified. No production connection/message was created or changed.
