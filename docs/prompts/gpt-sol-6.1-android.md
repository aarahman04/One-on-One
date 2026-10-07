# Prompt — GPT Sol 6.1: native Android app (One-on-One-Android)

Paste everything below the line into GPT Sol 6.1, started in a terminal at `C:\Users\aarah\One-on-One`.

---

You are a senior Android engineer. Your job is to build the **native Android app** for "One on One", a private 1:1 messaging app (one account, one active connection, one conversation). Write it in Kotlin with Jetpack Compose. It replaces the current Capacitor/WebView Android app.

## Where things are

- **Your terminal starts in `C:\Users\aarah\One-on-One`.** This is the WEB repo: backend + web client + the old Capacitor `android/` folder. Treat it as READ-ONLY reference. Do not edit, commit, or push anything in it.
- **The Android app lives in its own repo: https://github.com/aarahman04/One-on-One-Android.git**
  - Clone it as a sibling folder: `git clone https://github.com/aarahman04/One-on-One-Android.git C:\Users\aarah\One-on-One-Android`.
  - All your code, commits, branches and PRs go there. Use the `gh` CLI for PRs (`gh repo set-default aarahman04/One-on-One-Android`).
  - The repo is empty. Push the A0 scaffold as the first commit on `main`. After that, every milestone gets its own branch + PR into `main`. Do NOT merge PRs yourself; the owner reviews and merges.

## Read these first (in the web repo)

1. `docs/API-CONTRACT.md`. This is the **only** source of truth for every REST route, the Socket.IO handshake and events, message types and payload validation, attachments, TURN, auth and the FCM data schema. If something you need is missing or unclear, STOP and write down the gap in your report. Never guess an endpoint or payload, and never change the backend.
2. `CLAUDE.md`, `docs/CONCEPT.md` (the product spec), `docs/ARCHITECTURE.md` (bubble design tokens; the "Native push for killed apps" and "Two clients, one backend" sections) and `docs/RELEASING.md` (signing/keystore and Play rules).
3. `docs/prompts/PLAN-web-android-split.md`, the overall plan. You own its "Phase A".
4. Reference implementations to port (don't copy blindly):
   - Alarm: `android/app/src/main/java/app/web/oneonone/*.java` (AlarmForegroundService, AlarmMessagingService, MainActivity intent-token checks).
   - Chat: `client/src/pages/ChatPage.ts`.
   - Calls: `client/src/features/call/`.
   - Features: `client/src/features/*`.

## Non-negotiable rules

- **Same app identity:** `applicationId = "app.web.oneonone"`, signed with the SAME upload key as the existing Play listing. The expected signer SHA-1/SHA-256 are in `.github/workflows/android-build.yml` (`EXPECTED_UPLOAD_KEY_SHA1/256`).
  - CI restores the keystore from secrets with the same names as the web repo: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `GOOGLE_SERVICES_JSON_BASE64`. It asserts the signer SHA before and after the build, the same way that workflow does.
  - `versionCode` starts at **5**.
- **No secrets in git:**
  - `google-services.json` is gitignored. For local builds, copy it from `C:\Users\aarah\One-on-One\android\app\google-services.json` (same package, same Firebase project `one-on-one-508202`).
  - API URL, Supabase URL/anon key and Google web client ID come from `local.properties` or Gradle properties into `BuildConfig`. Read the values from `client/.env` locally: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_WEB_CLIENT_ID`. CI reads them from secrets.
  - Commit a `local.properties.example`, never the real file.
- **The server is the authority:**
  - The backend decides one-active-connection, membership, connection status and message validity on every request.
  - The UI only reflects the server. Never trust local state for authorization.
- **Transport abstraction:** UI → ViewModel → `MessageService` → `Transport` interface → `InternetTransport` (Socket.IO). Nothing else touches the socket. This keeps room for a future `BluetoothTransport`.
- **Scope:** match the web app's features. Do NOT add groups, stories, public profiles, AI or Bluetooth.
- **Process:**
  - One milestone per PR. Each PR updates `docs/PROGRESS.md` and `docs/ARCHITECTURE.md` (mermaid) in the Android repo and contains a device test checklist.
  - At the end of each milestone, report what was verified on a real device vs only compiled/unit-tested.
  - Then STOP and wait for the owner to device-test on a Xiaomi (HyperOS) phone before the next milestone.

## Stack

- Kotlin, Jetpack Compose + Material 3, single Activity, Navigation Compose, MVVM, Hilt.
- Retrofit/OkHttp + kotlinx.serialization; `io.socket:socket.io-client` (Socket.IO v4 server).
- supabase-kt Auth + Android Credential Manager Google sign-in → `signInWithIdToken`. The Supabase access token is the REST Bearer token and the socket `auth.token`; refresh it before expiry.
- Room (message cache + offline send queue), DataStore, WorkManager.
- Firebase Messaging; `io.getstream:stream-webrtc-android`; Coil.
- minSdk 26, latest stable targetSdk/compileSdk, Gradle Kotlin DSL + version catalog.

## Milestones

**A0 — Scaffold.**
- Project skeleton with the stack above, theme using the brand tokens (green `#7ee787`, blue `#79c0ff`, background `#0d1117`; full token table in the web repo's `docs/ARCHITECTURE.md` "Bubble design tokens"), and the app icon (from `client/public` / `android/app/src/main/res`).
- GitHub Actions:
  - On PR: assembleDebug + lint + unit tests.
  - On manual dispatch (inputs: versionCode, versionName): signed release AAB + APK, with the SHA asserts.
- README (setup, secrets list, how to build), `.gitignore`, `local.properties.example`.
- CLAUDE.md adapted from the web repo's rules.
- `docs/PROGRESS.md`, `docs/ARCHITECTURE.md`.

**A1 — Auth + connection.**
- Google sign-in, `GET /me`, connection code (show/regenerate), request/accept/decline/cancel connection.
- Age gate/consent screens as in the web app, block list, delete account, sign out (unregister the push token).

**A2 — Chat core.**
- Paged history, live `message:new`.
- Send via `message:send` with a client `tempId` + ack callback + retry. The server dedupes by tempId; see the contract.
- Receipts (`receipt:update`, mark read), reactions, reply, search, nickname.
- Leave-connection 5-step flow, `connection:ended`.
- Reconnect resync, Room cache, offline queue, process-death safe.

**A3 — Notifications that work when the app is killed.**
- Register the FCM token after login and on `onNewToken` via `POST /api/push/token` with `platform: "android-native"`. The backend then sends DATA-ONLY high-priority messages; the schema is in the contract.
- Your `FirebaseMessagingService` builds `MessagingStyle` notifications: grouped per conversation, inline reply, mark-as-read action, tap opens the chat.
- Create the channels (messages, alarm, calls) in `Application.onCreate`.
- Don't notify for the chat that's open on screen.
- Permissions/onboarding screen: POST_NOTIFICATIONS, full-screen-intent (API 34+), and for Xiaomi/HyperOS/MIUI (plus Oppo/Vivo/OnePlus/Samsung) deep links to Autostart and battery "No restrictions", with safe fallbacks when an intent doesn't resolve.
- NOTE: the owner must apply DB migration `035_push_tokens_platform.sql` before `android-native` registration works. If registration fails with a constraint error, say so plainly.

**A4 — Emergency alarm (`/alarm`).**
Port the native alarm and fix the known failure modes:
- Foreground service plays a looping `USAGE_ALARM` sound + vibration, with a full-screen intent over the lock screen. It auto-clears after 2 minutes.
- Raise / ack / cancel UI in chat. ack/cancel ALWAYS uses the **server message id of the raise**. The card stays disabled ("sending…") until the server echo gives the raise its id. Only the raiser can cancel; only the other member can acknowledge. The server enforces both; the UI must match.
- Any stop (FCM ack/cancel data, socket ack message, user tap, Silence action, auto-clear) stops the service AND cancels the notification by id.
- Tapping the notification opens the chat once and never re-triggers the ring or re-posts the notification.
- Persist handled alarmIds (DataStore). Resync, relaunch or history load must never re-ring or re-show an alarm that was acked, cancelled, silenced or expired.
- MainActivity is exported, so validate every intent extra with a per-ring random token, the same way the Capacitor code does.
- Must work with the app killed: data-only FCM → start the foreground service, with a high-priority alarm-channel notification as fallback when the FGS start is refused.
- Unit-test the alarm state machine.

**A5 — Voice + video calls.**
- WebRTC over the existing socket signaling (`call:invite/accept/decline/signal/end`, `call:incoming/accepted/signal/ended`) and `GET /api/turn-credentials`.
- Audio, the main thing that is broken today:
  - `AudioManager.MODE_IN_COMMUNICATION` for the whole call.
  - **Voice calls default to the EARPIECE**; video calls default to the speaker.
  - Speaker toggle; Bluetooth and wired headset routing (`setCommunicationDevice` on API 31+, `setSpeakerphoneOn` below).
  - `volumeControlStream = STREAM_VOICE_CALL`.
  - Remote audio at full call volume. Target loudness similar to WhatsApp.
  - Restore the previous audio mode when the call ends.
- Proximity wake lock (`PROXIMITY_SCREEN_OFF_WAKE_LOCK`) during voice calls.
- Foreground service type `phoneCall|microphone|camera`.
- Incoming call when killed: FCM data `{type:'call', ...}` → full-screen `CallStyle` notification with Answer/Decline. `{type:'call_end'}` dismisses it.
- Call log messages render like the web app.

**A6 — Feature parity.**
- Letters (`/letter`), voice notes (record + play), images and files (upload + signed URLs per the contract).
- ask, countdown, checkin, thisorthat, location, emoji reactions.
- Wallpapers + bubble styles mirroring the web CSS tokens exactly, including the wallpaper-tinted bubbles (love, samurai).
- Report/block, appearance settings, slash-command menu.

**A7 — Release.**
- R8/proguard rules (socket.io, WebRTC, serialization), baseline profile if simple.
- Play Data Safety notes (what data is collected, same as the web app).
- Bump versionCode, internal-track checklist.
- In your report, list the Play Console steps the owner must do by hand.

## Quality bar

- Unit tests for ViewModels, repositories, the alarm state machine and the message send/ack/retry logic.
- No work on the main thread; handle process death and config changes; no leaked sockets or services.
- Accessibility: content descriptions, 48dp touch targets, dynamic font size.
- After every milestone, report:
  - PR link and branch.
  - Commands run and their results.
  - Exactly what to test on the phone.
  - Anything unverified or blocked, and any API-contract gaps.

Start now: clone the Android repo, read the docs listed above, then do **A0** and stop.
