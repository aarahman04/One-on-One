# Codex prompt: web client parity with Android 2.0.8 (open PR, self-review, merge)

You are working in the web repo `C:\Users\aarah\One-on-One` (GitHub aarahman04/One-on-One). The web client is in `client/` (Vite + TypeScript, no framework, Capacitor for Android). The backend is in `backend/`. The owner has delegated every decision to you and will not answer questions. Make sensible choices, finish the work, and merge it yourself.

This round follows web PR #116 (2.0.7 parity, already merged). Since then Android 2.0.8 (Android PR #37) and backend PR #115 shipped. Bring the web client up to that state. Do not redo anything #116 already did.

## Hard rules
- **Read-only:** `C:\Users\aarah\One-on-One-Android` is a reference. Never edit, commit or push there.
- **API authority:** `docs/API-CONTRACT.md` is the only API authority (§4 `game` type, §6 `game_invite`, §12 "Chat history"). Do NOT change `backend/`, `database/`, `speech/` or the contract. The backend and migration 040 are already deployed. If something is truly missing, work around it in the client and list it as a gap in the PR.
- **Do not touch:** Railway, Supabase, Vercel settings, secrets, `.env*`, `.github/workflows/` (never run a workflow), and untracked files you did not create (`arfah.html`, older `docs/prompts/*`).
- **Branch:** `feat/web-2.0.8-parity` from an up-to-date `main`. One PR, never force-push, minimal diffs in the existing client style. No new runtime dependency.

## Step 1: Study (read only)
1. This repo: `docs/API-CONTRACT.md` §4 (message types table, `game` row), §6 (`game_invite`), §12 (Chat history bullet under Lifecycle); `docs/RELEASING.md` top entry; `backend/src/games/matchSocket.ts` (`writeGameLog`, `gameLogText`, `pushInvite`).
2. Android reference (`../One-on-One-Android`):
   - `docs/PROGRESS.md` sections "Release 2.0.8" and "Game invites, game history, letter mic, polish"
   - `app/src/main/java/app/web/oneonone/ui/chat/cards/GameLogCard.kt` (`gameLogText`) and `cards/CallLogCard.kt`
   - `call/CallProtocol.kt` (`spokenDuration`, `logText`)
   - `ui/chat/Dictation.kt` (`LetterDictation`) and `ui/chat/FeatureUi.kt` (letter `Field` with a `trailing` mic, letter body min height)
   - `push/MessageNotifications.kt` (`gameInvite`) and `push/PushWorkers.kt` (`deliverGameInvitePush` gates)
   - `ui/chat/PartnerPhoto.kt` (`downscaledJpeg`: orientation applied by the platform decoder)
   - `res/drawable/ic_call_log_phone_*.xml` (handset inset so it isn't clipped)
3. Web code to change: `client/src/pages/ChatPage.ts` (message rendering chain around `callLogCard`, `cardTitles`, row actions that already skip `'call'`), `client/src/utils/formatTime.ts`, `client/src/features/archiveRules.ts` and `conversationArchive.ts`, `client/src/features/voiceTyping.ts`, the letter composer, `client/src/features/games/{session,ui}.ts`, `client/src/features/profileSettings.ts`, `client/src/types/*` (MessageType).

## Step 2: Implement
1. **`game` chat rows (contract §4/§12).** Add `'game'` to the client `MessageType`. Render it like the call log card: game icon (reuse the games hub icons), title = game name (`chess` Chess, `pong` Table Tennis, `connect4` Connect 4, `tictactoe` Tic-Tac-Toe, `dots` Dots & Boxes), subtitle = result + duration, e.g. "You won · 12 min 14 sec", "<nickname> won · 4 min", "A draw · 45 sec" (draw reasons as in Android `DrawReasons`), otherwise "Game ended · …". `winner` is a userId compared with your own id. Unknown or malformed payload: fall back to `content` text, never crash. Treat `game` like `call` everywhere: no edit, delete, reply, react, swipe-to-reply or receipts. The archive/export shows it as an event line using `content`.
2. **Readable history durations.** Add `formatSpokenDuration` ("45 sec", "12 min", "12 min 14 sec", "1 hr", "1 hr 3 min", same rules as Android `CallProtocol.spokenDuration`) and use it for call log rows ("Voice call · 5 min 12 sec") and game rows, including the archive. Keep the live in-call timer as `m:ss`.
3. **Game invite while the tab is hidden.** The backend only pushes `game_invite` to native tokens, so the web client must do this itself. When a `match:state` arrives with `status === "invited"`, `inviter !== me`, and `document.hidden` (or the chat page not shown), show a notification with the existing service-worker registration (`registration.showNotification`). Title "<nickname> wants to play <Game>", body "Open the chat to accept.", tag `game:<connectionId>`. Close it after 30 s or when the match leaves `invited`. Clicking it focuses the tab on the chat. Only when notification permission is already granted; never prompt for permission here. Without permission, fall back to the tab title / favicon badge if the client already has one, otherwise do nothing.
4. **`/letter` mic.** Put a mic button in the right corner of the "Your letter" label row. It reuses the existing `/audio` transcription path (`voiceTyping.ts`: server `POST /api/transcribe`, device fallback), but appends the text to the letter body (one space separator, capped at 4000) instead of the main composer. States: idle mic → "Listening m:ss" + red stop → "Adding your words…" spinner → idle. Closing the letter or switching to Preview cancels a running dictation. While the letter is open, the main composer's dictation bar must not show or receive the text. Give the letter body a real writing height (about 130 px min). Use aria labels "Speak your letter" and "Stop and add to your letter".
5. **Dictation hint.** Any remaining "English and European languages" copy becomes English-only (Whisper base.en).
6. **Profile photo orientation.** Check the avatar upload in `profileSettings.ts`. If it re-encodes through a canvas, decode with `createImageBitmap(file, { imageOrientation: 'from-image' })` (or equivalent) so camera photos are never sideways or upside down. Strip EXIF on re-encode. If it uploads the raw file, leave it.
7. **Call log icon.** If the web call-log phone glyph touches or crosses its viewBox edge, inset it so nothing is clipped.

## Step 3: Verify
- Add unit tests (the client's existing test setup) for `formatSpokenDuration`, game row text (won / lost / draw / ended / malformed), and the invite-notification gate (hidden + invited + not inviter → notify; any other case → no notify).
- Run the client build, typecheck, lint and tests, and the backend tests (`cd backend && npm test`) to prove nothing else broke.
- Browser check (desktop + phone width, light + dark): seed a `game` row and a completed call row in the dev UI, then screenshot both cards, the letter mic in all states, and the hidden-tab invite notification. Put the screenshots in `docs/design/web-2.0.8/`.

## Step 4: PR, self-review, merge
- Update `docs/PROGRESS.md` (web 2.0.8 parity entry) and the top of `docs/RELEASING.md` (web-only deploy through Vercel, no backend, migration or Android change).
- Open the PR with a summary, verification output, screenshots and any gaps. Review your own diff against this prompt and the contract; fix what you find. Merge once checks pass. Report the PR link and the results.
