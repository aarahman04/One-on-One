# One on One — split into Web repo + native Android repo, fix alarm / push / calls / bubbles

> Status 2026-10-07: Phase W (W1–W5) merged as PRs #91–#95. W6 pending (after native ships). "Prompt 2" below is superseded by `docs/prompts/gpt-sol-6.1-android.md`.

## Context

Today one repo (`aarahman04/One-on-One`) holds backend + web client + a Capacitor `android/` wrapper that loads the same web bundle. User is fed up with recurring bugs: alarm cancel re-pops, nothing arrives when the app is killed (messages or alarm), voice calls are stuck on loudspeaker, video-call volume is very low, and bubbles look like WhatsApp instead of the app's own green/blue brand (wallpaper-tinted bubbles are gone).

Decision (user-confirmed 2026-10-07): **full native Android rewrite** in Kotlin + Jetpack Compose in the new repo `https://github.com/aarahman04/One-on-One-Android.git` (currently empty). The backend stays in the web repo and is shared by both clients. Test device: **Xiaomi/Redmi/POCO (MIUI/HyperOS), build vc4 / 1.0.3**.

Honest framing for the user: a shared repo isn't what causes these bugs. Each one has a specific cause (below). The native rewrite fixes the platform limits (earpiece, killed-app alarm, rich notifications). The code bugs still have to be fixed directly, and the web-side fixes ship first.

## Root causes found (verified in code)

1. **Alarm cancel re-pop — real bug.** `client/src/pages/ChatPage.ts` `sendMessage()` (~L1870) builds the optimistic row from an object with **no `id`**. `alarmCard()` (~L961) captures `message.id` in its click closure. When the echo arrives, `onIncoming` (~L2740) only updates `row.dataset.id` and never rebuilds the card. So tapping your own raise sends `{ack: undefined, cancelled: true}` → `validateAlarmPayload` (`backend/src/services/messageService.ts:191`) throws 400 "invalid alarm acknowledgement". Locally the card still says "cancelled" (optimistic `markRaiseAcked(undefined)` + `stopAll`), but the server never records the cancel. The recipient keeps ringing, and on the next resync/history load (`ChatPage.ts` ~L1781) the raise is un-acked again → glow + "tap to cancel" come back. Each tap repeats it.
   Also: the backend accepts any `ack` string without checking that it references a real raise in this connection, or that only the raiser can cancel and only the other member can ack.
2. **Killed-app push.** Backend path (`socketServer.ts syncDelivery` → `pushService.sendToUser/sendFcmToUser`) is structurally OK. Likely causes: (a) MIUI force-stop on swipe-away + no Autostart → FCM is never delivered to a stopped app, (b) FCM token never registered (opt-in prompt), (c) `FIREBASE_SERVICE_ACCOUNT` not usable on Railway (look for `fcm: configured` / `fcm: skipped` in logs). Message notifications use a `notification` block on channel `messages`, which is only created from JS at boot.
3. **Voice on loudspeaker / low video volume.** No native audio routing exists (no `AudioManager` anywhere in `android/`). `client/src/features/call/controller.ts:34` admits the WebView can't route to the earpiece. `setSinkId('communications')` does nothing on Android WebView. Without `MODE_IN_COMMUNICATION`, remote WebRTC audio plays on a quiet stream.
4. **Bubbles.** Commit `0b71b4a` (Codex PR #87) replaced the per-wallpaper bubble colors with WhatsApp-style ones. `applyAppearance` (`client/src/features/appearancePreview.ts:37`) still toggles `chat--wallpaper-love/samurai`. The old wallpaper-tinted bubble rules can be recovered from `git show eef30be:client/src/styles/global.css`. Brand colors from the app icon: green `#7ee787`, blue `#79c0ff`, background `#0d1117`.

## Model assignment

- **Sonnet 5.5 → web repo (`One-on-One`)**: backend fixes + shared API contract doc + web client fixes + bubble restyle. Runs first; its contract doc is the Android model's source of truth.
- **GPT Sol 6.1 → Android repo (`One-on-One-Android`)**: native Kotlin/Compose app, milestone by milestone.
- **Opus 5.5 (me)**: review each PR against this plan, merge, gate on device tests.

## Phase W — Web repo (Sonnet 5.5)

- **W1 Alarm correctness (client + backend)**
  - Client: the raise card resolves its id at click time from `card.closest('.chat__message').dataset.id` (or `messagesById`). If the id is still a tempId or missing, disable the card / queue the cancel until the echo arrives. Fix the optimistic `markRaiseAcked(undefined)` path. On a failed ack send, revert the card and glow state and show an error.
  - Backend `messageService` / `socketServer`: an ack must reference an existing `alarm` raise message in the same connection, within 2 min. `cancelled:true` only from the raiser; plain ack only from the other member. Make it idempotent: a second ack/cancel for the same raise returns the existing one, not a new message + push.
  - Push text for a cancel must not read like a new alarm.
- **W2 Push hardening (backend)**: all message FCM sends use `android.priority: 'high'`. Add a `platform` value `android-native` to `push_tokens` (migration). For native tokens send **data-only** for every type (`type`, `messageId`, `connectionId`, `senderName`, `preview`, `alarmId`, `ack`, `cancelled`) so the native app builds its own notifications. The current `android` (Capacitor) tokens keep today's shape until that app is retired. Incoming calls: if `call:invite` doesn't already push, send a data-only high-priority `type:'call'` FCM (ttl ~30s) when the callee has no live socket, or always to native tokens.
- **W3 API contract**: write `docs/API-CONTRACT.md`. It must cover every REST route (`backend/src/routes/*.ts`: connections, me, messages, attachments, push, turn, plus request/response JSON shapes), the socket handshake (`auth.token` = Supabase access token), client→server events (`message:send` with tempId/ack callback, `reaction:add/remove`, `call:invite/accept/decline/signal/end`), server→client events (`message:new`, `receipt:update`, `reaction:update`, `connection:ended`, `call:incoming/accepted/signal/ended`), message types and payload validators, FCM data schema, and auth (Supabase Google ID-token sign-in). Generate it from code; don't invent.
- **W4 Bubble restyle**: own-bubble = brand green, other = brand blue tones (dark + light theme). Restore wallpaper-tinted bubble variants for `love` and `samurai` from `eef30be`. Keep current placement of time/ticks/grouping exactly. Visual change only.
- **W5 Web call volume**: make sure remote audio plays through one element only (no double/muted path), `volume = 1`, and no `autoGainControl` on remote. Document that web/PWA can't use the earpiece (platform limit). The native app is the fix.
- **W6 Retire Capacitor (do this LAST, after native app reaches parity and ships on Play)**: remove `android/`, `client/capacitor.config.ts`, the Capacitor deps, the native branches (`alarmNative.ts`, the native parts of `pushNotifications.ts`, `CallServicePlugin` bridge), and the `android-build.yml` workflow. Until then `android/` stays frozen: no new features, only critical fixes.

## Phase A — Android repo (GPT Sol 6.1), native Kotlin + Compose

Hard requirements: **same applicationId `app.web.oneonone` and same upload keystore** so Play treats it as an update (see `docs/RELEASING.md` for the keystore SHA assertions). versionCode continues above the last Capacitor upload (≥5). Same Firebase project (`one-on-one-508202`) → new `google-services.json` with the app's SHA-1/SHA-256.

Stack: Kotlin, Compose + Material 3, Hilt, Retrofit/OkHttp + kotlinx.serialization, `io.socket:socket.io-client` (Socket.IO v4), supabase-kt (auth) + Credential Manager Google sign-in → `signInWithIdToken`, Room (message cache), WorkManager, Firebase Messaging, `io.getstream:stream-webrtc-android`, Coil. Single-activity, MVVM, `Transport` interface → `InternetTransport` (CLAUDE.md rule: keep transport abstraction for V3 Bluetooth).

Milestones (one PR each, device-verified before the next):
- **A0 Scaffold**: Gradle KTS, CI (build + lint + unit tests, signed release AAB on dispatch), README, `docs/PROGRESS.md`, `docs/ARCHITECTURE.md`, CLAUDE.md copied/adapted from the web repo (non-negotiable rules §19/20/22/28/29 apply).
- **A1 Auth + connection flow**: Google sign-in, `/me`, connection code, request/accept/decline/cancel, age gate/consent, delete account, blocks. One-active-connection is enforced server-side; the UI only reflects it.
- **A2 Chat core**: history paging, socket send with tempId + ack + retry + idempotency, receipts, reactions, reply, search, nickname, leave-connection 5-step flow, Room cache, reconnect resync.
- **A3 Notifications**: `FirebaseMessagingService` handles data-only messages → MessagingStyle notification per conversation, inline reply, mark-read, grouped. Channels created at app start (messages, alarm, calls). Token registered on login with `platform:'android-native'`, re-registered on `onNewToken`. Onboarding screen for MIUI/HyperOS: Autostart, battery "No restrictions", lock app in recents, notification permission. Deep-link to the settings screens via intents, with fallbacks.
- **A4 Emergency alarm**: port `AlarmForegroundService` logic (USAGE_ALARM MediaPlayer, vibration, 2-min auto-clear, full-screen intent, per-ring token on PendingIntents). Fixes:
  - Notification tap opens the chat without re-firing.
  - Cancel/ack uses the server message id only.
  - Native state is driven by server state: a stop from a FCM `ack` or the socket clears everything, including the notification by id.
  - Dedupe by alarmId so a resync never re-rings a handled alarm.
  - Raise / cancel / ack UI in chat.
- **A5 Calls**: WebRTC with the existing socket signaling + `/api/turn-credentials`, audio + video.
  - `AudioManager.MODE_IN_COMMUNICATION`. Earpiece by default for voice; speaker for video. Use `setCommunicationDevice` on API 31+, `setSpeakerphoneOn` below. Speaker toggle; Bluetooth/wired headset routing.
  - Proximity wake lock (`PROXIMITY_SCREEN_OFF_WAKE_LOCK`) on voice calls.
  - `volumeControlStream = STREAM_VOICE_CALL`.
  - Foreground service type `phoneCall|microphone|camera`.
  - Incoming call via FCM data → full-screen CallStyle notification (works when killed).
  - Call log messages.
- **A6 Features parity**: letters, voice notes, images/files (upload via `/connections/:id/attachments`, signed URLs), ask, countdown, checkin, thisorthat, location, wallpapers + bubble style (same brand palette as W4), report/block, appearance.
- **A7 Release**: R8, Play Data Safety update (native app collects same data), versionCode bump, internal track test on 2 phones, then production.

## Verification

- W1: unit tests for `validateAlarmPayload` + ownership/idempotency. Manual test on two browsers: raise → cancel immediately (before and after echo) → reload both → card stays "cancelled" and nothing re-rings. Same on the vc4 Capacitor build.
- W2/W3: backend tests; Railway log shows `fcm: configured`; contract doc reviewed against routes.
- W4: screenshots for each wallpaper × light/dark.
- Android milestones: CI green, plus the device script on the Xiaomi:
  - App killed (swiped) + Autostart on → message notification arrives within 5 s.
  - Alarm rings when killed; cancel from the sender stops the recipient's ring; nothing re-pops after reopen.
  - Voice call plays in the earpiece and the screen turns off at the ear.
  - Video call volume is comparable to WhatsApp.
- Track every part in each repo's `docs/PROGRESS.md` / `docs/ARCHITECTURE.md`.

## Deliverables after plan approval

1. Save prompts as `docs/prompts/sonnet-5.5-web.md` (web repo) and `docs/prompts/gpt-sol-6.1-android.md` (also copied into the Android repo's first commit).
2. Push an initial scaffold commit to `One-on-One-Android`: README, CLAUDE.md, the prompt, a copy of this plan, and API-CONTRACT.md once W3 lands. Needs push access; user to confirm before any push.

---

## Prompt 1 — Sonnet 5.5 (web repo `aarahman04/One-on-One`)

```
You are a senior full-stack engineer working in the One on One repo (Node/TS backend in backend/, Vite TS web client in client/, Supabase DB, Socket.IO, FCM + web-push). Read CLAUDE.md, docs/CONCEPT.md, docs/PROGRESS.md, docs/ARCHITECTURE.md, docs/RELEASING.md first and follow them (surgical changes, update PROGRESS/ARCHITECTURE per part, one branch + PR per part, never push to main directly).

Context: a native Kotlin Android app is being built in a separate repo (aarahman04/One-on-One-Android) against THIS backend. The Capacitor android/ folder here is frozen (critical fixes only) until the native app ships; do not delete it yet.

Do these parts in order, each its own branch/PR, with tests:

W1 — Alarm cancel/ack bug (highest priority).
Root cause (verified): in client/src/pages/ChatPage.ts, sendMessage() builds the optimistic row with no `id`; alarmCard() captures message.id in its click closure; onIncoming() only updates row.dataset.id on the echo and never rebuilds the card. Tapping your own raise therefore sends {ack: undefined, cancelled: true}; backend validateAlarmPayload (backend/src/services/messageService.ts) rejects with 400, but the client already shows "cancelled" and stops locally. Server never records the cancel → recipient keeps ringing, and resync/history load re-shows the alert and "tap to cancel".
Fix:
- Card resolves the raise id at click time from the row (dataset.id / messagesById). If it's still a temp id, keep the card disabled with "sending…" until the echo, then enable.
- Never call markRaiseAcked/stopAll with an undefined id. If the ack send fails, revert the card + glow and show an error.
- Backend: an ack must reference an existing alarm RAISE in the same connection; cancelled:true only by the raiser, plain ack only by the other member; reject once older than 2 min. Make it idempotent: a repeat ack/cancel for the same raise returns the existing ack message without re-saving, re-broadcasting or re-pushing.
- Make sure the alarm FCM data for ack/cancel always carries the RAISE id (alarmFcmData already does; add a test).
Tests: backend unit tests for validation/ownership/idempotency; a client test or a documented manual script: raise→cancel before echo, after echo, reload both sides, nothing re-pops.

W2 — Push hardening for killed apps.
- All FCM message sends: android.priority 'high'.
- Migration: allow push_tokens.platform = 'android-native' (keep 'android' for the Capacitor app). POST /api/push/token accepts an optional platform field (validate an enum).
- For 'android-native' tokens send DATA-ONLY for every message type with: type, messageId, connectionId, senderName (recipient's nickname for the sender), preview (same text as mediaNoticeFor), and for alarms alarmId/ack/cancelled. Keep today's payloads for 'android' and web-push.
- Incoming calls: check whether call:invite pushes when the callee is offline/backgrounded. Add a data-only high-priority FCM {type:'call', callId, kind, callerName} (ttl 30s) to native tokens, plus a {type:'call_end'} on cancel/decline/end.
- Log clearly whether FCM is configured at boot (it should already log `fcm: configured`).

W3 — docs/API-CONTRACT.md: derive it ONLY from code. Cover every REST route in backend/src/routes/*.ts with method, path, auth, request body, response JSON, and error codes. Cover the Socket.IO handshake (auth.token = Supabase access token), every client→server event with payload + ack shape (message:send incl. tempId idempotency, reaction:add/remove, call:invite/accept/decline/signal/end), every server→client event (message:new, receipt:update, reaction:update, connection:ended, call:incoming/accepted/signal/ended), all MessageType values with payload validators, the FCM data schema from W2, rate limits, and the auth flow (Supabase Google ID token). This doc is the Android team's source of truth; keep it updated whenever the API changes.

W4 — Bubble restyle (visual only, keep layout/time/tick placement exactly as now).
- The brand is green #7ee787 + blue #79c0ff on #0d1117 (see the app icon). Own bubbles use a green family, the other person's a blue family, tuned for contrast in dark and light themes (WCAG AA text).
- Restore wallpaper-tinted bubbles: commit 0b71b4a replaced them. Recover the per-wallpaper rules (chat--wallpaper-love, chat--wallpaper-samurai) from `git show eef30be:client/src/styles/global.css` and re-apply them on top of the current markup.
- Use CSS custom properties so the Android app can mirror the exact tokens; list them in docs/ARCHITECTURE.md.
- Screenshots for each wallpaper × theme in the PR.

W5 — Web call audio: make sure remote audio plays through exactly one element at volume 1, unmuted, with no double path through the <video>. Check that autoGainControl is not applied to the playback side. Add a comment that web/PWA can't route to the earpiece (platform limit; the native app handles it).

Don't add features outside this list (spec §29 non-goals). Report each PR link, test output and anything you couldn't verify.
```

## Prompt 2 — GPT Sol 6.1 (Android repo `aarahman04/One-on-One-Android`)

```
You are a senior Android engineer. Build the native Android client for "One on One" — a private 1:1 messaging app (one account, one active connection, one conversation) — in the repo aarahman04/One-on-One-Android. The backend already exists (Node/Socket.IO/Supabase, deployed on Railway) in aarahman04/One-on-One and must NOT be changed from this repo. Your source of truth for every endpoint, socket event, payload and FCM schema is docs/API-CONTRACT.md in the web repo. Read it, plus docs/CONCEPT.md and CLAUDE.md there, before writing code. If the contract is missing something you need, stop and list the gap; don't guess an API.

Non-negotiables:
- applicationId app.web.oneonone, signed with the SAME upload keystore as the existing Play listing (keystore via CI secrets, never committed). versionCode ≥ 5.
- Server is the authority: one-active-connection, membership and message validity are decided by the backend. Never trust local state for authorization.
- All message send/receive goes through a MessageService → Transport interface → InternetTransport (Socket.IO). UI never touches the socket directly (keeps room for a future BluetoothTransport).
- V1 non-goals: no groups, stories, public profiles, AI, Bluetooth. Media, calls, emoji reactions and /letter ARE in scope (they exist in the web app).
- Same Firebase project as the web app (one-on-one-508202). The user adds google-services.json; document the SHA-1/SHA-256 they must register.

Stack: Kotlin, Jetpack Compose + Material 3, single activity, MVVM + Hilt, Retrofit/OkHttp + kotlinx.serialization, io.socket socket.io-client (v4-compatible), supabase-kt auth + Credential Manager Google sign-in → signInWithIdToken (Bearer token for REST, handshake auth.token for the socket), Room cache, WorkManager, Firebase Messaging, io.getstream:stream-webrtc-android, Coil. minSdk 26, targetSdk latest.

Deliver in milestones, one PR each. Each PR updates docs/PROGRESS.md and docs/ARCHITECTURE.md (mermaid) and includes a device test checklist. Stop after each milestone for device verification on a Xiaomi (HyperOS) phone:

A0 Scaffold: Gradle KTS, version catalog, CI (assembleDebug, lint, unit tests; manual dispatch for a signed release AAB), README, CLAUDE.md adapted from the web repo.
A1 Auth + connection: Google sign-in, /me, connection code (show/regenerate), request/accept/decline/cancel, age gate/consent, block list, delete account.
A2 Chat core: paged history, send via socket with tempId + ack + retry (the server dedupes by tempId), receipts, reactions, reply, search, nickname, leave-connection flow, reconnect resync, Room cache, offline queue.
A3 Notifications (must work with the app swiped away/killed):
  - FirebaseMessagingService handling DATA-ONLY messages (platform 'android-native'; register the token on login and on onNewToken via POST /api/push/token with platform).
  - MessagingStyle notifications grouped per conversation, inline reply, mark-as-read, tap opens the chat.
  - Channels created in Application.onCreate.
  - An onboarding/settings screen for Xiaomi/HyperOS/MIUI (and other OEMs): Autostart, battery "No restrictions", notification permission, full-screen-intent permission (API 34+). Use intents with safe fallbacks.
A4 Emergency alarm:
  - Foreground service ringing a looping USAGE_ALARM sound + vibration.
  - Full-screen intent over the lock screen; 2-minute auto-clear.
  - Per-ring random token on PendingIntents (MainActivity is exported; validate extras).
  - Requirements: (1) ack/cancel always uses the server message id of the raise — never a temp id; (2) any stop (FCM ack/cancel, socket ack, user tap, auto-clear) cancels the notification by id and the service; (3) tapping the notification opens the chat once and never re-triggers the ring; (4) handled alarmIds are persisted, so resync/relaunch never re-rings; (5) works when the app is killed.
A5 Calls (audio + video) over the existing socket signaling and /api/turn-credentials:
  - AudioManager MODE_IN_COMMUNICATION. Voice calls default to the EARPIECE, video to the speaker. Speaker toggle and Bluetooth/wired headset routing (setCommunicationDevice on API 31+, setSpeakerphoneOn below).
  - Proximity wake lock on voice calls; volumeControlStream = STREAM_VOICE_CALL.
  - Foreground service type phoneCall|microphone|camera.
  - Incoming call via FCM data → CallStyle full-screen notification with answer/decline, working when killed.
  - Remote audio at full call volume; target loudness parity with WhatsApp.
A6 Feature parity with the web app: letters, voice notes, images/files (upload + signed URLs), ask, countdown, checkin, thisorthat, location, wallpapers + bubble styles (brand green #7ee787 = own bubbles, blue #79c0ff = other, dark bg #0d1117; mirror the CSS tokens listed in the web repo's docs/ARCHITECTURE.md), report/block.
A7 Release: R8 rules, Play Data Safety notes, versionCode bump, internal-track checklist.

Quality bar: unit tests for ViewModels/repositories/alarm state machine; no secrets in git; handle process death; never block the main thread. At each milestone report what was verified on a device vs only compiled.
```
