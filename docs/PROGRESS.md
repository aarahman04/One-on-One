# Progress Log

One entry per completed part. Newest at top. Format:

```
## [Phase.Stage.Part] Title — YYYY-MM-DD
Status: done | in-progress | blocked
What shipped:
Notes/deviations:
```

---

## [Capacitor migration] Stage 4 follow-up — push authz + FCM delivery — 2026-09-13
Status: code fixed (backend-only), branch `fix/push-authz-fcm-delivery`. Root
causes confirmed against live prod (Railway backend, Supabase, a real FCM
`validate_only` send) before writing any fix — see investigation below.

Context: Stage 4 (below) was merged as PR #70 before its on-device checklist
ran and before two issues an automated push-security review had flagged were
addressed. Symptom afterward: no push notifications arrived at all (messages
backgrounded or killed, missed calls), and the pre-existing `/alarm` siren
also didn't ring when the app wasn't focused.

Root causes (three, independent):
- **RC-A — FCM silently disabled.** `FIREBASE_SERVICE_ACCOUNT` held only the
  PEM private key, not the full service-account JSON, so `JSON.parse` threw
  and `sendFcmToUser` no-opped on every send with no per-send log (only a
  boot-time warning). Confirmed locally (`backend/.env`); the deployed routes,
  migration `032_push_tokens`, the one saved token, and the service account
  itself all checked out fine (`validate_only:true` FCM send → 200). Not a
  code bug — an env-var content mistake. Fixed the value (uncommitted,
  `.env` is gitignored) and added a per-send warning
  (`fcm: skipped for user … — FIREBASE_SERVICE_ACCOUNT not usable`) so this
  can't go silent again. Railway's copy needed the same fix — see
  docs/PROGRESS.md entry date for confirmation once the user rotated the key
  (the key was exposed in a debugging session transcript and rotated as part
  of this fix).
- **RC-B — backgrounded ≠ offline on native.** `syncDelivery` only pushed when
  the recipient had no live socket. Capacitor's WebView keeps its Socket.IO
  connection open while backgrounded (`Bridge` `KeepRunning` defaults `true`),
  so a backgrounded (not killed) native app looked "online" and never got a
  push — this is what made messages, missed calls, and `/alarm` all look
  broken the same way. Fixed by also sending FCM (native only, never
  web-push) on the online branch: `pushService.sendNativeToUser()`, called
  from `syncDelivery`'s `recipientOnline` branch. Duplicate-free because
  `@capacitor/push-notifications` drops an FCM notification-message silently
  while the app is foreground (only fires the JS `pushNotificationReceived`
  event, which is already a no-op — live socket delivery covers that case).
  Web-push stays untouched: `sw.js` always shows a notification, so it must
  stay gated on "no live socket".
- **RC-C — authorization hole (security, was live on prod).**
  `POST /api/push/token/unregister` deleted a `push_tokens` row by token
  alone, with no ownership check — any authenticated user who obtained
  another user's FCM token could delete their push registration. Fixed:
  `removeToken(userId, token)` now scopes the delete to `user_id` too;
  `routes/push.ts` passes `req.appUser!.id`. (`push_subscriptions`'
  `removeSubscription` is intentionally unscoped-by-user — pre-existing,
  documented rationale, out of scope here.)

`/alarm` clarified: not a separate regression. The in-app siren
(`features/alarm.ts`) has always been documented foreground-only; its
backgrounded/closed behavior has always been the push path with
`urgent: true` (`PRIORITY_MAX` on FCM). RC-A + RC-B together explain why it
silently stopped working — same fix, no alarm-specific code changed.

Files changed: `backend/src/services/pushService.ts` (`removeToken` scoped,
per-send FCM-unconfigured warning, new `sendNativeToUser`),
`backend/src/routes/push.ts` (unregister passes caller id),
`backend/src/websocket/socketServer.ts` (`syncDelivery` sends FCM on the
online branch too). No client/, android/, or migration changes.

On-device results: _pending — fill in after Railway redeploys with the
corrected `FIREBASE_SERVICE_ACCOUNT` and this PR is merged._

---

## [Capacitor migration] Stage 4 — FCM push on the native build — 2026-09-10
Status: code done, branch `capacitor/stage-4-fcm`. Off-device verification only
(client `tsc` + `vite build` clean, backend `tsc` clean, `cap sync` picks up the
plugin, `:app:assembleDebug` succeeds without `google-services.json`, merged
manifest has one `POST_NOTIFICATIONS`, the FCM `FirebaseMessagingService`, and the
`default_notification_channel_id=messages` meta-data). On-device checklist
pending before PR.

Problem: the PWA's Web Push / VAPID path depends on a service worker, which the
Capacitor WebView never registers (skipped since Stage 1). So the native build
had no push at all. Replace it with FCM on native while leaving the web PWA's
web-push path completely intact.

What shipped:
- **Both transports coexist.** `pushService.sendToUser()` now fans out to
  `sendWebPushToUser()` (unchanged VAPID path, `push_subscriptions`) **and**
  `sendFcmToUser()` (new, `push_tokens`). Each is independently gated by its own
  keys — unset ⇒ warn + no-op, same stance as before. The two send call sites
  (`socketServer.ts:117` new message, `callService.ts` missed call) and the
  `{ title, body, urgent? }` payload shape are untouched.
- **Backend FCM (HTTP v1, not legacy).** `FIREBASE_SERVICE_ACCOUNT` env var holds
  the whole service-account JSON (never a repo file). `pushService.ts` mints an
  OAuth2 access token from it via the JWT-bearer grant (hand-rolled RS256 with
  `node:crypto` — no `googleapis` dep), caches it, and POSTs to
  `fcm.googleapis.com/v1/projects/<id>/messages:send`. Prunes tokens FCM reports
  `UNREGISTERED` / `INVALID_ARGUMENT` (or HTTP 404/400), mirroring the web-push
  404/410 pruning. `urgent` maps to `notification_priority: PRIORITY_MAX`.
- **Migration `032_push_tokens.sql`** — new `push_tokens` table (`user_id`,
  `token` unique, `platform`), *not* nullable columns on `push_subscriptions`:
  the two credential shapes share nothing and this leaves the live web-push
  table + its `onConflict:'endpoint'` upsert untouched. **Apply manually in the
  Supabase SQL Editor.**
- **`routes/push.ts`** — added `POST /api/push/token` (with `strictLimiter`) and
  `POST /api/push/token/unregister`. A token is opaque, so it is **not** run
  through `assertValidPushEndpoint` (which expects an https URL).
- **Client `features/pushNotifications.ts`** — branches on
  `Capacitor.isNativePlatform()`. Web path is byte-for-byte unchanged. Native
  path dynamic-imports `@capacitor/push-notifications`, requests permission,
  creates the `messages` channel, `register()`s, reads the token off the
  `registration` listener and POSTs it. `isPushSupported()` now returns `true` on
  native, so the **Notifications** menu item appears on Android (it was absent —
  `ChatPage.ts` unchanged). `unsubscribeFromPush()` unregisters + deletes the
  server token. Foreground / tap listeners are registered but thin (live socket
  delivery + singleTask relaunch already cover both cases).
- **Android** — `@capacitor/push-notifications@8.1.2` added; `cap sync` wires
  `:capacitor-push-notifications` and the FCM AAR. `AndroidManifest.xml` gained
  one `<meta-data default_notification_channel_id="messages">`. The
  `com.google.gms.google-services` Gradle plugin + classpath were **already**
  present from the Capacitor 8 template, already guarded on `google-services.json`
  the same way `app/build.gradle` guards `keystore.properties` — no change
  needed. `google-services.json` is **gitignored** (per-project config the user
  supplies, like `keystore.properties`; the guard lets a clone build without it).

User-supplied Firebase artifacts (surfaced separately, not done here):
1. Firebase project attached to the existing Google Cloud project.
2. Android app registered with package `app.web.oneonone` → `google-services.json`
   → dropped at `android/app/google-services.json`.
3. Service-account key (JSON) → set as the `FIREBASE_SERVICE_ACCOUNT` env var on
   Railway (single-line JSON).

Decisions:
- **Permission-prompt owner:** `@capacitor/push-notifications` owns the
  `POST_NOTIFICATIONS` runtime prompt (fires when the user toggles Notifications
  on). Stage 3's `CallServicePlugin` still *can* request it, but only at
  call-start and only if not already granted, so in practice it finds the
  permission already answered. `CallServicePlugin.java` was **not** touched
  (frozen since Stage 3) — it self-defers.
- **Channel:** new `messages` channel at importance HIGH (5). The existing
  low-importance `calls` channel (owned by `CallForegroundService`) is left
  exactly as-is — deliberately quiet because a call plays its own ringtone.

Still deferred (same as Stage 3): no FCM call-wake — push-triggered ringing with
the app closed and native incoming-call UI remain out of scope. Stage 4 delivers
notifications for new messages and missed calls only.

Notes/deviations: on-device verification is the whole point of the stage —
a message notification arriving with the app **fully killed** is what proves FCM
works; a backgrounded WebView notification proves nothing. Cannot be checked
off-device.

**Gotcha, cost a full on-device round:** the native build talks to the *deployed*
Railway backend (`client/.env.production` → `VITE_API_URL`), so the Notifications
toggle fails with `failed to save token` until the Stage 4 backend is actually
deployed — `POST /api/push/token` 404s on any older revision. Railway's deploy
branch is configured in its dashboard only (no `railway.json` / `nixpacks.toml` /
`Procfile` in the repo), so testing this stage means repointing Railway at the
branch first. Hardening added afterwards so this can't recur silently: the client
now puts the HTTP status in the error (`failed to save token (404)`), the backend
logs `fcm: configured for project <id>` at boot, and `sendToUser` uses
`Promise.allSettled` with per-transport error logs (both send call sites swallow
errors in an empty `catch`, so an FCM failure was previously invisible).
Also hardened: the `registration` / `registrationError` listener handles are now
awaited *before* `register()` — Capacitor doesn't buffer an event fired before
its JS listener attaches, so the old order could lose the token.

**Android testing notes (platform behaviour, not app bugs):** on MIUI/Xiaomi the
app needs **Autostart** enabled and battery saver set to **No restrictions**, or
the OS freezes it and FCM never lands. "Fully killed" must mean *swiped from
recents* — **Force stop** in App info blocks all FCM delivery on every OEM until
the app is manually relaunched.

---

## [Capacitor migration] Stage 3 — call foreground service — 2026-09-10
Status: code done, branch `capacitor/stage-3-call-foreground-service`. Off-device
verification only (build + tsc + merged manifest). On-device checklist pending
before PR.

Problem: calls did not survive backgrounding on the Capacitor build. The TWA got
this free — Chrome kept its own process alive. The WebView shell does not, so
pressing Home during a call froze/killed the media within seconds.

What shipped:
- `AndroidManifest.xml` — added `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`,
  `VIBRATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_PHONE_CALL`,
  `MANAGE_OWN_CALLS`, `POST_NOTIFICATIONS`, and a `<service
  android:name=".CallForegroundService" android:foregroundServiceType="phoneCall"
  android:exported="false" />`.
- `CallForegroundService.java` — plain started service. `onStartCommand` calls
  `startForeground` first thing (typed `FOREGROUND_SERVICE_TYPE_PHONE_CALL` on API
  ≥ 29, plain below, minSdk is 24) and returns `START_NOT_STICKY`. Creates a
  low-importance NotificationChannel `calls` on first use — low on purpose: the
  app plays its own ringtone / `/alarm` sound and a higher importance would add a
  second OS sound. Ongoing notification, `CATEGORY_CALL`, "Ongoing audio/video
  call" from a `kind` extra, contentIntent back to the singleTask `MainActivity`.
  Handles `ACTION_STOP` → `stopForeground(STOP_FOREGROUND_REMOVE)` + `stopSelf()`.
- `CallServicePlugin.java` — `@CapacitorPlugin(name = "CallService")` with
  idempotent `start` / `stop`. On API 33+ requests `POST_NOTIFICATIONS`; denial is
  non-fatal, the service starts regardless.
- `MainActivity.java` — `onCreate` registers the plugin before
  `super.onCreate`. Stage 2's `onActivityResult` forwarding and the
  `ModifiedMainActivityForSocialLoginPlugin` interface are untouched.
- `client/src/services/callForegroundService.ts` — `startCallService` /
  `stopCallService`. No-ops off native, swallow all errors (a service that won't
  start must degrade to today's behaviour, never break the call).
- `client/src/features/call/controller.ts` — starts the service on
  `ringing-out` (both sites) and on the incoming-accept `in-call`; stops it in
  `reset()` and `dispose()`. Not started for `ringing-in` — no media is held
  before accept. Nothing else in the file changed.

MANAGE_OWN_CALLS prerequisite: Android's foreground-service-types rules require
either `MANAGE_OWN_CALLS` in the manifest OR the `ROLE_DIALER` role for the
`phoneCall` service type. Declaration alone is sufficient — no ConnectionService,
no dialer role. `MANAGE_OWN_CALLS` is normal / install-time, so there is no
runtime prompt.

Deferred — speaker/earpiece routing: `controller.ts` gates the speaker button
behind `setSinkId`, which Android WebView lacks, so the button is simply not
rendered on Android. That matches the TWA, so it is not a regression. No
AudioManager plugin was built. Revisit if native output-routing control is ever
needed.

Known gap: an unanswered *incoming* call may not survive backgrounding — the
service is only started once the call is accepted, and FCM call-wake
(push-triggered ringing with the app closed) is out of scope, deferred to a future
project. Native incoming-call UI is likewise deferred.

### Bugfix 1 — stale install (no code change)
On-device: system mic/camera dialogs never appeared, Settings listed no
Camera/Microphone toggle. Root cause: the test devices were running an APK built
before Stage 3 added `CAMERA` / `RECORD_AUDIO` to the manifest — Android returns
an instant silent denial for an undeclared permission, so Capacitor's
`BridgeWebChromeClient.onPermissionRequest` bridge had nothing to grant. Fix:
`adb uninstall app.web.oneonone` then reinstall this branch's APK (`versionCode`
never bumped across the migration, so install-over can skip refreshing the
manifest). Verified: fresh `dumpsys package` shows all three runtime permissions
declared and pending. No source change.

### Bugfix 2 — remote video black on Android + `/location` permission
Two device-reported issues:

1. **Video call, remote video never renders on Android** (local preview fine,
   audio bidirectional fine, web side renders both). Root cause: Android System
   WebView does not repaint a `<video>` when a track is added to an
   already-attached `MediaStream` — desktop Chrome re-runs its media-element load
   algorithm and picks up the track, WebView does not. The remote peer adds its
   audio track then its video track, so `controller.ts`'s `onRemoteStream` bound
   an audio-only stream on the first `ontrack` and the later video track never
   showed. Fix (client, `controller.ts` `onRemoteStream` only): when the remote
   track set changes, bind a fresh `new MediaStream(stream.getTracks())` to force
   the repaint. No change to `session.ts` / `media.ts`. Web path unaffected
   (guarded on track-count change; desktop already worked).

2. **`/location` never prompted on native.** `location.ts` uses
   `navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true })`.
   Capacitor's `BridgeWebChromeClient.onGeolocationPermissionsShowPrompt`
   (verified in `@capacitor/android` 8.5.1 source, line 246) requests
   `ACCESS_COARSE_LOCATION` + `ACCESS_FINE_LOCATION` through the same permission
   bridge as camera/mic — but neither was in the manifest, so the request was an
   instant silent denial. Fix: added both to `AndroidManifest.xml`. `Bridge.java`
   already calls `settings.setGeolocationEnabled(true)` (line 591), so no other
   wiring is needed.

## [Capacitor migration] Stage 2 bugfix — `[16] Account reauth failed` — 2026-09-10
Status: code done, branch `capacitor/stage-2-fix-signing`. Not a new stage — a
fix on top of Stage 2 (PR #66). One user action + one on-device re-test remain
before Stage 3.

Symptom: on-device Google sign-in failed every attempt with
`Google Sign-In failed: [16] Account reauth failed`.

Root cause (confirmed from device Logcat, tag `GoogleProvider`):
```
signingSha1=ED:02:08:A3:38:18:A4:18:40:AC:EF:D9:BD:C2:B2:0C:ED:37:55:9D
ui=standard  filterByAuthorizedAccounts=false  autoSelectEnabled=false  nonceSet=true
```
The app is installed via Android Studio's Run button → **debug** variant, signed
with `~/.android/debug.keystore` (SHA-1 `ED:02:…:9D`). The Android OAuth client is
registered against the **`oneonone-upload`** SHA-1 (`36:A9:69:…:C6`). Mismatch →
Credential Manager can't validate the app → reauth fails permanently. The
plugin's built-in retry (clear state + re-prompt, PR #430 / 8.3.38) can't fix an
unregistered cert, which is why it failed twice.

Ruled out from plugin source (`@capgo/capacitor-social-login` 8.5.7,
`GoogleProvider.java`) + the device log: `filterByAuthorizedAccounts` (default
`false`, only settable on `style:'bottom'`, we pass no style → `GetSignInWithGoogleOption`);
stale credential state (retry already clears it); nonce (`nonceSet=true` on the
wire; a nonce fault would fail later at `signInWithIdToken`, not at `[16]`).

Fix — two halves:
- **Code (this branch):** `android/app/build.gradle` had **no `signingConfigs`
  block**. Added `signingConfigs.release` + `buildTypes.release.signingConfig`,
  both guarded on a gitignored `android/keystore.properties` existing (absent →
  configures + builds unsigned, prior behaviour; Stage 6 CI will write the file
  from `ANDROID_KEYSTORE_*` secrets). `android/keystore.properties.example`
  added; `keystore.properties` gitignored. Verified with
  `./gradlew :app:signingReport`: `release` Config `null` without the file,
  picks up the key with it. **No `nativeGoogleAuth.ts` change** — nonce/options
  confirmed correct on-device.
- **User action (pending):** register the debug SHA-1
  `ED:02:08:A3:38:18:A4:18:40:AC:EF:D9:BD:C2:B2:0C:ED:37:55:9D` as a *second*
  Android OAuth client (package `app.web.oneonone`, project `one-on-one-508202`,
  additive — nothing existing changes) so Run-button installs authenticate.

Remaining before Stage 3 (all six must pass): debug SHA-1 registered; first-tap
picker → signed in, no `[16]`; session survives app kill/reopen; Logcat still
`nonceSet=true` + no Supabase nonce error; `./gradlew assembleRelease` with
`keystore.properties` present yields an APK whose SHA-1 == `36:A9:69:…:C6`; web
login on `one-on-one-mu.vercel.app` still fine; **after consent the app
returns to a signed-in UI** (bugfix #2 — MainActivity forward); **app then
loads connections/chat data from the Railway backend and stays on the real UI**
(bugfix #3 — no localhost, no CSP block, no "startup failed" fallback).

---

## [Capacitor migration] Stage 2 bugfix #4 — no UI transition after native sign-in — 2026-09-10
Status: code done, branch `capacitor/stage-2-fix-signing`. **On-device fresh
sign-in still unverified** — must be tested from a clean install, not a relaunch
with an existing session.

Symptom: with #2 and #3 in place, native sign-in fully succeeds (Logcat shows
idToken/accessToken/profile; a restart lands straight in the chat UI). But on the
*first* sign-in inside a running app session, the login screen just sits there
with no visible change. Only close-and-reopen shows the authenticated UI.

Root cause: `main.ts` resolved the screen exactly once, at module top level, and
nothing re-ran it. The web flow never needed more — `signInWithOAuth` navigates
the browser to Google, and the redirect back is a full page load that re-executes
the module and re-resolves the screen. The native Credential Manager flow
navigates nowhere; `signInWithIdToken` just resolves a promise. `LoginPage.ts`
awaited `signInWithGoogle()` and then did nothing with it, so the router was
never told to move. The router already passes every page a `go(screen)`
navigator (`state/router.ts:19,35`) — `LoginPage` declared `(root)` and dropped it.

Fix (4 files, no behaviour change on web):
- **`client/src/state/boot.ts` (new)** — `resolveScreenForSession()` (the
  session → connection → screen resolution lifted verbatim out of `main.ts`) and
  `goToPostSignInScreen(root, go)`, which re-resolves, applies
  `ensureFirstRunGates` and calls `go(screen)`. The gate call matters: without it
  a native first-timer would skip the 18+/Terms screen that the cold-boot path
  enforces.
- **`authService.signInWithGoogle()` now returns `boolean`** — true only when a
  session exists in *this* page (native), false when the browser is mid-redirect
  (web) or the picker was cancelled. Keeps the platform check in one place
  instead of importing Capacitor into the login screen.
- **`nativeGoogleAuth.signInWithGoogleNative()`** returns `true` after
  `signInWithIdToken`, `false` on `USER_CANCELLED`.
- **`LoginPage.ts`** takes the `go` it was already being handed and calls
  `goToPostSignInScreen(root, go)` when sign-in returns true — on both the main
  button and the "Use a different account" button.
- **`main.ts`** drops its local `resolveInitialScreen()` and calls
  `resolveScreenForSession()`, keeping the `hadOAuthError` short-circuit at the
  call site. No duplicated routing logic.

Verified off-device: `tsc` clean, `vite build` succeeds, `nativeGoogleAuth` still
lazily chunked (plugin stays out of the web entry), bundle still carries the
Railway URL and no localhost, `npx cap sync android` + `./gradlew installDebug`
succeeded on device + emulator.

Known adjacent issue, **not** touched (pre-existing, unchanged by this fix):
`main.ts` `onSignedOut(() => location.assign('/'))` races the "Use a different
account" path, which calls `signOut()` and then immediately `signInWithGoogle(true)`.
The sign-out event can reload the page mid-flow. Flag for a follow-up if the
device test shows the switch-account path misbehaving.

---

## [Capacitor migration] Stage 2 bugfix #3 — native build pointed at localhost — 2026-09-10
Status: code done, branch `capacitor/stage-2-fix-signing`. On-device re-test
pending. Same fix series as below.

Symptom: with bugfix #2 in place, Google sign-in **succeeds** on device (Logcat
shows access token, ID token and profile returned) — then the app drops straight
back to the login screen. Device console:
```
Connecting to 'http://localhost:3000/api/connections/current' violates the
following Content Security Policy directive: "connect-src 'self' ... "
startup failed, falling back to login: TypeError: Failed to fetch
```
`main.ts:133` catches the failed startup fetch and falls back to login, so a
working sign-in looked identical to a broken one.

Root cause: `client/.env` (a dev file) carries `VITE_API_URL=http://localhost:3000`,
and **Vite loads `.env` in every mode, production included**. There was no
`.env.production` to override it, so the local `npm run build` that feeds
`npx cap sync` baked `localhost:3000` into the APK. The web deploy was never
affected because Vercel sets `VITE_API_URL` as a project env var and Vite's
`loadEnv` lets real `process.env` values win over `.env` files. Confirmed by
pulling the live bundle from `one-on-one-mu.vercel.app` and grepping it — it
contains `https://one-on-one-production-a5b8.up.railway.app`.

Blast radius was both consumers of the value, not just the startup fetch:
`client/src/services/apiClient.ts:3` (REST) and
`client/src/services/transport/InternetTransport.ts:7` (Socket.IO) — so realtime
was pointed at localhost on device too.

Fix: added **committed** `client/.env.production` with
`VITE_API_URL=https://one-on-one-production-a5b8.up.railway.app`, and un-ignored
it via `!.env.production` in `client/.gitignore` (repo already un-ignores
`.env.example`). File header states public/non-secret values only. Vite
precedence does the rest: `.env.production` beats `.env` for `npm run build`,
Vercel's project env var still beats both on web, and `npm run dev`
(mode=development) never reads it so local dev keeps localhost. No source
change, no CSP change. `client/.env.example` notes the override.

CSP re-checked, no change needed: `connect-src` in `client/index.html` and
`client/vercel.json` already allows `https://*.up.railway.app` +
`wss://*.up.railway.app`, which covers both the REST calls and the Socket.IO
websocket upgrade.

Verified off-device:
- Rebuilt bundle contains zero `http://localhost:3000`; contains the Railway URL.
  Chunk hash `index-FHtZ0gyo.js` now matches the deployed Vercel bundle exactly.
- `npx cap sync android` copied it into `android/app/src/main/assets/public`.
- `./gradlew installDebug` — BUILD SUCCESSFUL, installed on device + emulator.
- Backend live: `GET /api/me` and `/api/connections/current` → `401`
  (up, correctly rejecting unauthenticated).
- CORS live on Railway: `OPTIONS /api/connections/current` with
  `Origin: https://localhost` → `204`, `access-control-allow-origin: https://localhost`.
  The Stage 1 native-origin allowance is deployed.

Account special-casing audit (user asked, after testing with two accounts):
none. Only identity strings in the client are `CONTACT_EMAIL` /
`CHILD_SAFETY_CONTACT` in `client/src/pages/legalShared.ts:11-12`, display-only
on the legal pages. No identity branching anywhere in `client/src` or
`backend/src` — both test accounts take identical code paths.

---

## [Capacitor migration] Stage 2 bugfix #2 — sign-in hangs after consent — 2026-09-10
Status: code done, branch `capacitor/stage-2-fix-signing`. Same fix series as
above. On-device re-test pending.

Symptom: after the debug SHA-1 was registered, the account picker and Google
consent screen ("Agree and continue") both complete — then nothing. App never
returns to a signed-in UI; JS promise from `signInWithGoogleNative` never
settles.

Root cause (from plugin source, `@capgo/capacitor-social-login` 8.5.7,
`GoogleProvider.java` + `SocialLoginPlugin.java`): Credential Manager returns the
ID token, then the plugin runs `getAuthorizationResult()` and **blocks** on
`future.get()` (no timeout) on a background executor. Scopes aren't granted yet,
so `authorizationResult.hasResolution()` is true and the plugin launches the
consent screen with `activity.startIntentSenderForResult(...,
REQUEST_AUTHORIZE_GOOGLE_MIN + i, ...)` — **directly on the Activity, outside the
Capacitor bridge**. The result lands in `MainActivity.onActivityResult`;
Capacitor's `BridgeActivity` only dispatches request codes it registered, so it's
dropped. `SocialLoginPlugin.handleGoogleLoginIntent(requestCode, intent)` is
`public` and never called anywhere in the plugin — it exists solely to be
invoked from a modified `MainActivity`. Our `MainActivity` was bare
(`extends BridgeActivity {}`), so the completer is never completed, `future.get()`
blocks forever, `call.resolve()` never fires. The plugin's
`instanceof ModifiedMainActivityForSocialLoginPlugin` guard only *enforces* the
modification for `OFFLINE` mode, so ONLINE mode failed silently.

Client-ID audit (user asked, after a foreign OAuth client ID was added somewhere
while debugging): repo-wide grep for `apps.googleusercontent.com` / `628827083956`
/ `clientId` / `webClientId` over `*.ts,tsx,json,gradle,xml,env,md,yml` (minus
`node_modules`, `dist`) — exactly one web client ID referenced,
`628827083956-au0n92v35p0un0kob10254j7rhc0tcft.apps.googleusercontent.com`
(hardcoded fallback in `nativeGoogleAuth.ts`, `VITE_GOOGLE_WEB_CLIENT_ID` absent
from `client/.env`). No `google-services.json`, no `default_web_client_id` in
`strings.xml`. The foreign client ID is inert — not referenced anywhere in the
build. Nonce handling in `nativeGoogleAuth.ts` confirmed correct against plugin
source (plugin passes our value straight to `GoogleIdOption.setNonce`, no extra
hashing).

Fix — one file, `android/app/src/main/java/app/web/oneonone/MainActivity.java`:
implement `ModifiedMainActivityForSocialLoginPlugin`, override `onActivityResult`
to forward the `REQUEST_AUTHORIZE_GOOGLE_MIN.._MAX` range to
`SocialLoginPlugin.handleGoogleLoginIntent`. No JS/TS change. Verified
`./gradlew compileDebugJavaWithJavac` succeeds.

User action (pending): confirm Supabase → Authentication → Providers → Google →
**Authorized Client IDs** contains the web client ID above (field is separate
from Client ID/Secret; used by `signInWithIdToken`). Remove any other entry.

---

## [Capacitor migration] Stage 2 — native Google sign-in — 2026-09-10
Status: done. Branch `capacitor/stage-2-native-auth`.

Why: Google returns `disallowed_useragent` for OAuth redirects inside embedded
WebViews, so the browser-redirect flow (`signInWithOAuth` + `redirectTo`) cannot
work in the Capacitor shell. On the device the old flow failed with
`Error 400: redirect_uri_mismatch` (origin is now `https://localhost`, never an
authorized redirect URI). Confirmed the plan's prediction.

What shipped:
- `@capgo/capacitor-social-login` 8.5.7 (Capacitor 8 compatible). `capacitor.config.ts`
  `plugins.SocialLogin.providers` enables Google only — keeps the Facebook /
  Twitter / Apple native SDKs out of the APK (`cap sync` confirmed the trim).
- `client/src/services/nativeGoogleAuth.ts` (new): `SocialLogin.initialize({ google: { webClientId } })`
  (memoized) → `SocialLogin.login({ provider: 'google', options: { nonce } })` →
  `supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce })`.
  Nonce handling verified against Supabase + Capgo current docs: **raw** nonce
  (`crypto.randomUUID()`) → Supabase; **SHA-256 hex** of it → Google (lands in
  the ID token `nonce` claim; Supabase re-hashes and compares). `USER_CANCELLED`
  (picker dismissed) is swallowed.
- `client/src/services/authService.ts`: `signInWithGoogle()` branches on
  `Capacitor.isNativePlatform()`. Native path is a **dynamic import**, so the
  plugin stays out of the web bundle's initial load (verified: eager JS size
  unchanged, `nativeGoogleAuth`/`web`/`twitter-provider` split into lazy chunks).
- `client/.env.example`: optional `VITE_GOOGLE_WEB_CLIENT_ID` documented. Falls
  back to the hardcoded Web client ID for Google Cloud project `one-on-one-508202`
  (`628827083956-au0n92v35p0un0kob10254j7rhc0tcft`) — public value (ID token `aud`).
- `.gitignore`: added `.idea/` (Android Studio project metadata).

Verified against real docs/source (not assumed):
- `@capgo/capacitor-social-login` definitions (`npm pack`): `login()` returns
  `{ provider, result }` with `result.idToken`; `GoogleLoginOptions.nonce` exists;
  `InitializeOptions.google.webClientId` is the Web (not Android) client ID —
  the README calls using the Android ID here "a common mistake".
- `@supabase/auth-js` installed types: `SignInWithIdTokenCredentials` = `{ provider,
  token, access_token?, nonce? }`; nonce doc says "the hash of this value is
  compared to the value in the ID token" → we pass raw.
- Supabase Google docs Android/Kotlin example: hashed nonce → Google, raw → Supabase.

Notes / clarifications:
- The **Android** OAuth client ID (`...c6q7ertto3dabfij...`) is never referenced
  in code — Credential Manager matches it via the APK signature against what's
  registered in Google Cloud Console (package `app.web.oneonone` + upload-key
  SHA-1, which the user already registered). Only the Web client ID goes in code.
- Google's `prompt: 'select_account'` is web-only in this plugin. On Android the
  default `style: 'standard'` already shows an account picker every time; the
  "Use a different account" path additionally calls `SocialLogin.logout()` first
  to clear Credential Manager's remembered account.
- `main.ts` unchanged — `captureOAuthError()` and the `detectSessionInUrl`
  default are inert no-ops on native (the URL never carries a fragment/error),
  not a broken path. Left alone per the surgical-change rule.
- **Not device-tested by Claude** (no Android toolchain here). User verifies on a
  physical device: tap sign-in → native Google picker (no browser, no
  `redirect_uri_mismatch`) → signed in → kill & reopen the app, still signed in.
  Then re-test web login on `one-on-one-mu.vercel.app` (must be unaffected).

---

## [Capacitor migration] Stage 1 — scaffold the Capacitor shell — 2026-09-10
Status: done. Branch `capacitor/stage-1-scaffold`.

Why: the Bubblewrap TWA runs in Chrome's process and inherits Chrome-level
settings — a Chrome app-lock setting leaked into the wrapped app on the user's
device, demanding a fingerprint unlock. A Capacitor shell gets its own process
identity, data dir, and permissions. Full plan +7-stage breakdown:
`~/.claude/plans/pr-63-is-merged-radiant-dragon.md`.

What shipped:
- `client/`: `@capacitor/core` + `@capacitor/android` (deps), `@capacitor/cli`
  (dev) — Capacitor 8.5.1. `client/capacitor.config.ts` — appId
  `app.web.oneonone`, `webDir: dist`, `androidScheme: https` (https://localhost
  is a secure context; getUserMedia/geolocation need it), native path `../android`.
- `android/`: committed Capacitor Gradle project. minSdk 24, target/compileSdk 36
  (same as the Bubblewrap template). Capacitor's generated `.gitignore` replaces
  the TWA one (commits the project, ignores build output); keystore-ignore lines
  un-commented + `android.keystore` / `signing-key-info.txt` re-added.
- `client/index.html`: CSP from `vercel.json` mirrored as a `<meta>` tag so the
  native build (no Vercel headers) is covered. Kept in sync manually.
- `backend/src/index.ts`: `https://localhost` added to the CORS allowlist
  (Express + Socket.IO) — the fixed Capacitor WebView origin.
- `client/src/main.ts`: service-worker registration skipped on native
  (`Capacitor.isNativePlatform()`).
- `.gitattributes`: `android/gradlew` forced to LF, `*.jar` binary.

Notes/deviations:
- Native project placed at repo-root `android/` (user pick) via
  `capacitor.config.ts` `android.path`, not the nested `client/android/` default.
- `twa-manifest.json` + `android-build.yml` intentionally left in place;
  the build pipeline is rewritten for Gradle in Stage 6. `android-build.yml` is
  `workflow_dispatch`-only, so it never auto-runs.
- **Login is expected to be broken in the native app** (`disallowed_useragent`).
  Native Credential Manager + `signInWithIdToken` is Stage 2.
- Not device-tested by Claude (no Android toolchain here). User verifies:
  `cd client && npm run build && npx cap sync`, open `android/` in Android
  Studio, run on a device — UI renders, socket connects, messages flow.
- `npm audit` flags a moderate `uuid` advisory transitively via
  `@capacitor/cli` (dev-only, build tooling). `audit fix --force` would
  downgrade the CLI — left as-is.

---

## [Play Store / TWA] assetlinks.json — real upload-key fingerprint — 2026-09-09
Status: done.

What shipped:
- `client/public/.well-known/assetlinks.json` — all-zero placeholder replaced
  with the real **upload-key** SHA-256 (`oneonone-upload` alias, from
  `keytool -list -v -keystore android.keystore`). `_comment` key removed so the
  statement object is spec-exact (`relation` + `target` only) — the Digital
  Asset Links spec defines no `_comment` key and is silent on unknown-key
  handling; DAL failure is silent, so the risk was one-directional.
- `docs/playstore/ANDROID_BUILD.md` — "ordering dance" section reworked: upload
  key verifies **sideloaded** builds only; the Play App Signing cert is
  **appended** (not swapped) as a second `sha256_cert_fingerprints` entry after
  the first AAB upload. Added HTTP 200 / `application/json` / no-redirect
  hosting constraints + Google `statements:list` parser check to the Stage 4
  exit list.
- `docs/ARCHITECTURE.md` — corrected the one line claiming a placeholder ships.

Notes/deviations:
- **Supersedes** the earlier Stage 3 note in this log ("assetlinks.json
  unchanged — the Stage 3 placeholder is correct until the first Play upload").
  The upload key gives working sideload verification now; waiting for Play was
  unnecessary for that path.
- Still pending: the Play App Signing SHA-256 (append after first Closed-testing
  upload). Play-distributed builds show the address bar until then.
- Takes effect only on a Vercel production redeploy — the file is a static
  asset baked into `client/dist/.well-known/` at build time.

---

## [Play Store / TWA] Stage 4 fix — twa-manifest.json / CI Gradle gen — 2026-09-09
Status: done. First real `android-build.yml` run (34351166418) failed at `bubblewrap
build` — generated `app/build.gradle:44` `splashScreenFadeOutDuration: ,` unparseable.

Root cause: `android/twa-manifest.json` was hand-authored, never through
`bubblewrap init`. Verified against `@bubblewrap/core@1.25.0` (`npm pack`):
`splashScreenFadeOutDuration` is a **required** schema key with **no** code
fallback and renders unquoted into Gradle. Same audit caught `"appVersionName"` —
not a key Bubblewrap reads (schema key is `"appVersion"`); would have shipped an
empty Gradle `versionName`.

What shipped:
- `android/twa-manifest.json` — add `"splashScreenFadeOutDuration": 300`; rename
  `"appVersionName"` → `"appVersion"` (value unchanged). Rest of file audited
  against the 1.25.0 template — clean.
- `.github/workflows/android-build.yml` — sync step now writes `m.appVersion`;
  new `Verify generated Gradle` step greps the emitted version/SDK lines;
  keystore-upload step gated `if: always() && ...` so a build failure no longer
  discards a freshly generated upload keystore (run 34351166418 did exactly that —
  no secrets were ever set, so nothing lost, but the next run regenerates).
- `docs/playstore/ANDROID_BUILD.md` — key-fields table (+`splashScreenFadeOutDuration`,
  `appVersion` note); `targetSdkVersion`/`compileSdkVersion` are hardcoded 36 in
  1.25.0 (was "not pinned, verify at build time"); removed the dead "if
  `bubblewrap update` fails" escape hatch — `update` on the bare project is
  confirmed working.

Notes/deviations: no client/server code touched. `bubblewrap update` needs no
committed Gradle project. Next CI run generates a new keystore + passwords (none
were ever uploaded to Play — no reconciliation).

---

## [Play Store / TWA] Stage 6 — handoff & PRs — 2026-09-09
Status: done. `docs/playstore/NEW_SESSION_PROMPT.md` written (post-execution
handoff — the plan is implemented; it lists the user's Play Console steps + the
deferred verifications + the one fingerprint paste-back). Client `tsc` +
`vite build` clean.

PR split (all against `main`, merge in order A → B → C — GitHub reduces each
diff as the prior merges):
- **PR-A** `playstore/stage-1-compliance` — Stage 1 (commits e6cdeed, 5d49d83).
- **PR-B** `playstore/stage-2-legal` — + Stage 2 (92838f5).
- **PR-C** `playstore/stage-3-5-packaging` — + Stages 3–5 + this Stage 6 commit.

All work was stacked on `feat/playstore-stage1-compliance`; the three branches
are slices of that history.

---

## [Play Store / TWA] Stage 5 — console-ready package — 2026-09-09
Status: done. Docs + one helper script; no code, no build change (client `tsc` +
`vite build` re-run clean, unchanged). Branch `feat/playstore-stage1-compliance`.
Screenshots are **not captured** — the app is fully behind Google OAuth, so the
script is interactive and the user captures the real shots (user's call).

Plan: `~/.claude/plans/ancient-weaving-raven.md` Part 3 Stage 5. Identity + host
from `docs/_playstore-inputs.md` + the user (`one-on-one-mu.vercel.app`).

What shipped (all under `docs/playstore/`):
- **DATA_SAFETY.md** — transcribe-ready answer sheet. Overview answers (collects
  data: yes; encrypted in transit: yes; deletion offered: yes + the URLs). Per
  data type: Name / Email / User IDs (required), Location (`/location` only,
  one-shot), Messages (encrypted at rest), Photos / Voice / Files / other UGC
  (optional). Everything **Shared = No** (no ads/analytics/brokers). Explicit
  "not collected" list (IP, device IDs, contacts, crash logs…). Notes reconciling
  the form with the privacy policy: the OSM map tile, push previews, WebRTC TURN,
  processors-vs-sharing, report-snapshot retention.
- **CONTENT_RATING.md** — IARC questionnaire answers. No first-party
  violence/sexual/substance/gambling/fear content; **Yes** to user communication
  + location sharing + UGC; connect-by-code only (no discovery); reactive
  moderation. Expected outcome ~Teen/PEGI-12 (normal for messaging) — separate
  from **Target audience = 18+**.
- **STORE_LISTING.md** — app name "One on One" [10], short description [79/80],
  full description [~1500/4000], what's-new [~210/500], graphics table (icon +
  feature graphic from `gen-icons.mjs`; screenshots pending), categorization
  fields. First pass — tone to be polished by the user.
- **REVIEWER_NOTES.md** — App access instructions. Blank demo-account credential
  table for the user to fill; explains the OAuth wall + why two pre-paired
  accounts are needed; first-run gates; the pair-by-Connection-ID steps; feature
  walkthrough; exact menu paths for Block & end / Report [name] / Delete account;
  the four public policy URLs.
- **PUBLISH_CHECKLIST.md** — the ordered "only you can do this" list (A register
  + verify identity → B deploy + browser-verify the web app → C build the AAB via
  the CI workflow → D create app + Play App Signing + the assetlinks fingerprint
  swap → E fill Data Safety / Content Rating / Target audience / Child safety /
  App access / Store listing → F 20 testers × 14 days closed → G production → H
  housekeeping). Records migrations 030/031 as done.
- **screenshots/README.md** — placeholder; the suggested 6-shot set + specs +
  the "real UI only" rule.
- **`scripts/shoot-screenshots.mjs`** (new) — interactive Puppeteer helper
  (headed, 1080×1920): user signs in + drives the UI, terminal keypresses
  capture each screen to `docs/playstore/screenshots/`. Not headless (OAuth) and
  not run this session. `puppeteer` is a suggested one-off `npm i -D`, not added
  to any package.json.
- **ARCHITECTURE.md** — Stage 5 note appended to the PWA / TWA packaging section
  (the Digital Asset Links diagram already lives there from Stage 3).

Notes/deviations:
- Screenshots deferred to the user by their explicit request (OAuth wall). The
  optional web-manifest `screenshots` array is left for after real captures.
- `DATA_SAFETY.md` flags the OSM-tile Location question as a judgement call
  (recommend Shared = No + rely on the privacy-policy disclosure) rather than
  deciding the checkbox for the user.
- Store-listing copy and the IARC answers are a first pass; the user owns final
  wording and the actual questionnaire submission (bucket B in the plan).

---

## [Play Store / TWA] Stage 4 — TWA / Android project — 2026-09-09
Status: done (everything that doesn't need JDK 17 / Android SDK / a live deploy).
Branch `feat/playstore-stage1-compliance` (still stacking). **No AAB built this
session** — this env has JDK 8 only, no Android SDK, and Bubblewrap prompts for a
JDK install on first run. The `.aab` is produced by CI (or a local toolchain) per
`docs/playstore/ANDROID_BUILD.md`. `bubblewrap doctor` / `validate` not run.

Plan: `~/.claude/plans/ancient-weaving-raven.md` Part 3 Stage 4. Vercel prod host
`one-on-one-mu.vercel.app` (from user). Signing: CI-generated upload keystore
(user's choice).

What shipped:
- **`android/twa-manifest.json`** (new) — hand-authored Bubblewrap config (no
  local `bubblewrap init`): `packageId app.web.oneonone`, `host` +
  `fullScopeUrl` `one-on-one-mu.vercel.app`, `name`/`launcherName` "One on One",
  `startUrl /?src=twa`, `display standalone`, `orientation portrait`, all colors
  `#0d1117`, `enableNotifications true` (Chrome push delegation),
  `fallbackType customtabs`, `minSdkVersion 21`, `iconUrl`/`maskableIconUrl` →
  the Stage 3 PNGs, `signingKey` → `./android.keystore` alias `oneonone-upload`,
  `appVersionCode 1` / `appVersionName 1.0.0`, empty `fingerprints`.
- **`android/.gitignore`** (new) — ignores the generated Gradle project
  (`app/`, `build.gradle`, gradle wrapper, `.gradle/`), build output, and **all**
  signing material (`*.keystore` / `*.jks` / `*.pem` / `*.p12` /
  `signing-key-info.txt`). `twa-manifest.json` stays tracked.
- **`.github/workflows/android-build.yml`** (new) — `workflow_dispatch` build on
  `ubuntu-latest`: setup-node 24 + setup-java 17 (Temurin) +
  `android-actions/setup-android` + `npm i -g @bubblewrap/cli`; writes
  `~/.bubblewrap/config.json` pointing at the runner JDK/SDK to skip Bubblewrap's
  installer; keystore step restores from `ANDROID_KEYSTORE_BASE64` or, on the
  first run with no secrets, generates one (`keytool`, random password) + prints
  passwords to the job summary + uploads `android.keystore` as a 1-day artifact;
  `bubblewrap update` regenerates the Gradle project from `twa-manifest.json`;
  `bubblewrap build --skipPwaValidation` with `BUBBLEWRAP_{KEYSTORE,KEY}_PASSWORD`
  env; uploads `app-release-bundle.aab` + `app-release-signed.apk`.
- **`docs/playstore/ANDROID_BUILD.md`** (new) — full runbook: prerequisites
  (Stage 3 must be deployed to `one-on-one-mu.vercel.app` first), twa-manifest
  field rationale, Path A (CI, recommended — the keystore secret dance), Path B
  (local Bubblewrap), the Digital Asset Links fingerprint ordering dance
  (placeholder → first Play upload → copy Play App Signing SHA-256 into
  `assetlinks.json` → redeploy), and the Stage 4 verify checklist.

Notes/deviations:
- **`android/` holds only `twa-manifest.json` + `.gitignore`** — not a full
  Bubblewrap-generated Gradle project. `bubblewrap init` is interactive and
  needs a toolchain this session doesn't have; the config file it would produce
  is authored directly instead, and CI's `bubblewrap update` regenerates the
  rest. If a Bubblewrap version refuses `update` on a bare project, the runbook
  says to `init` once elsewhere and commit the Gradle files.
- **Signing key not created this session.** CI generates the upload keystore on
  its first run (user opted for this over a local `keytool`). Play App Signing
  holds the distribution key.
- **`assetlinks.json` unchanged** — the Stage 3 placeholder is correct until the
  first Play upload yields a real fingerprint (runbook step).
- **`targetSdkVersion` not pinned** in `twa-manifest.json` — Bubblewrap's current
  default applies at build time; the runbook flags verifying it against Play's
  within-one-year rule.
- CI workflow is **unrun / untested** — first-pass. Expect to iterate on the
  `bubblewrap update` vs `init` question and SDK licensing on the real runner.

---

## [Play Store / TWA] Stage 3 — PWA manifest, icons, service worker — 2026-09-09
Status: done. `tsc` + `vite build` clean on client; backend untouched. Branch
`feat/playstore-stage1-compliance` (still stacking — Stages 1 + 2 PRs pending).
**Not live-validated** — `npx @bubblewrap/cli validate` / PWABuilder / Lighthouse
need a deployed manifest URL and a browser, neither available this session; a
validate pass on a preview deploy is owed (same caveat as Stages 1–2). Manifest +
assetlinks JSON-linted and criteria-checked by hand; `offline.html` is static and
was eyeballed, not rendered network-off.

Plan: `~/.claude/plans/ancient-weaving-raven.md` Part 3 Stage 3.

What shipped:
- **`client/public/manifest.webmanifest`** rewritten — `name`/`short_name` "One on
  One", `description`, `id` + `scope` `/`, `start_url` `/?src=twa`, `display`
  standalone, `orientation` portrait, `theme_color`/`background_color` `#0d1117`,
  `categories` `["social","communication"]`, `lang`/`dir`. Icons: 192 + 512
  (`purpose: any`) + 512 maskable.
- **Icons** — `scripts/gen-icons.mjs` (`npm run gen-icons`, sharp, root devDep)
  rasterizes `client/public/icon.svg`: web set → `client/public/icons/`
  (`icon-192`, `icon-512`, `maskable-512` — circles re-centred into the 80% safe
  zone on the dark field); Play listing icon (512, square) + feature graphic
  (1024×500, mark + wordmark) → `docs/playstore/store-assets/`. First-pass
  aesthetic — **flagged for user review** (Part 5 step 5).
- **`client/index.html`** — dropped the three Google Fonts `<link>`s +
  preconnects, added `<link rel="stylesheet" href="/fonts/fonts.css">`; added PNG
  `icon` + `apple-touch-icon` links (kept the SVG favicon for desktop).
- **Self-hosted fonts** — `scripts/vendor-fonts.mjs` fetches the Fraunces (500/
  600) / Figtree (400/500/600/700) / JetBrains Mono (400/500/700) woff2 faces,
  latin + latin-ext subsets, into `client/public/fonts/` and generates
  `fonts.css` (@font-face with the original `unicode-range`s). Removes the
  IP-on-load third party (Stage 0 resolved YES).
- **`client/public/sw.js`** — added `install` (precache `offline.html` +
  `icon-192`/`icon-512`), `activate` (drop stale caches), `fetch` (network-first
  for `mode: navigate`, fall back to cached `offline.html`; everything else
  untouched). Push + notificationclick handlers unchanged except the notification
  `icon`/`badge` moved from `/icon.svg` to `/icons/icon-192.png` (Android
  notifications need a raster).
- **`client/public/offline.html`** (new) — self-contained dark fallback page,
  system-font stack, the two-circle mark, a Retry button.
- **`client/public/.well-known/assetlinks.json`** (new) — `app.web.oneonone`,
  `handle_all_urls`, **placeholder** all-zero SHA-256 + a `_comment` TODO to swap
  in the real Play App Signing fingerprint after first upload. Confirmed copied
  verbatim into `dist/.well-known/` by the Vite build.
- **`client/vercel.json`** (new) — SPA rewrite with a negative-lookahead source
  excluding `/.well-known/`, `/legal/`, `/assets/`, `/fonts/`, `/icons/`;
  `Content-Type: application/json` on `assetlinks.json`; security headers
  (`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS,
  `Permissions-Policy`) + a CSP (`default-src 'self'`; `style-src` adds
  `'unsafe-inline'` for the app's inline styles; `img-src`/`media-src` allow
  `https:` broadly for Google avatars + OSM tiles + Supabase storage;
  `connect-src` allows Supabase + `*.railway.app` wildcards).
- **Node pin** — `.nvmrc` `24` at repo root **and** `client/` (Vercel reads the
  Root-Directory one); `engines` `>=20 <25` in root + `client/package.json`.

Notes/deviations:
- **`vercel.json` lives in `client/`, not the repo root** — the Vercel project's
  Root Directory is `client/` (that's where `package.json` + Vite are, and where
  Stage 2's `/legal/*.html` already serve from). A repo-root `vercel.json` would
  not be read. Same reason the node pin is duplicated into `client/`.
- **Root `package.json` created** (was absent) — holds the `gen-icons` script +
  the `sharp` devDep + `engines`/`.nvmrc`. Not a workspace; `client/` and
  `backend/` stay independent.
- **`screenshots` omitted from the manifest** — real-UI screenshots need headless
  Chrome against a deploy (Stage 5's job, `scripts/shoot-screenshots.mjs`); faking
  them would violate the "real functionality" rule. Add the `screenshots` array in
  Stage 5 once they exist. Not a Bubblewrap blocker.
- **CSP is unverified against a live browser.** `connect-src` uses `*.supabase.co`
  / `*.railway.app` wildcards because the exact backend origin is env-driven and
  not in the repo. Tighten it (and confirm OAuth + sockets + TURN still work) on
  the preview deploy, and again when the custom domain lands.
- CSP `Permissions-Policy` grants `geolocation`/`camera`/`microphone` to `self`
  (the app uses all three via Chrome); revisit if the app is ever iframed.

---

## [Play Store / TWA] Stage 2 — legal & policy pages — 2026-09-09
Status: done. `tsc` + `vite build` clean on client; backend untouched. Branch
`feat/playstore-stage1-compliance` (continues on the Stage 1 branch — Stage 1 PR
still pending, Stage 2 stacks on it). Not runtime-verified on a deploy (no
browser available this session; build-clean + code-reasoned) — a light/dark
render pass on a preview is owed.

Plan: `~/.claude/plans/ancient-weaving-raven.md` Part 3 Stage 2. Identity tokens
from `docs/_playstore-inputs.md`.

What shipped:
- **In-app routes** — `PrivacyPage` / `TermsPage` / `ChildSafetyPage` /
  `DeleteAccountPage` (`client/src/pages/`), each a thin wrapper over
  `legalShared.ts` (constants + `legalShell()` chrome + `wireLegalBack()` + the
  three content bodies). New `Screen` union members `privacy` / `terms` /
  `child-safety` / `delete-account` in `router.ts`.
- **Public mounting** — `main.ts` matches `location.pathname` against
  `LEGAL_ROUTES` *before* the session lookup and `ensureFirstRunGates`, so the
  legal pages render signed-out and never trip the age/consent gate.
- **`DeleteAccountPage`** — checks `getSession()`: signed in → typed-"delete"
  confirm running the same `deleteAccount()` + `signOut()` flow as the in-app
  dialog; signed out → what-happens explainer + "Sign in to delete".
- **Standalone copies** — `client/public/legal/{privacy,terms,child-safety}.html`
  (self-contained, own palette + `prefers-color-scheme`), mirrored from
  `legalShared.ts` for any external link (e.g. the Play Console privacy URL).
  Cross-comment in both directions to keep them in sync.
- **Links** — Login screen footer (`.screen__legal`), the age-gate consent line
  (already pointed at `/terms` + `/privacy` from Stage 1 — now resolves), and a
  new "ABOUT" group in the chat `•••` menu (`MenuDropdown.ts`, opens each in a
  new tab so the conversation stays put).
- **CSS** — `.legal` / `.legal__doc` / `.legal__nav` reading-column layout
  (top-aligned, left-aligned, 680px measure) + `.screen__legal` footer, all on
  existing palette tokens so light/dark flip for free.

Notes/deviations:
- `{{DOMAIN}}` is intentionally left as a literal token in the privacy-policy
  copy (no custom domain yet — the concrete URL is the Vercel deploy). Every
  other identity token is filled.
- No `vercel.json` SPA-rewrite yet (Stage 3) — on the current deploy the SPA
  routes (`/privacy` etc.) rely on Vercel's Vite-preset catch-all; the
  `/legal/*.html` files are real static assets and serve directly regardless.

---

## [Play Store / TWA] Stage 1 — compliance code — 2026-09-09
Status: done. `tsc` + `vite build` clean on client; `tsc` clean on backend.
Branch `feat/playstore-stage1-compliance` off `main`. **Migrations 030 + 031 NOT
applied to the live DB** — same manual `npm run migrate` step as every prior
migration; flagged here so it isn't missed. Not runtime-verified on a deploy yet
(build-clean + code-reasoned) — a two-account preview pass is owed per the plan's
verification list.

Plan: `~/.claude/plans/ancient-weaving-raven.md` Part 3 Stage 1. Approach and
decisions locked in Stage 0 (`docs/_playstore-inputs.md`).

What shipped:
- **1a Block** — `blocks` table (migration 030: directional, permanent, RLS,
  backend-only). `blockService.ts` (`isBlockedBetween` / `addBlock` /
  `listBlocks` / `removeBlock`). `connectionService.requestConnection` rejects a
  blocked pair with the same generic enumeration-safe failure as an unknown
  code; new `blockAndTerminate` (instant end, no 5-step countdown, block written
  first so the safety property holds even if terminate hiccups).
  `POST /api/connections/:id/block`, `GET`/`DELETE /api/me/blocks[/:id]`.
  Client: `features/blockUser.ts` confirm modal, wired into the chat `•••` menu
  and `LeavePage` ("Block & end now").
- **1b Account deletion** — `userService.deleteAccount` → best-effort
  `deleteConnectionAttachments` for the live connection → `supabaseAdmin.auth.
  admin.deleteUser`; FK cascades (migration 017) + `auth.users` cascade
  (migration 001) do the rest. `DELETE /api/me`. Client:
  `features/deleteAccount.ts` typed-confirm ("delete") → call → `signOut()` →
  Login. Reachable from the chat `•••` menu **and** `ConnectionIdPage` (so a
  solo user with no connection can still delete). Public `/delete-account` page
  is Stage 2.
- **1c Report hardening** — migration 031: `message_reports` gains
  `reported_user_id` (nullable, `on delete set null` — moderation evidence
  outlives the account, like `message_id` since migration 018), `category`
  (bucket incl. `child_safety`), and a partial unique index for person-level
  reports. `reportService`: category + `reported_user_id` resolution;
  `getConnectionByMessageId` now also returns `messageSenderId`; new
  `reportConnectionUser` for person-level reports (`message_id` null).
  `POST /api/connections/:id/report`. Client: report modal gains a category
  `<select>` + "Report & block"; chat menu gains "Report message" / "Report
  [name]".
- **1d Moderation** — `backend/src/database/reviewReports.ts` +
  `npm run reports:review` (lists newest-first, decrypts the ciphertext
  snapshot, `--category` / `--limit` flags). `docs/MODERATION.md` — triage SLA,
  actions (delete message row / end connection / ban via auth-user delete),
  CSAM → preserve + NCMEC CyberTipline + child-safety POC.
- **1e Gates & rationale** — `features/ageGate.ts`: neutral DOB `<select>` gate
  (18+, dead-end screen under 18) then a Terms-acceptance checkbox, both stored
  per-device in `localStorage` (`ageVerified` / `termsAcceptedAt`), run from
  `main.ts` before `mountRouter` for any non-login initial screen. The consent
  line links `/terms` + `/privacy` — those routes ship in Stage 2.
  `features/permissionRationale.ts`: a shared pre-prompt modal (mirrors
  `openLocationConfirm`) shown once per kind per session before the browser's
  camera / mic / notification prompt — wired into voice recording, call
  start/accept, and the Notifications toggle.
- **1f EXIF strip** — non-GIF images are re-encoded through a `<canvas>`
  (`reencodeImage` in `ChatPage.ts`) before upload, dropping EXIF/GPS; the
  canvas pass also yields the dimensions. GIFs pass through unstripped (canvas
  would flatten the animation), matching the Stage 0 decision.

Notes/deviations:
- Person-level report is a real row with `message_id` null + `reported_user_id`,
  rather than the plan's "report the most recent message from that user" — same
  moderation signal, no need to hunt for a message.
- `blocks` list in Settings shows date + Unblock only (no name — the per-
  connection nickname is gone once the connection is deleted).
- No new `SettingsPage` screen — account deletion + block live on existing
  surfaces (chat `•••`, `ConnectionIdPage`, `LeavePage`). A dedicated Settings
  screen wasn't needed for Stage 1's scope; revisit if Stage 2's blocks-list UI
  wants a home.

---

## [Play Store / TWA] Stage 0 — inputs — 2026-09-09
Status: done. Inputs only — `.gitignore` + a gitignored scratch doc; no build.
What shipped: `docs/_playstore-inputs.md` (gitignored) recording the Stage 0
inputs for the Google Play / TWA packaging plan
(`~/.claude/plans/ancient-weaving-raven.md`): developer legal name (Ahmed Abdul
Rahman), contact + child-safety email (aarahman803@gmail.com), ToS jurisdiction
(Telangana, India), Android application id (`app.web.oneonone`). Domain is a
**placeholder** — no custom domain bought yet; the existing Vercel deploy URL
stands in, templated as `{{DOMAIN}}` wherever genuinely swappable. Open items
resolved: age gate stays client-side `localStorage` (no DB column), Google Fonts
self-hosted in Stage 3, GIFs pass through EXIF-strip unstripped, `android/` at
repo root.
Notes/deviations: `google-play-requirements-chat-app.md` (repo root) is the
condensed policy reference for every stage.

---

## [Fixes] Reaction spacing, video call-log icon, /alarm sender-cancel — 2026-09-04
Status: done. Both sides type-check clean; client `vite build` passes.
What shipped: (1) Reaction badge now tucks against the bubble's bottom edge
(`.chat__message` split its `gap` into `column-gap`/`row-gap: 0`;
`.chat__reaction-badge` got `margin-top: -3px; padding: 0 10px`) instead of
sitting a full 10px below it — stays a bare emoji (no pill), and stays strictly
below the bubble's own text/timestamp since it lands inside the bubble's
bottom padding, so the earlier absolute-positioning-overlap bug isn't
reintroduced. (2) Video call-log disc: `LOG_VIDEO_PATH`'s transform was
overlapping the direction arrow and clipping the camera's left edge — retuned
the glyph transform and added a video-only arrow offset (`shiftOut()` in
`icons.ts`) so camera and arrow read as two distinct, ungrouped-but-clear
shapes; voice call-log icons untouched. (3) `/alarm`: the raiser can now tap
their own card to cancel a live alarm (previously only the recipient's
Acknowledge could clear it) — reuses the existing reply-linked `{ack:<id>}`
shape with an added `cancelled: true` flag rather than a new payload/message
type, so every consumer that already keys off `payload.ack` (stop sound/
vibration/glow, resume-on-reopen, the raise rate-limit) picks it up for free.
`alarmCard` renders it as "⛔ … cancelled the alarm" instead of "✅ …
acknowledged"; push preview text follows the same split.
Notes/deviations: Two design docs referenced in the request (a reaction
spacing analysis and a call-icon design-feedback doc) were not present in
`Design fixes/` — only the two reaction reference JPEGs were there; the
call-icon diagnosis came from `whatsapp calls/` references + SVG geometry
instead. Not runtime-verified on-device yet (build-clean only) — see plan's
verification section for the manual check list.

---

## [Feature + fixes] /location card, linkify rewrite, call button overflow, call audio — 2026-09-04
Status: done, both sides build clean (`tsc` / `vite build`). Chunk C (call
audio) and Chunk D's live-device Maps behavior are **not runtime-verified** —
user is running the two-device audio test and the phone Directions/View test
separately.

**Bug fixes (root-caused before any code changed, not guessed):**
- **Links and phone numbers weren't clickable** — `linkifyInto` (`utils/linkify.ts`)
  was correctly wired into every text bubble; the regex itself under-matched.
  It required a scheme (`https://`) or literal `www.` for URLs (so
  `example.com`, `github.com/...`, `bit.ly/xyz` rendered as plain text) and a
  leading `+` for phone numbers (so `9876543210`, `(555) 123-4567` didn't
  dial). Rewrote the pattern: an email guard (matched first, left unlinked, so
  `me@example.com`'s domain half never gets peeled off), bare-domain matching
  against a curated TLD list (2-letter cc-TLDs require a path — `t.co/x` links,
  `10.me` alone doesn't), and widened phone matching to cover
  separator-grouped and bare-10-digit local numbers. Also fixed: trailing
  punctuation swallowed into URL hrefs (`https://a.com,` → dead link), and
  `target="_blank"` incorrectly set on `tel:` anchors. 29 cases verified
  against a JS mirror of the exact logic (including a real edge case found
  during testing: `maps.app.goo.gl/abc` was splitting into two broken links
  because "app" is itself a valid TLD — fixed with a negative-lookahead guard
  that lets the regex find the true, longer domain instead).
- **End-call button overflowed the control panel** — pure CSS: 5 controls
  (Speaker/Camera/Flip/Mute/End) at a fixed 62px each plus gaps needed 374px
  in a 294px content box at a 390px viewport (confirmed against the user's
  screenshot). Controls now `flex: 1 1 0; min-width: 0` and buttons scale via
  `min(62px, 100%)` + `aspect-ratio: 1` instead of overflowing.
- **Call audio quality** — honest split. App's fault, fixed: the remote
  `<audio>` element's `.play()` was never called (video path did; audio path
  didn't) — the most likely cause of "voice not coming through," since
  autoplay on a JS-created media element needs an explicit `.play()` call, now
  with a surfaced toast on failure; `onRemoteStream` firing more than once
  (per-track, after an ICE restart) was creating and orphaning a new `<audio>`
  each time — now reused; mic constraints widened from bare `audio: true` to
  explicit `echoCancellation`/`noiseSuppression`/`autoGainControl`. NOT the
  app's fault, documented rather than "fixed": iOS Safari routes call audio to
  the earpiece at reduced volume whenever mic capture is active — no web API
  exists to force the loudspeaker (Android's speaker-toggle gap was already
  documented the same honest way). No SDP munging or codec forcing — neither
  would touch either issue.

**New: `/location` slash command.** A one-shot location snapshot (not live
sharing — no update path), rendered as a keepsake card in the same visual
family as `/checkin`/`/ask`/`/thisorthat`: `client/src/features/location.ts`
(confirm-before-permission-prompt, geolocation capture rounded to 5 decimals,
denial/failure toasts), registered through the same 5 touch points every
message type uses — `slashCommands.ts`, client `Transport.ts`, backend
`messageService.ts` (`validateLocationPayload`, lat/lng/accuracy bounds
checked), migration `029_message_types_location.sql`. Card
(`locationCard` in `ChatPage.ts`) shows a single OSM tile (zoom 15, computed
via the standard slippy-map tile math) behind a pin, held behind an
`IntersectionObserver` so the tile — and the coordinate leak to
tile.openstreetmap.org that comes with it — only fires for a card actually
scrolled into view, plus "Get Directions" / "View" buttons that open Google
Maps (app on mobile where installed, web otherwise).
Notes/deviations: The OSM tile privacy trade — coordinates + both users' IPs
reach a third party on every card view, independent of the at-rest encryption
already on the payload — is a deliberate, user-confirmed choice over a
zero-request stylized card or a Google Static Maps key; recorded in
`docs/DECISIONS-encryption-at-rest.md`. `mediaNoticeFor` in `socketServer.ts`
returns "shared their location" for the push preview, never raw coordinates —
without this a lock-screen push notification would leak exact coordinates,
which was treated as non-negotiable, not a nice-to-have.

## [Review pass] Calling robustness — 4 small fixes — 2026-09-04
Status: done, both sides build clean (`tsc` / `vite build`). Not runtime-verified.
A graph-guided read of the calling subsystem (the recently-changed hub) turned
up four regular fixes, no behaviour redesign:
- **`call:signal` had its own flood-guard bucket added** (`socketServer.ts`).
  The shared guard is 60 events / 10s; WebRTC trickle ICE is one `call:signal`
  per candidate and a peer on VPN + wifi + cellular with an ICE restart or two
  can legitimately emit dozens in the first seconds — enough to trip the guard
  and silently drop candidates mid-setup. `call:signal` now uses a separate
  250 / 10s bucket (`relaySignal` already checks the sender is a participant).
- **`turnService.getIceServers()` caches the minted set for 30s.** It runs on
  every `call:invite` *and* `call:accept`, so a plain call hit Cloudflare twice
  from a latency-sensitive path; a credential served at the end of the 30s
  window still has 90s of validity (TTL 120s), ample for ICE gathering.
- **`wakeLock.ts` guards the end-during-request race.** A call ending while
  `navigator.wakeLock.request()` was still in flight left an orphaned lock that
  never released — screen stays awake. A `wanted` flag now releases a
  late-resolving sentinel.
- **`CallSession.switchCamera()` hands the preview a fresh `MediaStream`.**
  Mutating the existing stream in place and re-assigning it to
  `<video>.srcObject` is a no-op in some browsers, so the local preview kept
  showing the old camera after a front/back flip. The far side was always fine
  (`replaceTrack`).

## [Feature] Batch 7 — video calling — 2026-09-04
Status: done, client builds clean (`tsc` / `vite build`). **Not runtime-verified**
— needs a two-account, two-device pass (video both directions, camera toggle
mid-call, flip, audio-only calls unaffected).
Client-only — no schema, no backend change. `kind: 'video'` was already
threaded through `call:invite` → `CallRecord` → `writeCallLog` →
`notifyMissedCall` in the audio batches; the call-log card already rendered
`kind === 'video'` (noun + directional camera glyphs). So Batch 7 is purely
the call UI + media layer.
What shipped (7 files, client):
- **`features/call/media.ts`** — `acquireLocalStream(kind, facing)` now takes a
  `CameraFacing` ('user' | 'environment'); video constraints are
  `{ audio, video: { facingMode } }` (plain, not `exact`, so a single-camera
  laptop still gets a stream). New `hasMultipleCameras()` (enumerateDevices)
  gates the Flip button.
- **`features/call/session.ts`** — `CallSession` takes `kind`; acquires video
  for `'video'` calls and fires `onLocalStream` (once on start, again after a
  flip). `setCameraEnabled()` = `videoTrack.enabled` — **no renegotiation**, so
  audio is never touched. `switchCamera()` = fresh `getUserMedia` +
  `RTCRtpSender.replaceTrack` — also renegotiation-free.
- **`features/call/wakeLock.ts`** (new) — `screen` wake lock for the life of a
  video call; no-op where unsupported (iOS Safari). Re-acquired on
  `visibilitychange` (OS drops it when the tab hides).
- **`features/call/controller.ts`** — header video button enabled +
  `startVideoCall`; `CallBarHandle` gains `startVideoCall()`. Full-screen
  surface gains a full-bleed remote `<video>` (painted only once frames arrive
  — `.call-screen--remote-live`, avatar shows until then) and a draggable,
  mirrored local-preview `<video>`. In-call controls add Camera (on/off) and
  Flip (when >1 camera) for video calls. Incoming screen shows "Incoming video
  call". Audio-call path is byte-for-byte unchanged (`<audio>` element, avatar
  layout, no `--video` class).
- **`features/call/icons.ts`** — `CALL_CAM_ICON` / `CALL_CAM_OFF_ICON` /
  `CALL_FLIP_CAM_ICON`; dropped the "not built yet" note on `CALL_VIDEO_ICON`.
- **`styles/global.css`** — `.call-screen--video` block: remote `object-fit:
  cover` fill, local PiP tile (safe-area anchored, `translate` vars for drag),
  name/status/controls lifted above the video with a text scrim, a landscape
  (`max-height: 500px`) rule that shrinks the controls panel.
- **`pages/ChatPage.ts`** — missed-**video**-call row redials with
  `startVideoCall()` instead of always audio.
Notes/deviations: camera toggle is `track.enabled` (peer sees a frozen/black
frame), not track-remove + renegotiate — simplest thing that keeps audio
alive, which is the batch's verify criterion. Speaker button (desktop
`setSinkId` only) now targets the remote `<video>` for video calls. Pre-existing
dead CSS noticed, not touched: `.chat__call-btn:disabled` has no live call site
now that the video button ships enabled.

## [Bug fixes] /alarm sound persistence + /thisorthat pick labels — 2026-09-04
Status: done, client builds clean (`tsc` / `vite build`). Not runtime-verified
by the author — user is merging the PR and testing it themselves.
What shipped:
- **`/thisorthat` reveal showed swapped names.** The revealed card is the
  *recipient's* reply message, so `message.senderId` is `pickRecipient`'s, not
  `pickSender`'s — but `thisorthatCard` derived both names from that one id
  (`isMine ? 'You' : otherName` for the sender, the inverse for the recipient),
  so every revealed card attributed each pick to the wrong person on both
  screens. Fixed to resolve the poll author from the original message it
  replies to (`messagesById.get(message.replyTo)`), exactly as `askCard`
  already does; `recipientName` stays `isMine ? 'You' : otherName` (the reply's
  own sender). `client/src/pages/ChatPage.ts` only.
- **`/alarm` siren cut out / felt inconsistent.** Not a looping bug —
  `audio.loop = true` + one `play()` loops natively and reliably. Root cause:
  the "hybrid clear" silenced the sound whenever the chat was visible/focused,
  so `focusHandler` and every 4s `poll()` tick called `alarmController.stopSound()`
  — a raise that arrived while you were on the tab (or right as a backgrounded
  tab woke) got ~0–4s of siren then silence, never restarting. Removed both
  `stopSound()` call sites; sound + vibration now run until the recipient taps
  Acknowledge or the 2min no-ack auto-clear (`stopAll`), matching the glow.
  `stopSound` is no longer part of the `AlarmController` public interface
  (still used internally by `stopAll`). `client/src/features/alarm.ts` +
  `ChatPage.ts`.
- **Delayed delivery** to a backgrounded/locked recipient is the same
  web-platform limit documented in the 2026-09-02 entry (hidden-tab timer/audio
  throttling, possible WebSocket drop) — no code bug in the foreground path
  (socket → `onIncoming` → `start()` is immediate). The `stopSound` removal
  does help the *perceived* case where a woken tab killed the siren 4s in.
Notes/deviations: no schema change, backend untouched.

## [Feature] Call polish — WhatsApp-style call log, unreachable calls, in-call screen — 2026-09-04
Status: done, client + backend build clean (`tsc` / `vite build`).
**Runtime-verified by static render only** — a 12-cell theme-matrix screenshot
(bubbles/line × light/dark × no-wallpaper/love/samurai); a real two-account,
two-device pass is still owed. No schema change (the new `call` outcome is a
payload value, migration 028's `messages_type_chk` already allows `type='call'`).
What shipped:
- **Call-log rows are now real chat bubbles.** `callLogRow` (a bare centered
  `.chat__call-log` div that bypassed the message pipeline) is replaced by
  `callLogCard`, plugged into `buildMessageRow`'s content chain like
  `voiceBubble`/`fileCard`. So it now gets left/right alignment from
  `[data-mine]` (caller = mine = right) and a wallpaper-correct surface from
  `--bubble-*-bg` for free. DOM mirrors `.file-card`: `.call-log` → disc +
  title + subtitle ("Voice call" / "2 min"; "Missed voice call" / "Tap to
  call back"). Directional glyphs (`CALL_LOG_{OUT,IN,VIDEO_OUT,VIDEO_IN}_ICON`
  — handset/camera + ↗/↙ arrow) replace the single `CALL_LOG_ICON`.
- **Colour rule (see the `.call-log` CSS comment):** the card paints **no new
  token** — only `--bubble-*` (the four properties every wallpaper re-tunes)
  and translucent scrims. The missed-call red is the one `var(--danger)` use,
  and it's structurally safe: a "Missed" card only ever renders on the
  *callee's* side, where the call is not-mine → `--bubble-other-bg`, which is
  never a red surface in any wallpaper. The caller's side reads "No answer" /
  "Not answered" and keeps `currentColor`. The whole-bubble red tint (old
  `--missed` rule) is gone — it fought the Samurai/Love art.
- **Line mode:** a self-contained bordered row on `--bg-raised` with a
  bordered disc — same fixed-surface tradeoff the keepsake cards already make
  in line mode.
- **"Tap to call back":** missed/unreachable rows are `role="button"` and
  redial via `callBar.startAudioCall()`. `mountCallBar` now returns
  `{ dispose, startAudioCall }` (`CallBarHandle`) instead of a bare disposer;
  `callBtn.onclick` and the row share the one `startAudioCall` path, so the
  `callingSupported()` gate, 5s invite cooldown and call-screen error
  handling aren't duplicated.
- **Unreachable calls leave a trace.** New `CallOutcome` value `'unreachable'`
  (added to `callService.CallOutcome` + `messageService.CALL_OUTCOMES`; a
  missing whitelist entry would have made `validateCallPayload` reject the row
  and only `console.error` it). When `inviteCall` finds the callee has **no
  live socket at all** (app fully closed), it now writes an `'unreachable'`
  call row (both sides) and fires the missed-call push **before** throwing —
  the caller previously just got a bare "peer is not reachable" toast and no
  history. The row-write + broadcast was factored out of `resolveCall` into a
  shared `writeCallLog` helper; `notifyMissedCall` now takes plain ids so the
  no-`CallRecord` path can reuse it.
- **`forceEndCall` no longer pushes.** `connectionService.terminate()` →
  `forceEndCall` was writing a `'cancelled'` row **and** pushing "Missed
  call" to someone whose connection (and that very row) was about to be
  deleted. `resolveCall` gained a `notify` param; `forceEndCall` passes
  `false`.
- **In-call screen** nudged toward the WhatsApp reference (`whatsapp call
  examples/IMG_1002.png`): larger avatar (`min(168px, 44vw)`), the control
  card now an anchored full-width-capped panel (`:not(:empty)`, so nothing
  renders at idle) with more breathing room, slightly larger control
  buttons + a hover transition. Structure, `controlBtn` and the
  `renderControls` state map (Speaker where `setSinkId` exists / Mute / End)
  are unchanged — no dead buttons, no minimize affordance (deferred).
Notes/deviations:
- Minimize / "return to call" bar was in the plan as optional and is **not**
  built — a follow-up if wanted.
- `issue/unnamed.jpg` (deployed chat showing the idle call surface) was
  already fixed on `main` (the global `[hidden]{display:none!important}` from
  PR #49); the screenshot was a stale deploy. Not touched.
- Video calling is plan Batch 7 — shipped 2026-09-04, see the entry above.

## [Feature] Audio calling — batches 1–6 (signaling → plumbing → UI → history → hardening → docs) — 2026-09-04
Status: audio calling shipped. Batches 1–5 merged to `main` across PRs #46
(signaling backbone), #47 (client plumbing + minimal call), #48 (real call
screen + SVG icon + reconnect + call history), #49 (call-screen overlay
bugfix), #50 (header call-button placement + video-button placeholder), #51
(hardening). Migration 028 applied to the live DB 2026-09-03 (`'call'`
accepted by `messages_type_chk`). This batch 6 entry is documentation only —
no code. `tsc`/`vite build` clean on both sides through every prior batch;
**runtime-verified only in part** (see Notes).

**Overrides spec §29** (calls listed as a V1 non-goal alongside groups,
media, stories). Same kind of deliberate, user-confirmed override as emoji
reactions, `/letter`, and image/voice/file media — approving the calling
plan was that sign-off. Recorded here and in `docs/ARCHITECTURE.md` next to
those precedents so it never reads as scope creep. Plan:
`~/.claude/plans/query-existing-graph-signaling-socket-adaptive-wren.md`.

What shipped (batches 1–5):
- **Batch 1 — signaling backbone (backend).** `services/callService.ts`: an
  in-memory `activeCalls` Map keyed by connection id (in-memory only, like
  `lastAlarmRaiseAt` — a dropped call just ends, nothing survives a
  restart), server-issued UUID `callId`s, one active call per connection
  (a second invite gets 409), server-owned 45s ring timer that resolves a
  silent call to `missed`, `inviteAllowed()` per-user invite cooldown plus
  the existing `withinRateLimit()` socket flood guard. Every socket handler
  re-resolves the caller's live connection via `getLiveConnectionForUser()`
  — a client never names its peer, connection, or role. `services/turnService.ts`
  + `GET /api/turn-credentials` (auth-only; see Notes) mints short-TTL
  Cloudflare Realtime TURN credentials, degrading to STUN-only with a
  warning when `TURN_KEY_ID` / `TURN_API_TOKEN` are unset. Eight socket
  events wired in `socketServer.ts`: `call:invite` / `call:incoming` /
  `call:accept` / `call:accepted` / `call:decline` / `call:signal` (relayed
  opaquely, never parsed, stored, or logged) / `call:end` / `call:ended`.
- **Batch 2 — client plumbing + minimal audio call.**
  `services/transport/CallTransport.ts` (interface) +
  `InternetCallTransport.ts` (Socket.IO impl), reached only through
  `messageService.getCallTransport()` — components never touch Socket.IO
  (spec §22), same rule the message `Transport` follows.
  `features/call/session.ts` (`CallSession` — `RTCPeerConnection` lifecycle,
  offer/answer, trickle ICE), `features/call/media.ts` (the single
  `getUserMedia` chokepoint + `callingSupported()` capability/secure-context
  check — kept in one module so a native permission bridge is a one-file
  change later, per the Android notes).
- **Batch 3 — audio call UI.** `features/call/controller.ts` (`mountCallBar`)
  + `features/call/icons.ts` (inline SVG). Header phone + video buttons in
  `.chat__nav-actions`, immediately left of the ••• menu (WhatsApp order);
  video button rendered but `disabled` until the video batch. Full-screen
  call surface appended to `document.body` (torn down via `ChatPage`'s
  existing disposer list on route change). Mute, speaker (feature-detected
  via `setSinkId` — hidden on Android where the web platform gives no
  earpiece/speaker control, rather than lying), end, live call timer,
  incoming-call ringtone + vibration. Playback starts inside the Accept tap
  handler (autoplay policy). Styling via `.call__*` in `global.css` reusing
  the existing custom properties so wallpapers/themes keep working.
- **Batch 4 — call history.** Migration `028_message_types_call.sql` widens
  `messages_type_chk` to add `'call'` (idempotent drop-and-recreate, like
  024/025/027). Call rows are **server-authored only** — written exclusively
  by `callService.resolveCall()` at every resolution path, through the
  normal `saveMessage()` so `content` (empty) and `payload`
  (`{ kind, outcome, durationSec }`) get the same AES-256-GCM encryption at
  rest as every other message. `saveMessage`'s empty-content allowance was
  extended to `'call'` beside `'alarm'`. `message:send` explicitly rejects a
  client-sent `type: 'call'` (`{ error: 'call messages are server-authored' }`)
  so history can't be forged. `senderId` is always the caller; the client
  renders incoming/outgoing framing by comparing to its own user id.
  Rendered by `callLogRow()` in `ChatPage.ts` as a centered row
  (`.chat__call-log`, `--missed` tint), excluded from reactions and replies
  (`row.dataset.type === 'call'` guards). Exports/search treat it as any
  other message.
- **Batch 5 — hardening.** ICE restart on `connectionState`
  `failed`/`disconnected` (`attemptIceRestart`, offerer side) with a
  `reconnecting` UI state and a give-up timer; `getRingingCallForCallee()`
  re-emits `call:incoming` to any socket that (re)connects mid-ring so a
  network blip doesn't swallow the call; `forceEndCall()` invoked from
  `connectionService.terminate()` (via a `setIo()` `ioRef` bridge, since
  that path is outside the socket layer) so a connection deleted or a leave
  completed mid-call tears the call down and logs it; `callingSupported()`
  gates call initiation on WebRTC + secure context; `onError` handler on
  `CallSession` surfaces setup failures instead of an unhandled rejection;
  `NotAllowedError` / `NotFoundError` mapped to "Microphone access was
  denied" / "No microphone found". Missed-call web push (`notifyMissedCall`)
  fires on ring-timeout and caller-cancel, reusing the existing VAPID setup.
- **Batch 6 — this entry + `docs/ARCHITECTURE.md` signaling diagram + §29
  note.** Audio calling is documented and closed.

**Setup done on the user's side:** Cloudflare account + TURN key created;
`TURN_KEY_ID` / `TURN_API_TOKEN` set on Railway; migration 028 applied.

Notes/deviations:
- **Unreachable-peer path does not match the plan — known gap, being fixed
  in the follow-on call-polish batch.** The plan's signaling diagram had
  "callee has no live socket → ack unavailable **+ write a missed-call row +
  web push**". As shipped, `inviteCall` throws `409 'peer is not reachable
  right now'` — the caller sees a toast, but **no chat row and no push**.
  `notifyMissedCall` only covers the callee-was-online-but-didn't-answer
  case. So calling someone whose app is fully closed currently leaves no
  trace. The next batch adds the "you tried to call — unreachable" chat row
  (+ push) and reworks the call-log rows to WhatsApp's left/right-bubble
  style (icon disc + "Voice call · 0:33" / "Missed voice call · Tap to call
  back") instead of the current centered system row — reference images in
  `whatsapp calls/` and `whatsapp call examples/`.
- **`GET /api/turn-credentials` is currently unused.** `iceServers` are
  delivered in the `call:invite` / `call:accept` socket acks instead; the
  REST route is mounted and working but no client calls it. It's auth-only,
  not membership-checked (deliberate — the credentials grant Cloudflare
  relay access only, not any connection's data). Keep or drop it in the
  next batch.
- **No "on a call" status line.** The plan mentioned the chat status line
  showing "on a call" while one is active; not implemented.
- **File layout drift from the plan:** `features/call/controller.ts` +
  `features/call/icons.ts` rather than the planned `features/call/ui.ts`
  with icons inline in `ChatPage.ts`. No behavioural difference.
- **Runtime verification is partial.** Trust-boundary probes and the
  signaling round-trips were exercised with scratch socket clients; a full
  two-device audio call across networks (and `chrome://webrtc-internals`
  confirmation of a P2P vs `relay` candidate pair) still needs a real
  two-account, two-device pass on the deployed URL — `getUserMedia` over a
  LAN IP silently fails, so this can't be a `localhost` test.
- The screenshot in `issue/unnamed.jpg` (deployed app, "ARFAH" chat
  rendering empty with no header call buttons) is unexplained — folded into
  the next batch's investigation.

## [UI fixes + polish pass] Pending-bubble darken, account-switch gate, screen-by-screen consistency — 2026-09-03
Status: items 1-2 done, PR #44 merged to `main` (2 commits). Item 3 (polish,
3 batches) code complete on PR #45, open pending merge (3 commits, includes a
merge-conflict resolution against #44 — both touched `LoginPage.ts`).
`tsc`/`vite build` (client) clean after every batch. No schema changes, no
migrations, client-only across all 5 pieces.
What shipped:
- **Pending-message bubble darken (bugfix).** `.chat__message--pending`
  applied `opacity: 0.5` to the whole optimistic-send row; against the app's
  dark chat log a half-opacity saturated bubble reads as a *darker* shade,
  then snaps (not fades — `opacity` wasn't in the row's `transition` list)
  back to full color the instant the server confirms and the class is
  removed. Removed the rule outright — it was global, not per-theme, so the
  fix covers the default palette and every wallpaper (light/Love/Samurai) in
  one edit. The receipt-tick's own separate pending dim (a legitimate "still
  sending" signal) is untouched.
- **"Use a different account" gating (bugfix).** The login screen's
  account-switch link (`LoginPage.ts`) rendered unconditionally, including
  for a device that had never logged in. Login only ever renders when
  there's no live session, so "already logged in" can't gate it directly —
  instead a `hasSignedInBefore` flag is set in `localStorage` once
  `resolveInitialScreen()` confirms a session (`main.ts`), and the link now
  only renders when that flag is present. New device: hidden. Returning
  device (e.g. after sign-out): shown.
- **Batch 3 — focus/hover states (a11y).** No element in the app had a
  keyboard focus indicator. One global `:focus-visible` rule (2px
  accent-other outline) now covers every button, `.menu__item`, and the
  appearance/mood/pick option groups. `.chat__menu-btn` (nav •••),
  `.chat__reply-bar-cancel`, and `.modal-close` were transparent/borderless,
  so the shared `button:hover{border-color}` rule was a no-op on them — each
  now gets a real hover background tinted against its actual surrounding bg.
- **Batch 4 — copy & loaders.** New `utils/loadingScreen.ts`
  (`loadingScreenHtml`) replaces 5 duplicated plain-text "Loading..."
  skeletons (Nickname, Chat, ConnectionRequest, Export, Leave) with one
  shared spinner + "Loading…" markup, reusing the existing `chat-icon-spin`
  keyframe via a new `.screen__spinner` class. Normalized stray ASCII `...`
  to the real `…` already used elsewhere (chat composer placeholder,
  connection-id loading subtitle). `ConnectPage`'s title was just restating
  its own eyebrow ("Connection ID" under "CONNECT") with no instruction;
  changed to "Enter their connection ID" to match the instruction/question
  voice `NicknamePage`/`LeavePage` already use. Login's lowercase tagline
  ("one connection. nothing else.") is a deliberate brand voice and was left
  alone.
- **Batch 5 — layout & dedupe.** New `.screen__error` class replaces the
  same inline `style="color: var(--danger); display: none;"` duplicated
  across 5 pages (Login, Connect, Nickname, ConnectionRequest, Leave).
  `.screen__actions` had a redundant `margin-top: 8px` stacking on top of
  the parent `.screen`'s own flex `gap: 20px` — invisible with one actions
  block, but `ConnectionIdPage` stacks three of them and the doubled gap
  read as uneven; removed the redundant margin (the fix applies everywhere
  the class is used, not just that screen). Removed an inline
  `font-size: 24px` override on `ConnectionRequestPage`'s code chip so it
  matches `ConnectionIdPage`'s. The chat nav status dot showed green
  ("online") while its text still said "connecting…" — added a neutral
  `--connecting` dot state, cleared the moment the first real presence check
  lands.
Notes/deviations: verification for all 5 pieces was build-only (`tsc`/`vite
build` clean) plus code-level reasoning about each CSS/JS mechanism — **not
a live click-through**, since the app's only auth path is real Google OAuth
against this project's own Supabase, which isn't something to drive
unattended. Worth a real device/browser pass before considering this fully
closed, same caveat several of the earlier UX-smoothness-pass batches
carried. Planned in `~/.claude/plans/planning-phase-first-vast-bachman.md`.

## [Performance] Message/image delivery speed — 2026-09-03
Status: done. PR #42 merged to `main` (3 commits). No schema changes —
runtime-only across all 3 chunks. `tsc`/`vite build` (client) and
`tsc --noEmit` (backend) clean after every chunk.
What shipped:
- **Chunk 1** (backend hot path): the sender's `last_read_at` bump was
  awaited inside `saveMessage` before it returned, gating the broadcast on a
  DB write that has nothing to do with delivery — split out into
  `bumpSenderLastRead`, fired fire-and-forget after the broadcast (same
  pattern as the existing `syncDelivery` push). `saveMessage` confirmed to
  have exactly one caller before moving it. Image/voice/file messages now
  get their signed display URL attached to the *same* `message:new`
  broadcast via a server-side `signAttachments()` call, best-effort with a
  fallback to the client's own fetch on failure.
- **Chunk 2** (sender-side image): `readImageDimensions` (local) and
  `uploadAttachment` now run concurrently instead of sequentially. The image
  row renders immediately at its real final size from a local object URL
  over the picked file, before the upload even finishes — the sender never
  waits on their own upload + a signed-URL round-trip to see what they just
  sent. The optimistic row only enters the retry-tracked `pending` queue
  once the upload actually resolves with a real payload (pushing it earlier
  would let a poll/reconnect's `flushPending()` fire a send with no path
  yet). A failed upload now shows the failed photo in place instead of
  vanishing behind a toast.
- **Chunk 3** (recipient-side image, "blank box that pops in" fix): a
  `min-height` fallback reserves space for legacy messages sent before
  dimensions were captured (previously collapsed to 0 height until decode).
  A spinner (reusing the existing composer spinner arc) overlays the
  reserved box and is removed on load/error; the `<img>` fades in via
  opacity instead of popping in. `imageBubble` now prefers `payload.url`
  (signed at broadcast, chunk 1) before falling back to its own
  `hydrateMedia` signed-URL fetch — the recipient of a live image no longer
  makes a follow-up request just to render it. `hydrateMedia` remains the
  fallback for history/legacy messages that predate chunk 1.
Notes/deviations: Text sends were already fully optimistic before this batch
(local render before server round-trip) — investigation found the real
latency was server-side (one avoidable DB write gating every send) and in
the image pipeline specifically (sender waiting on its own upload, recipient
making a second round-trip for a signed URL, no reserved size/loading state).
Both are addressed above; text-send behavior is unchanged.

## [Emergency] /alarm command — 2026-09-02
Status: done. PR #40 merged to `main` (3 commits: message type/validation/push
plumbing, controller + confirm dialog + slash wiring, renderer + live
trigger + glow + ack flow). Migration 027 applied to the live DB.
What shipped: dedicated `alarm` message type (raise = empty payload; an
acknowledgement is a separate reply-linked alarm message with `{ack:<id>}` —
same raise/reply shape as `/ask` and `/thisorthat`, no message-mutation path).
Confirm-before-send dialog; per-user 3min cooldown on raises (acks exempt).
In-app alert while the tab is open: looping synthesized siren
(`client/public/alarm.wav`) + repeating `navigator.vibrate` + a pulsing red
inset glow on the chat screen (`.chat--alarm`). Hybrid clear: focusing/
opening the chat stops the sound/vibration; the glow persists until the
recipient taps Acknowledge or a 2min no-ack auto-clear. Reopening the chat
with the most recent alarm-type message still an unacknowledged raise resumes
the glow (and sound, if it's the other side's). Push fallback for a closed/
backgrounded app sets `requireInteraction`+`vibrate`+`renotify` on Android via
an `urgent` flag threaded through `syncDelivery` → `PushPayload` → `sw.js`.
Notes/deviations: **No platform lets a PWA bypass OS Do Not Disturb** —
`urgent` push is still an ordinary, OS-mediated notification. **iOS PWA push
ignores `vibrate` and cannot play a custom sound at all** (same restriction as
the pre-existing iOS notification-parity gap above); Android push vibration
is OS-driven from the notification's `vibrate` option, not app JS. **The
custom alarm sound is reliable only while the tab is open and foregrounded —
confirmed, not fixable within web-platform limits.** Investigated a report of
the sound "sometimes" not playing when the recipient's phone was
backgrounded/locked: root cause is mobile browsers throttling or fully
suspending a hidden tab's timers/audio and potentially dropping its WebSocket
during that window, combined with autoplay engagement policy — none of which
a web page can query or override, and none of which affects vibration/glow
(vibration felt while backgrounded is the OS-driven push `vibrate`, not the
in-page controller; the glow is only ever seen once the app is reopened,
whether via the live socket path or the history-resume-on-load scan). No
code fix exists for this; `audio.play()` rejections are now logged
(`console.warn`) so a future *regression* stays distinguishable from this
expected inconsistency. This was investigated via code/platform-behavior
analysis, not reproduced on a physical backgrounded device.

## [Security] Message encryption at rest (Option C) — 2026-09-02
Status: code complete on branch `feat/message-encryption-at-rest` (4 commits);
all `tsc` clean, crypto/wiring/backfill logic verified with throwaway scripts.
**Live steps pending (user-owned):** manual two-account Chunk 3 pass → deploy →
backfill dry-run → `--apply`. PR held until the backfill is confirmed clean.
What shipped (application-layer AES-256-GCM, key only in backend env — full
rationale in `docs/DECISIONS-encryption-at-rest.md`):
- **Chunk 1** migration 026 — drops the plaintext `char_length(content)` check
  so `content` can hold ciphertext; `content`/`payload` column types unchanged.
  Applied + verified on the live DB.
- **Chunk 2** `backend/src/services/crypto.ts` — `encrypt`/`decrypt`/
  `isEncrypted`, envelope `v{N}:base64(iv|tag|ct)`, version-tagged for rotation
  (highest `ENCRYPTION_KEY_V<n>` = write key), GCM tamper detection, fails fast
  if unconfigured. Documented in `.env.example`.
- **Chunk 3** wiring — `saveMessage` encrypts `content` + `payload` (jsonb
  `{enc}`) on write and returns the in-memory plaintext `Message`, so socket
  broadcast + push preview are unchanged; `getHistory` decrypts on read with
  legacy-plaintext passthrough. `reportService` snapshot stores ciphertext
  verbatim (decrypt-on-review), no logic change.
- **Chunk 4** `backend/src/database/backfillEncryption.ts` (`npm run
  backfill:encrypt`) — one-off, dry-run by default, `--apply` to write,
  idempotent; covers `messages` + `message_reports` snapshots.
Notes/deviations: Protects a DB leak (logical dump / stolen service-role key /
backup), NOT a full backend compromise — same trust boundary as before, strictly
more protection; **not E2EE, don't overclaim**. Backend-reads-plaintext model
preserved (spec §20) — every membership/live/reply-target/media-path check is
unchanged. Two documented, accepted plaintext gaps: **push previews**
(`mediaNoticeFor` sends up to 120 chars of a text message post-decrypt) and
**attachment bytes** (Storage disk-at-rest only; app-layer would break
signed-URL delivery — only attachment *metadata* in `payload` is encrypted).
Rotation constraint: never destroy a key version while a report snapshot still
references it. A subtle "encrypted at rest" UI indicator is proposed separately,
held for sign-off.

## [UI/UX fixes batch] Dark theme, viewport zoom, footer regression, send button, logout, /thisorthat — 2026-09-01
Status: code complete; client (`tsc`/`vite build`) and backend (`tsc`) both
build clean. Migration 025 written but **not yet applied to the live DB**
(this batch adds no auto-migrate hook — same manual step as 024). Several
items are visually inspectable directly; two are flagged below for a manual
mobile/two-account pass (Chrome extension unavailable this session).
What shipped, in commit order:
- **Dark-theme CSS fixes** — added a global `textarea{}` rule mirroring the
  existing `input{}` one (fixed white background on the `/checkin` note and
  `/ask` answer fields — both are textareas, which had no dark rule of their
  own). `.chat__reaction-badge` background → `transparent` (was
  `var(--bg-raised)`, read as solid black). `.chat--bubbles
  .chat__receipt--seen` → `var(--accent-you)` (light green) — **scoped to the
  plain text/voice/file bubble only**; the image-overlay tick and Love-
  wallpaper tick keep their own already-correct colors for their own
  (non-blue) backgrounds, left untouched. `.voice-bubble__play` gets
  `padding: 0` (was inheriting the base button's `10px 18px`, forcing an
  oval) and its `▶`/`⏸` text glyphs became small centered inline SVGs.
- **Mobile zoom-on-focus fix** — `.checkin-compose__note` and
  `.ask-compose__answer` set `font-size: 14px` outside the existing
  `@media(max-width:480px)` zoom-prevention rule, later in source order, so
  equal-specificity tie-breaking always favored the 14px rule. Added
  compound-class selectors (`.msg-compose__field.checkin-compose__note` /
  `.msg-compose__field.ask-compose__answer`, matching the real two-class DOM)
  inside that media rule for guaranteed higher specificity — same fix
  already applied once for `.chat__input-bar textarea`.
- **Bubble footer regression fix** — `.chat__bubble-time` is `display: none`
  at the base (line mode has its own left-column clock); the `.chat--bubbles`
  override only set color/size and never restored `display`, so the
  per-bubble timestamp never rendered. Separately, the previous batch's
  float-based footer (`.chat__meta` floated right *inside*
  `.chat__message-text`, which is `display: inline`) escaped to the top of
  the nearest block ancestor instead of hugging the last line, since a float
  inside an inline box isn't contained by it. Fixed by restoring `display:
  inline` on `.chat__bubble-time` and replacing the float with `display:
  inline-flex` on `.chat__meta` for text bubbles, so it flows as a trailing
  inline unit and wraps with the last line naturally. Card types never used
  the float path and are unaffected.
- **Send button redesign** — replaced the spark/comet glyph (read as a
  comment icon) with a filled paper-plane SVG. Added a "launch" animation
  synced to the message actually sending: `triggerSendAnimation()` fires
  from `send()` right after the empty-content guard (never on an empty
  submit or the slash-command branch), toggling a `--launch` class with a
  forced reflow so rapid sends restart it cleanly; the icon flies out and
  fades, then a fresh one drops back in, respecting
  `prefers-reduced-motion`. The existing `:active` press-nudge is untouched
  (separate, instant tap feedback).
- **Removed chat-screen logout** — the app's model is block-based, not
  logout-based. Removed the "Log out" item from the chat `•••` menu
  (`MenuDropdown`), its handler, the `onLogout` param, and the now-orphaned
  `signOut` wiring/import from `ChatPage.ts`. The `ConnectionIdPage` (home
  screen) logout is a separate button and is untouched.
- **`/daily` replaced with `/thisorthat`.** `/daily`'s once-a-day plain-text
  prompt insert didn't meet the bar the other three slash commands hit (no
  card, no type, no lasting interaction) — removed along with its 12-prompt
  bank and the `insert()` helper it was the last user of. Added
  **`/thisorthat`**: a new keepsake-card type following the `/ask` sealed-
  reveal pattern exactly — `features/thisorthat.ts` (composer + answer
  modal), `thisorthatCard` in `ChatPage.ts`, `.thisorthat-card` /
  `.thisorthat-pick-opt` CSS (own gradient, unflattened in bubble mode).
  Sender writes two options and picks their own favorite in one step
  (sealed); recipient taps one of the two options (no free text — the
  format's whole point is a single tap) and both picks reveal side by side.
  Payload `{optionA, optionB, pickSender, pickRecipient?}`; sent as two
  ordinary reply-linked messages, same no-new-live-update-path approach as
  ask. Migration 025 widens `messages_type_chk` to add `'thisorthat'`.
Notes/deviations: **migration 025 still needs manual application** to the
live DB (same as 024) before `/thisorthat` can actually insert — code paths
are in place and typecheck clean either way. **Two items need a manual
mobile/two-account check**, not just build verification: the zoom-on-focus
fix (needs an actual phone/emulator) and the bubble footer fix (novel
layout, worth eyes-on beyond the CSS reasoning) — flagged to the user rather
than assumed working from build success alone.

---

## [Slash commands refresh, batches 4-6] /countdown, /checkin, /ask — 2026-09-01
Status: code complete, both projects build clean (`tsc`/`vite build`); pending
manual two-account walkthrough (migration 024 already applied to the live DB
per PR #36).
What shipped — three new compose modules mirroring `letters.ts`'s split
(feature module owns compose/answer UI, `ChatPage.ts` owns the inline card),
each slotted in via the confirmed 5-step pattern (`SlashContext` field +
`COMMANDS` entry, feature module, `slashCtx` callback + card builder + dispatch
branch):
- **`/countdown`** — `features/countdown.ts`. One-step compose (label +
  datetime-local, no letter-style write/preview split needed for structured
  data). `countdownCard` in `ChatPage.ts` runs a live `setInterval` ticker that
  self-clears the first time it finds its own card detached from the DOM,
  rather than needing new page-level teardown tracking.
- **`/checkin`** — `features/checkin.ts`. Mood picker (5-point scale) + a short
  note; the picker is the "permission-giver" that makes the honest line easier
  to send.
- **`/ask`** — `features/ask.ts`. The mutual sealed-reveal mechanic, built as
  two *ordinary* messages rather than a mutated one: the sender's sealed
  original (`{question, answerA}`) renders locked; tapping it as the recipient
  opens an answer modal that sends a second `ask` message reply-linked
  (`replyTo`) to the original with `{question, answerA, answerB}` filled in.
  That second message renders revealed (both answers, labeled by sender) —
  reusing the pre-existing generic reply/quote system (any message with a
  `replyTo` already gets a quote block in `buildMessageRow`) instead of adding
  any new live-update plumbing, exactly the "lite mechanic" the plan called
  for. No compose-time question re-validation against the original on answer
  submit — out of scope for lite (a double-answer just renders a second
  revealed card; accepted for v1).
- All three get their own "keepsake card" look in `global.css` (own gradient
  accent, unflattened in bubble mode) — the `.letter-card` family, not the
  flattened `.file-card`/`.voice-bubble` one — since they're meant to feel
  special/memorable, not utilitarian. Shared compose-modal classes
  (`.msg-compose__title/__field/__actions`) added by extending the existing
  `.letter-compose__*` selectors rather than duplicating rules, since all
  three (and letter) need the identical title/field/actions shape.
- `mediaLabel()` in `ChatPage.ts` gained cases for `countdown`/`checkin`
  (reply-quote snippets); `ask` deliberately has none — its `content` already
  *is* the question, so the existing fallback (`original.content`) already
  reads correctly in a reply quote.
Notes/deviations: batches 4-6 of 7, bundled into one PR (client-only, same
shape, same risk level) — same reasoning as batches 0-2. This closes out the
slash-commands-refresh plan
(`~/.claude/plans/brainstorming-planning-phase-virtual-spark.md`).

---

## [Slash commands refresh, batch 3] Migration 024 + ask/countdown/checkin type plumbing — 2026-09-01
Status: code complete, both projects build clean (`tsc`); **migration 024 not
yet applied to the live DB** — apply before batch 4 (`/countdown`) lands, since
that's the first batch that actually sends one of the new types.
What shipped:
- **Migration `024_message_types_widen.sql`** — widens `messages_type_chk`
  (currently `text,letter,voice` per migration 017) to the full 8-type union.
  Written idempotently (`drop constraint if exists` + recreate) since this
  session's sandbox couldn't reach the live DB directly (Supabase's
  direct-connect host is IPv6-only, unresolvable here) to confirm its current
  state — **worth a manual check**: `image`/`file` media messages already
  shipped and were verified working (PR #31/#32), which implies the live
  constraint already permits them via some out-of-band change, since no
  migration in this repo's history ever added them before now. This migration
  is safe either way, but that gap is worth understanding, not just papering over.
- **`MessageType` union widened** to include `'ask' | 'countdown' | 'checkin'`
  in both `messageService.ts` (backend) and `Transport.ts` (client) — kept in
  sync per the existing three-place pattern.
- **Payload validators added** (`messageService.ts`, structural only — no
  compose/render UI yet): `validateCountdownPayload` (`{label, targetIso}`,
  label 1-100 chars, targetIso must parse as a date), `validateCheckinPayload`
  (`{mood, note}`, mood from a fixed 5-point scale, note 1-300 chars),
  `validateAskPayload` (`{question, answerA, answerB?}`, question 1-300,
  answers 1-500 each). Each new type's primary display string (label / note /
  question) lives in `content` too, same shape as `text`/`letter` — no change
  needed to `saveMessage`'s content-length branch.
- `mediaLabel()` in `ChatPage.ts` already has a `default: null` case, so the
  widened union type-checks with no client renderer changes required yet.
Notes/deviations: this is batch 3 of 7. `/countdown`, `/checkin`, `/ask`
(compose UI + card renderers) are batches 4-6, staged next.

---

## [Slash commands refresh, batch 0-2] Remove /shrug+/flip, add /daily, spark send button — 2026-09-01
Status: code complete, client builds clean (`tsc`/`vite build`); pending visual
confirmation of the send-button icon (Chrome extension unavailable this
session — verify via Vercel preview) and manual composer walkthrough.
What shipped:
- **Removed `/shrug` and `/flip`** — both were plain-text composer inserts with
  no lasting value, unlike `/letter`. Deleted from `COMMANDS` in
  `slashCommands.ts`; `ARCHITECTURE.md`'s stale mention updated.
- **Added `/daily`** — question-of-the-day. Lite scope: a curated bank of
  12 prompts specific to two people who already know each other (not generic
  icebreakers), picked deterministically by day-of-year so both partners land
  on the same prompt, inserted into the composer via the existing `insert`
  helper (kept alive by this addition after shrug/flip's removal). No new
  message type, no migration — plain `text` message once sent.
- **Spark/comet send button** — replaced the plain `&uarr;` glyph with an
  inline feather-style SVG (curved tail + filled head, matching the existing
  attach/mic icon language) in `renderChat`'s composer markup. Button made
  round (`.chat__send-btn`, 40px) to match the attach/mic buttons it sits
  beside; a small "launch" transform on `:active`, respecting
  `prefers-reduced-motion`. Continues to tint via the existing
  `button.primary` → `var(--accent-you)` wallpaper-accent binding — no new
  theming work needed.
Notes/deviations: this is batches 0-2 of the 7-batch slash-command-refresh
plan (`~/.claude/plans/brainstorming-planning-phase-virtual-spark.md`) —
`/ask`, `/countdown`, `/checkin` and their enabling migration are separate,
higher-risk batches, staged after this one lands.

---

## [Chat UX batch] Receipts, reactions, logout, timestamps, wallpaper-1 — 2026-08-31
Status: code complete, both projects build clean (`tsc`/`vite build`); pending
migrations 021–023 applied to the live DB and a two-account manual walkthrough.
What shipped:
- **Read receipts → WhatsApp 3-state.** New `connection_members.last_delivered_at`
  (migration 021), server-maintained: bumped on socket connect/join
  (`socketServer.ts`) and, inline on `message:send`, when the recipient already
  has a live socket in the room (`syncDelivery`, replaces the old
  `notifyIfOffline` — same fetchSockets() call now also drives delivery, not
  just the offline-push decision). `connectionService.markDelivered` mirrors
  `markRead`; surfaced as `otherLastDeliveredAt` on `/connections/current`
  (no new Transport method — stays off-Transport like `markRead`/read receipts
  always have). Client `applyReceipt` now derives pending/delivered/seen;
  bubble-mode ticks: ✓ sent, ✓✓ gray delivered, ✓✓ **#53bdeb** (WhatsApp blue) seen.
- **Reactions → one per user per message.** Migration 022 drops the old
  `unique(message_id,user_id,emoji)` for `unique(message_id,user_id)`
  (dedup'd first); `reactionService.addReaction`'s upsert conflicts on
  `message_id,user_id` so picking a new emoji replaces the old row server-side
  too. Client `applyReactionUpdate` strips a user's other emoji on `add`; a
  `toggleReaction` revert bug this introduced (reverting a "switch emoji" op
  only undid the new emoji, not the replaced one) was caught and fixed before
  building. Reaction UI moved out of the bubble into a `.chat__reaction-badge`
  — a small pill absolutely positioned overlapping the bubble's bottom corner,
  Instagram-DM style (bottom-right for mine, bottom-left for the other's).
- **Logout.** `authService.signOut()` already existed but had no user-facing
  entry point — added a "Log out" button on `ConnectionIdPage` (home) and a
  "Log out" item in the chat `•••` menu (`MenuDropdown`), both following the
  existing `signOut()` → `location.assign('/')` reload pattern.
- **Per-message timestamp.** New `formatMessageTime()` (12-hour, e.g. "3:59 AM")
  in `utils/formatTime.ts`; renders in the *viewer's* local timezone for free
  (no `timeZone` option, same as the file's other formatters) since `createdAt`
  is stored as an ISO/UTC string. Shown as `.chat__bubble-time` under every
  bubble (was previously only visible via tap-to-expand full timestamp).
- **Wallpaper option "1" removed** (the picker's other three options —
  off/love/samurai — and the whole wallpaper system stay). Removed the option
  button, its `chat--wallpaper-1` CSS, and `'1'` from the backend
  `ALLOWED_WALLPAPERS`. Migration 023 resets any connection still on `'1'`
  back to `'off'`.
- **Android composer scrollbar removed** — `scrollbar-width: none` +
  `::-webkit-scrollbar { display: none }` on the message textarea; auto-grow
  to `MAX_INPUT_HEIGHT` and scroll-past-cap behavior unchanged.
Notes/deviations: "Delivered" fidelity depends on the recipient having a live
socket — a fully-closed PWA won't flip to delivered until its next socket
(re)connect (push alone doesn't bump it). Accepted for V1 per plan sign-off.
Planned in `~/.claude/plans/planning-phase-only-squishy-fog.md`.

## [Code-quality cleanup] Dead code, dedup, query reduction — 2026-08-30
Status: done. Both projects build clean; two-account walkthrough passed on the
dev stack (send/receive text+letter+reply, reactions, report at every
connection state incl. post-termination, rename during active + leave_pending,
mutual leave, solo termination, token-refresh reconnect). Migration 020 applied
to the live DB and verified. Branch `chore/codebase-cleanup`, 9 commits.
Audit report: `~/.claude/plans/lucky-drifting-engelbart.md`.
What shipped (batches ordered lowest→highest risk):
- **0** — removed committed cruft (`Love.webp`, `perv session.md`, `prompt.md`,
  `graphify-out/` cache, duplicate `wallpapers/*.jpg`); `.gitignore` hygiene
  (`graphify-out/`, `!*.env.example` negation); doc fixes (CLAUDE.md notes
  reactions/`/letter` as ratified §29 overrides; README drops the
  never-created `shared/` dir; stale `Modal.ts` / `slashCommands.ts` comments).
- **1** — dead code: `req.authUserId` (write-only), `ConnectionRow.leave_requested_*`
  interface fields; tightened ~11 over-broad `export`s to internal; `openReportModal`
  defined before use; `messageService` re-exports `Transport`/`ReactionUpdate`
  so `ChatPage` stops reaching into `transport/`.
- **2** — shared backend helpers: `utils/pgErrors.ts`, `utils/connections.ts`
  (`isLiveStatus`, `otherMemberId`), `withUniqueConnectionCode` (folds the
  duplicated code-gen retry loop), socket handshake reuses `currentLiveConnectionId`.
- **3** — `state/nextScreen.ts` `nextScreenFor()` replaces the routing logic
  inlined+drifted across `main.ts` / `ConnectionIdPage` / `WaitingPage`
  (WaitingPage now also routes on `leave_pending`); **G1 fix** — rename no
  longer bounces the user out during a pending leave; report dialog gets its
  own `report-dialog__*` CSS instead of borrowing `letter-compose__*`.
- **4** — `services/connectionAccess.ts`: one `getConnectionForMember` /
  `getConnectionByMessageId` replacing the membership+live check hand-written
  5× across connectionService/messageService/reactionService/reportService
  (error codes preserved exactly; `everMember` keeps the report-after-leave
  path). `ConnectionError` moved to `utils/connectionError.ts` (re-exported from
  connectionService — no other imports changed).
- **5** — `services/authToken.ts` `resolveUserFromToken()` shares the 15s
  token→user cache between the HTTP middleware and the socket handshake
  (reconnects skip the GoTrue round-trip). `message:send` resolves the
  connection once (`getLiveConnectionForUser`, 1 query) and threads the row
  into `saveMessage` + `notifyIfOffline` — **query count 6→3 online, 8→4
  offline**. `saveMessage` trusts the just-resolved row (no insert-time
  re-fetch; the ~ms TOCTOU window is self-cleaning via cascade-delete).
- **6** — `getCurrentConnection` embeds `connection_members` (PostgREST reverse
  embed, verified against live Supabase) and only fetches `users.connection_code`
  when `status === 'pending'` — **the 4s active poll drops 3 queries → 1**
  (`otherConnectionCode` is `''` for non-pending, read only by
  `ConnectionRequestPage`). `advanceLeave` / `confirmEndLeave` fetch both
  member rows in one query (`getMemberLeaveRows`).
- **020** — DB migration dropping `connections.leave_requested_by` /
  `leave_requested_at` (A2).
Notes/deviations: **B9** (shared error-banner helper across 7 form pages) —
deferred, non-uniform pattern, cosmetic. **F1** (`pg` prod→dev dependency) —
not done, gated on confirming how Railway runs migrations. Everything in the
audit's "leave alone" list untouched (ChatPage.ts decomposition, overlay/
dismiss unification, linkify/highlighter merge, transport abstraction,
`syncViewport`, applied-migration squashing, CI migration step).

## [UX smoothness pass, Batch 6 — final] Per-page polish, button/page transitions — 2026-08-30
Status: done. Client builds clean; device verification pending. This is the
last planned batch — the UX/UI smoothness pass (started as a separate track
from the security audit) is now feature-complete pending final device
sign-off. Plan: `~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped:
- **Button transitions app-wide** — hover/press were instant everywhere
  (a B1 audit finding). Added a transition on border/background/filter/
  transform plus a small `:active` press-scale, reduced-motion guarded.
- **Page-entrance animation** — the router's `innerHTML` swap between screens
  was a hard instant cut (a B4 audit finding). `.screen` and `.chat` now
  fade+rise in on mount (`screen-enter`, reused across both), softening
  every navigation without touching the router itself.
- **Shared `.screen__input` class** — replaced two different inline
  width/text-align style blobs (Connect's 200px ID field, Nickname's 220px
  name field) with one token-driven class (`width:100%; max-width:240px`)
  plus a `--code` modifier for the uppercase/letter-spaced connection-ID
  variant. Removes the last two hardcoded pixel widths (B7).
- **`.connection-id` elevation** — added `box-shadow: var(--elevation-1)`,
  the intended "signature element" treatment from the Batch 1 design plan
  (the code you share to connect — the thing this app is actually about).
- **New `button.danger` class** — replaced `LeavePage.ts`'s inline
  `style="border-color: var(--danger); color: var(--danger)"` on the
  "Leave now" button with a real reusable class.
Notes/deviations: did not add a dedicated 481-720px breakpoint — the
`.screen`-based pages are already fluid/centered with per-element max-widths
and no concrete breakage was found at that range (unlike the ≤480px case
PR #22 fixed); adding one would have been speculative. The Export page's
downloadable HTML template has its own embedded inline styles by design
(a static export artifact, not live app UI) and was left untouched.

## [UX smoothness pass, Batch 5] Menu exit animation, safe-area insets, menu IA fix — 2026-08-30
Status: done. Client builds clean; device verification pending. Plan:
`~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped:
- **Menu exit animation** — the nav dropdown and message context menu (both
  share `.menu`) got a pop-IN animation in Batch 4 but closed instantly
  (`panel.remove()`/`ctxMenu.remove()`), which read as abrupt right after a
  smooth open. New shared `utils/animateOut.ts` (`animateOutAndRemove`) adds
  a `.menu--closing` class, waits for `animationend` (with a safety timeout
  fallback, and an immediate-remove path under `prefers-reduced-motion`),
  then removes the element. Wired into `MenuDropdown.ts`'s `close()` and
  `ChatPage.ts`'s `closeCtxMenu()`.
- **Safe-area insets** — `.chat__nav`, `.modal-overlay`, and `.screen` now
  add `env(safe-area-inset-*)` on top of their existing padding (composer
  already had this on its bottom edge). Matters most in installed-PWA mode
  (no browser chrome to reserve the notch/home-indicator area) and landscape.
- **Menu duplicate-label fix** — `MenuDropdown.ts` had two identical
  "CONNECTION" group headers (one for Rename, a second for the unrelated
  Leave action), read as a mistake. Removed the redundant second label; the
  existing divider + danger-red styling already separate Leave visually.
- **iOS notification parity (#2) — confirmed descoped by user decision**,
  no further work; left hidden on iOS Safari tabs (installed-PWA-only
  platform limit).
Notes/deviations: none.

## [UX smoothness pass, Batch 4 fix] Long-press menu race on Android — 2026-08-30
Status: done, folded into the still-open Batch 4 PR (#26). Client builds clean.
What shipped: the long-press message menu (emoji/Copy/Report) would flash
open big, then instantly shrink, on Android — Android fires a native
`contextmenu` event around the same ~450ms threshold as our own JS long-press
timer, racing to build a second popover (the `contextmenu` handler always
included Reply, since that path didn't know it was actually a touch gesture)
on top of the first, cutting off the batch-4 pop-in animation mid-flight.
Fixed by having the `contextmenu` handler bail immediately on a coarse
pointer — long-press already owns this gesture on touch; right-click only
exists on desktop. The existing `suppressClickUntil`/`lastMenuFor` guard
stays for the hybrid-device edge case (a touchscreen laptop whose primary
pointer is a mouse).
Notes/deviations: none.

## [UX smoothness pass, Batch 4] Toasts — 2026-08-30
Status: done. Client builds clean; device verification pending. Plan:
`~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped: New `components/Toast.ts` — a lightweight, auto-dismissing
(3.2s), tap-to-dismiss toast, stacked top-of-screen with a fade+slide
transition, `role="status"`/`aria-live="polite"`. `ChatPage.ts`'s `showNotice`
(push on/off feedback) now calls it instead of opening a modal — a status
message doesn't need a Tab-trapped decision dialog. `openTrackedModal`, which
existed only for `showNotice`'s modal, is now orphaned by that change and was
removed; the report-message and letter-composer modals track their own
overlays directly and are unaffected.
Notes/deviations: none.

## [UX smoothness pass, Batch 4 prep] Animation timing tweaks + menu-open animation — 2026-08-30
Status: done. Client builds clean. Small follow-ups from live-device feedback
on the (merged) Batch 3b, ahead of Batch 4 (toasts). Plan:
`~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped:
- Reply-bar reveal slowed from `--duration-base` (200ms) to 360ms — a quick
  reveal read as a flicker rather than a visible confirmation of the swipe.
- Message send/receive pop slowed from 260ms to 340ms.
- **Menu-open animation added** — `.menu` (shared by the nav dropdown and the
  message context menu) previously appeared instantly with no transition at
  all. Now fades + scales in (`menu-pop` keyframe), `transform-origin`
  anchored per menu type (top-right for the nav dropdown, center for the
  context menu, which can appear above or below a message).
Notes/deviations: none.

## [UX smoothness pass, Batch 3b] iOS keyboard gap, keyboard-stays-open, animation polish — 2026-08-30
Status: in-progress (continues Batches 0-3, all merged). Client builds clean;
device verification pending. Plan:
`~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped, from live device retest of Batch 3:
- **iOS black gap was only half-fixed.** Batch 3 synced `--app-height` from
  `visualViewport` but not its position — iOS shifts the *visual* viewport
  when the keyboard opens (via `offsetTop`) without reflowing the layout
  viewport, so `#app` (sized but not repositioned) stayed anchored above a
  now-scrolled-away area, leaving the gap between the composer and the
  keyboard the user was actually typing into. Fixed by making `#app`
  `position: fixed` and pinning `top` to `visualViewport.offsetTop` as well,
  tracked via both its `resize` and `scroll` events (`main.ts` `syncViewport`).
  This is the standard pattern other web chat apps use for this iOS quirk.
- **Keyboard was dismissing on send** — tapping the send `<button>` moves
  focus to it on most mobile browsers, closing the keyboard (unlike
  WhatsApp/iMessage, which keep it open). Fixed with `pointerdown`
  `preventDefault()` on the send button (stops the focus steal without
  blocking the click) plus `input.focus()` after send as a safety net.
- **Reply-bar animation felt janky on phones** — `startReply` opened the
  keyboard (`input.focus()`) in the same tick as the reply-bar's slide-in
  transition, so they competed for the main thread. Deferred the focus call
  one frame so the transition gets a head start.
- **Message entrance animation tuned toward WhatsApp's send "pop"**: bigger
  scale drop (0.6 vs 0.92) with an overshoot easing
  (`cubic-bezier(0.34, 1.56, 0.64, 1)`) instead of a flat fade, and
  `transform-origin` anchored to the bottom-right for your own messages
  (bottom-left for received) so it visually grows from the composer's side
  rather than popping from its own center.
Notes/deviations: iOS Safari's viewport/keyboard interaction is a well-known
inconsistency across versions — implemented the established fix pattern but
could not verify live; needs a real retest specifically for the gap and for
whether the keyboard now stays open through a send.

## [UX smoothness pass, Batch 3] Message/reply animation, iOS viewport gap, swipe icon — 2026-08-30
Status: in-progress (continues the Batches 0-2 PR, #23, now merged). Client
builds clean; device verification pending. Plan:
`~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped, from live device testing of the merged Batch 0-2 work:
- **Message send/receive had no entrance animation** ("appears out of thin
  air") — `appendMessage` now takes an `animate` flag, scale+fade via
  `@keyframes message-enter`, applied ONLY to a message arriving live this
  session (the optimistic send, and incoming `onIncoming`) — never to initial
  history load or `loadOlder` pagination, which would otherwise cascade-
  animate every past message on open. Respects `prefers-reduced-motion`.
- **Reply-bar had no animation** — was a hard `display:none`/`flex` toggle.
  Now a class-toggled `max-height`/`opacity`/`transform` transition, so it
  slides in above the composer instead of snapping.
- **iOS Safari black gap below the composer on cold load**, disappearing only
  after the keyboard opens once: `100dvh`'s first paint on iOS can use the
  toolbar-collapsed height while the toolbar is still expanded, leaving a gap
  of page background until some event forces a recompute. Added a
  `visualViewport`-driven `--app-height` custom property (`main.ts`,
  `syncAppHeight`) that `#app` now prefers over the dvh fallback chain.
- **Swipe-to-reply icon** was a `↩` text glyph (looked like an emoji/informal).
  Replaced with a plain inline SVG reply-arrow using `currentColor`.
- **iOS notification parity (#2) — descoped by user decision.** Web Push
  requires an installed PWA on iOS Safari; user decided not to invest in a
  disabled+explanation treatment for now — left as-is (hidden on iOS tabs).
Notes/deviations: the Grammarly-style icons visible in the composer on one
screenshot are a browser extension overlay, not app UI — nothing to fix.
Remaining batches: toasts, safe-area insets + menu IA dup-label fix, per-page
redesign application. Still needs iOS/Android device confirmation for this
batch specifically (send/reply animation feel, and whether the viewport gap
is actually gone on cold load).

## [UX smoothness pass, Batches 0-2] Context-menu bug, gesture fix, design tokens — 2026-08-30
Status: in-progress (batches 0-2 of a 7-batch plan; client builds clean; device
verification pending). Plan: `~/.claude/plans/new-track-separate-from-async-stardust.md`.
What shipped: A deeper UX/UI audit beyond PR #22 found 2 of 4 user-reported
issues didn't match current source (traced and corrected the report), 1 iOS
menu item genuinely gated by a platform limit, and 1 new bug from live testing.
- **Context-menu full-width bug (real, found live):** `.chat__ctx-menu` was
  declared *before* `.menu` in `global.css` — equal specificity, so the later
  `.menu` rule won the cascade, clobbering `position:fixed`/`right:auto`/
  `z-index:40`. Combined with the JS's inline `left`, the menu ended up
  constrained by both `left` (inline) and `right:20px` (from `.menu`) with
  `width:auto`, so CSS stretched it to fill the gap — full viewport width.
  Fixed by reordering the rule after `.menu`.
- **Context-menu position also now anchors to the message bubble** (not
  `e.clientX/Y`) — previously right-clicking near a bubble's left vs. right
  edge shifted the menu, since it centered on the raw cursor point. Long-press
  already anchored to the bubble; right-click now matches (`ChatPage.ts`
  `contextmenu` handler).
- **Swipe-to-reply had no real direction lock:** the axis check existed but
  `touchmove` was `{ passive: true }`, so `preventDefault` was impossible and
  native scroll could run alongside a horizontal swipe. Added
  `touch-action: pan-y` on `.chat__log` and made `touchmove` non-passive,
  calling `preventDefault()` once the gesture commits horizontal.
- **Timestamp toggled on any click in a message row**, including empty space
  beside short text — the click listener was on the whole row/body, and
  `.chat__message-body` is `flex:1` (full row width) in line mode. Moved the
  listener onto the actual text/letter-card element (which is `display:inline`
  or its own bounded card), so only the visible content is clickable.
- **Menu/iOS parity re-scoped:** code only ever gated Notifications (via
  `isPushSupported()`/`PushManager`), confirmed live — Export/Search/Appearance
  already show on iOS. Approved fix (not yet built): show Notifications
  disabled + explanation on iOS instead of hidden.
- **Design foundation (Batch 1):** token system added to `global.css` — spacing
  scale, radii, elevation, type scale, motion vars; three type voices
  (`--font-display` Fraunces serif for titles, `--font-body` Figtree sans for
  reading, `--font-mono` JetBrains Mono — now actually loaded via Google Fonts,
  previously named but never loaded, silently falling back to system mono) —
  app-wide light theme via `prefers-color-scheme` (previously only the Chat
  page had a light variant; added a `.chat[data-theme='dark']` re-pin so the
  chat's own manual theme picker still overrides correctly under a light OS).
Notes/deviations: Design direction is "Hybrid" (approved) — mono kept as the
data voice for codes/timestamps/receipts, serif+sans for display/reading, not
a full skin replacement. Remaining batches: micro-interactions/animations,
toasts, iOS notification treatment + safe-area insets + menu IA fix, per-page
redesign application. Real iOS/Android device confirmation still needed for
the gesture fix specifically (user tested pure-axis swipes only, not diagonal).

## [UI/layout polish] Fix visibly-broken screens — 2026-08-30
Status: done, client builds clean; branch `fix/ui-layout-polish` (PR #22); in-app
visual pass across widths still pending (rides with live verification).
What shipped: A CSS/layout audit found 17 on-screen defects unrelated to the
security audit; this fixes them. Almost all in `client/src/styles/global.css`.
- **Chat header:** a long nickname pushed the ⋯ menu button off-screen (clipped,
  unreachable) — `.chat__nav > div { min-width:0 }`, title/status ellipsis,
  `flex-shrink:0` on the button.
- **`.screen__actions`** now wraps (was a rigid row) — ExportPage's 3-button row
  and wide single buttons no longer overflow phones. `.screen__title` gets
  `max-width` + `text-wrap:balance`; hard `<br />` removed from Login / Nickname /
  Leave titles.
- **Line style + Light theme** was a dead toggle (light palette only existed for
  bubble mode). Added `.chat[data-theme='light']` with the full token set +
  darkened YOU/other/danger accents for legibility on white.
- **Modals vs. mobile keyboard:** pin-to-top + scroll (`align-items:flex-start`,
  `overflow-y:auto`, `margin:auto`, `max-height:90dvh`) so the action row stays
  reachable. `#app` gets `-webkit-fill-available` where `dvh` is unsupported.
- `.menu` / `.slash-menu` height clamps (clipped `Leave connection` on short
  viewports); `.chat__quote-snippet` `280px`→`100%`; new `.letter-card__text`
  wrap rule; appearance wallpaper row wraps; empty chat shows a start-of-convo
  line; flash animates the bubble not the row; ctx-menu z-index above the slash
  menu; mobile popover insets match the 12px bars; failed messages hide the
  stray receipt dot.
Notes/deviations: pure CSS + 4 trivial DOM edits, no behaviour/logic change.
Wallpaper + Light-theme interaction (dark scrim under a light UI) left as a
pre-existing edge case.

## [Ops] Secret rotation — 2026-08-30
Status: done (dashboard + Railway + Vercel by user; local `.env` + verification by
Claude). Not a code change — recorded for history.
What happened: Rotated per the Aug-29 audit (CR-1). Git history was verified
clean — no secret was ever committed; exposure was `backend/.env` on disk + a
brief working-tree paste. Supabase moved to the **new API-key model**: legacy
anon + service_role JWTs **disabled**, new `sb_secret_…` / `sb_publishable_…`
keys issued (old `sb_secret` also revoked). Postgres password reset. VAPID
keypair regenerated — and this fixed a latent bug: `backend/.env` and
`client/.env` had held **mismatched** VAPID pairs, so push had been silently
100% broken. `push_subscriptions` table emptied. All old keys verified dead
(HTTP 401 on Supabase REST); new keys verified live (200). `backend/.env`
cleaned (had a duplicate service-key line).

## [Security & correctness audit] Batches 4–9 (Medium + Low tier) — 2026-08-30
Status: done, builds clean; **apply migration 019**; branch `fix/audit-medium-low`
What shipped: The deferred remainder of the Aug-29 audit — the frontend Mediums and
the Low tier (all 10 backend Mediums + L-B3 already landed in Batches 0–3). Six
stacked commits on `fix/audit-medium-low` (branched off `fix/audit-critical-high`,
which reached `main` via PR #20 after the original PR #18 merged into the wrong
base). No behaviour changed beyond the fixes; no style churn.
- **Batch 4 — overlays & downloads:** `Modal.ts` is now a modal stack — one shared
  keydown listener, only the top modal takes Escape and traps Tab; focus is saved
  and restored; backdrop dismiss only fires when the mousedown started on the
  backdrop (M-F4). `download.ts` appends the anchor before click and defers
  `revokeObjectURL` 10s (M-F5).
- **Batch 5 — chat page:** auto-scroll only when already near the bottom / the
  message is mine (M-F2); search input debounced ~120ms (M-F9); highlight splits
  text nodes only so linkified `<a>` survive a search (M-F10); `CSS.escape`
  guarded (L-F1); history sorted by `createdAt` before render (L-F5).
- **Batch 6 — form pages:** NicknamePage trims + disables Save (M-F13);
  LeavePage / ConnectionRequestPage disable their action buttons during the
  request (M-F14); `otherConnectionCode` escaped (M-F15); ConnectionIdPage Copy
  feature-detects clipboard with an execCommand fallback + feedback (M-F18).
- **Batch 7 — push / service worker:** `getRegistration` races
  `serviceWorker.ready` with a 3s timeout (the Notifications click no longer hangs
  when `/sw.js` is missing) (M-F6); `subscribeToPush` unsubscribes the browser
  sub if the server save fails (M-F7).
- **Batch 8 — util polish:** `formatTime` invalid-Date guards + ChatPage skips a
  separator for a bad timestamp (L-F2); `linkify` runs length-bounded and the
  phone branch needs a leading `+` (L-F3); `/shrug` `/flip` replace only the
  leading token and fire an input event (L-F4); an OAuth `?error=` / `#error=`
  redirect is surfaced on the login screen (L-F6).
- **Batch 9 — backend lows:** `requireAuth` resolves + caches the app user per
  access token (15s, never past exp) and exposes `req.appUser`; routes stop
  re-calling `getOrCreateUser` — the 4s poll drops from ~4–5 external round-trips
  to ~1 (L-B1). UUID-shape assert before the PostgREST `.or()` interpolation
  (L-B2). `removeSubscription` deletes by endpoint alone (L-B4). Migration 019:
  `advance_leave_step()` RPC does the leave advance entirely in SQL — from-step
  pin + 24h cooldown vs `now()` — instead of a JS `Date.now()` cutoff (L-B5).
Notes/deviations: **L-B1** kept Supabase GoTrue as the token-verification
authority (short-TTL cache) rather than local HS256 signature verification — the
latter needs a `SUPABASE_JWT_SECRET` the deploy doesn't currently set, and the
cache delivers the same round-trip saving at far lower lockout/bypass risk.
**L-B6** (soft-delete on terminate) skipped — contradicts the deliberate spec §25
"export first, nothing retained" decision. **L-F7** (`supabaseClient` throws at
import) left as the audit's own "acceptable fail-fast". Compile/build verified
only; the DB-dependent items (migration 019, the leave gate, the 2-account race,
browser leak/reconnect checks) still need a running stack + scratch Supabase
branch.

## [Security & correctness audit] Batches 0–3 (Critical + all High) — 2026-08-29
Status: done, builds clean; **apply migrations 016, 017, 018**; rotate secrets (see below)
What shipped: Remediation of the ruthless full-repo audit (3 Critical, 13 High, plus folded-in
Mediums). Four stacked commits on `fix/audit-critical-high` (branched off the reaction-picker PR).
- **Batch 0 — secrets:** `backend/.env.example` had the real VAPID keypair pasted in → reverted.
  Added `.githooks/pre-commit` (gitleaks + `.env.example`-has-no-values), `.gitleaks.toml`,
  `.github/workflows/gitleaks.yml`. **Manual:** rotate the Supabase service-role key, Postgres
  password, and VAPID keypair — they were on disk in `.env` and briefly in the tracked template.
- **Batch 1 — backend correctness:** `getHistory` paginates newest-first (limit 50) + `before`
  cursor + client "Load older" button (past ~1000 messages PostgREST's row cap was returning the
  *oldest* 1000 and hiding everything recent). Migration 016: partial unique indexes +
  advisory-locked trigger so concurrent requests can't create two live connections;
  `getCurrentConnection` tolerates >1 row instead of 500ing and locking the user out. Conditional
  state transitions (accept/decline/advanceLeave pin the from-state) so accept can't resurrect a
  declined row and the 24h leave gate can't be raced. Migration 017: `ON DELETE CASCADE` on
  `connections.user_*`/`messages.sender_id` (user deletion was impossible) + `type`/`emoji`
  CHECKs. `connection_members` insert now error-checked + rolled back.
- **Batch 2 — backend hardening:** push endpoint host-allowlist (was blind SSRF); `crypto.randomInt`
  8-char codes (was `Math.random`); `express-rate-limit` (global 240/min + 10/min on request/
  subscribe/report) + 32kb json + per-socket flood guard; socket events re-resolve the live
  connection per event (not the handshake pin); `requestConnection` returns one generic error
  (no enumeration oracle); `POST /connections/:id/cancel` for the requester + WaitingPage Cancel
  button; `connection:ended` broadcast on terminate; `reportMessage` works after termination and
  snapshots the message (migration 018: unique per reporter, `message_id` nullable + SET NULL,
  `message_content` column); error middleware `headersSent` guard + socket acks no longer leak
  raw PG strings.
- **Batch 3 — frontend reliability:** `ChatPage.cleanup()` tears down the popover + its global
  listeners, the menu dropdown, the appearance panel, and open modals (were leaked every visit);
  startup try/catch + global handlers (no more blank page on a cold-load blip); 401 → sign out +
  login; reconnect supervisor + 10s ack timeout + fresh-token socket auth (messages no longer
  stuck forever); optimistic reconcile on a client `tempId` echoed by the server (was matched on
  content → duplicates) + incoming dedup; `disposed` guards after every await; long-press picker
  no longer dismissed by the trailing synthetic click; self-scheduling poll.
Notes/deviations: ~25 Medium and ~10 Low findings from the audit are documented in the plan file
(`~/.claude/plans/fix-chat-responsive-layout-splendid-babbage.md`) for a follow-up pass — this
batch was scoped to Critical + High.

## [Post-launch fixes] Reaction-picker viewport clamp, responsive hardening, Copy/Report — 2026-08-29
Status: done (**apply migration 015**); builds clean; needs live testing across viewports
What shipped:
- **Root cause of the mobile "zoomed page / misaligned header / blank right strip":** the reaction/context popover. `openPopover()` in `ChatPage.ts` placed the `.menu.chat__ctx-menu` (`position:fixed`, inheriting `.menu { min-width:200px }`) at the raw touch/click coordinates — no viewport clamp, no flip, no dimension measurement. Near the right/bottom edge the box overflowed the viewport; on iOS Safari off-screen fixed content lets the visual viewport pan/zoom. The normal layout chain was already sound (no `100vw`, no `overflow-x`, no forced widths).
- **`openPopover` rewritten** to take an anchor rect (the message bubble, or a zero-size rect at the cursor on desktop) instead of `(x, y)`. It measures the built menu, then clamps `left`/`top` into the visual viewport with an 8px safe margin and flips above↔below the message when there isn't room. Repositions on `visualViewport` + window resize, dismisses on log scroll / Escape / outside click. CSS: `.chat__ctx-menu { min-width:0; max-width:calc(100vw - 16px) }`, `.chat__emoji-picker { flex-wrap:wrap }`.
- **Viewport meta corrected** to `width=device-width, initial-scale=1, viewport-fit=cover` — dropped `maximum-scale=1.0, user-scalable=no` (restores pinch-zoom; the 16px composer font on ≤480px is the real iOS focus-zoom fix and stays).
- **Touch text selection suppressed on message bubbles** (`@media (pointer: coarse)` — `user-select:none` + `-webkit-touch-callout:none`) so long-press-to-react doesn't fight native selection/callout. Desktop keeps selection. `.chat__log { overflow-x:hidden }` contains the reply-swipe `translateX`.
- **Copy + Report actions** added to the message menu (both touch and desktop), via a shared `buildMessageMenu()`. Copy uses the clipboard API (text messages only). Report opens a modal (reuses `components/Modal.ts`) with an optional reason → `POST /api/messages/:id/report` → new `message_reports` table (migration 015, RLS enabled). `reportService.reportMessage` re-verifies connection membership server-side via `assertMemberOfMessageConnection` (now exported from `reactionService`), never trusting the client (spec §20). No moderation UI in V1 — rows are for manual review; satisfies the Play Store UGC reporting requirement (blocking is already the one-connection / leave model).
Notes/deviations: Picker dismisses rather than repositions on log scroll — matches native context-menu behaviour.

## [Post-launch fixes] Samurai wallpaper, drop wallpaper "2" — 2026-08-27
Status: done, builds clean
What shipped: Replaced the generic gradient wallpaper option ("2") with a real second photo wallpaper — **Samurai** (`client/public/samurai.jpg`), bubble colors pulled from its own crimson/charcoal palette (`wallpapers/samurai wallpaper description.txt`): mine = crimson gradient, white text; them = charcoal black, pale ivory text. Wallpaper options are now Off / 1 / Love / Samurai everywhere they're validated: `appearancePreview.ts` popover, `applyAppearance`'s class toggles, and backend `ALLOWED_WALLPAPERS`.
Notes/deviations: The user reported "Could not update the wallpaper" when picking Love — almost certainly because **migration 014 (`connections.wallpaper`) hadn't been applied in Supabase yet** (the update would fail with a missing-column error server-side, surfacing as the client's generic failure popup). Flagged to the user; not something more code can fix.

## [Post-launch fixes] Notification popup, shared wallpaper, mobile input zoom — 2026-08-27
Status: done (**apply migration 014**; builds clean; needs live testing after deploy)
What shipped:
- **Mobile zoom/jump on typing, fixed.** Root cause: `.chat__input-bar textarea { font-size: inherit }` (specificity 0,1,1) was silently overriding the `@media (max-width:480px) { input, textarea { font-size:16px } }` rule (specificity 0,0,1) — CSS specificity beats media-query source order, so the composer stayed at the inherited 15px on phones, triggering iOS Safari's auto-zoom-on-focus-under-16px. Added `.chat__input-bar textarea` explicitly into the mobile rule so it actually wins. Also locked `maximum-scale=1.0, user-scalable=no` on the viewport meta as a second layer against any residual pinch/auto-zoom.
- **Notification feedback is now a popup**, not the easy-to-miss in-chat system line — reuses `components/Modal.ts`. Shows the actual error message on failure (not a generic one) so it's diagnosable. Backend `pushService.sendToUser` also gained `console.log`/`console.error` on every send attempt (visible in Railway logs) instead of silently swallowing non-404/410 failures.
- **Wallpaper is now shared per-connection** (either member's pick applies to both) — a genuinely new architectural split, since everything else in Appearance (message style, light/dark theme) stays a per-device localStorage preference on purpose. New `connections.wallpaper` column (migration 014), `PATCH /connections/:id/wallpaper` (membership-checked like every other connection write), included in `getCurrentConnection`. `appearancePreview.ts` no longer owns wallpaper state at all — `applyAppearance`/`openAppearance` now take it as a param from `ChatPage.ts`, which applies it optimistically on change and re-syncs it off the existing 4s connection poll (no new socket event needed — reuses the same poll leave-state/read-receipts already ride).
Notes/deviations: The actual "notifications not sending" root cause is still unconfirmed — most likely culprit is that `VITE_VAPID_PUBLIC_KEY` was only added to Vercel *after* the last deploy, and Vite bakes `VITE_*` vars in at build time, not runtime, so a redeploy is required for the client to even see the key (if the "Notifications" menu item isn't appearing at all, this is almost certainly it). The popup + server-side logging in this fix are meant to make the actual failure point visible next time, not a guaranteed fix on their own. Verified compile/build only.

## [Phase D] Web Push notifications — 2026-08-27
Status: done, but **not live** — needs VAPID keys generated and set (see below) and migration 013 applied; builds clean; two devices to verify
What shipped:
- **DB:** `push_subscriptions` table (migration 013) — one row per device/browser, unique on `endpoint`, RLS enabled.
- **PWA shell:** `client/public/manifest.webmanifest`, `client/public/sw.js` (handles `push` → `showNotification`, and `notificationclick` → focuses or opens the app), `client/public/icon.svg` (a simple two-circle mark in the app's own accent colors), linked from `index.html` + registered in `main.ts`. This also makes the app installable — required for iOS to deliver push at all (Apple only allows it for a site Added to Home Screen).
- **Backend:** `web-push` dependency; `pushService.ts` (`saveSubscription`/`removeSubscription`/`sendToUser` — prunes a subscription on a 404/410 from the push service); `routes/push.ts` (`POST /api/push/subscribe`, `/unsubscribe`). If `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` aren't set, push silently no-ops (logs a warning) rather than crashing — safe for local dev without keys.
- **Send path:** in `socketServer.ts`, after a `message:send` broadcasts, `notifyIfOffline()` checks whether the recipient has a live socket in the connection's room (rooms are exactly the two 1:1 members, so "anyone else present" = the recipient is here); if not, it looks up "what the recipient calls the sender" (nicknames are stored on the *other* member's row, per spec §11 — so that's the sender's own `connection_members.nickname`) and pushes a notification with that as the title.
- **Client subscribe flow:** `features/pushNotifications.ts` (`isPushSupported`/`isPushSubscribed`/`subscribeToPush`/`unsubscribeFromPush`) wired to a new **Notifications** item in the `•••` menu (only rendered when the browser supports push) — a deliberate toggle, not an automatic prompt-on-load, since browsers/users auto-deny unsolicited permission prompts. Confirmation reuses the existing `appendSystemLine` in-chat pattern (same one leave-lifecycle events use).
Notes/deviations: **This phase needs user action before it does anything**: (1) apply migration 013 in Supabase, (2) generate VAPID keys with `npx web-push generate-vapid-keys`, (3) set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` on the backend and `VITE_VAPID_PUBLIC_KEY` (the public half) on the client, both documented in the respective `.env.example`. Reactions don't trigger a push (out of scope — the plan only asked for message notifications). iOS Safari push only works after "Add to Home Screen"; no in-app hint for that yet (flagged as a follow-up in the original plan). Verified compile/build only — needs the keys set and two real devices (one with the app closed) to confirm delivery end-to-end.

## [Phase C] Emoji reactions: long-press (phone) / right-click React (desktop) — 2026-08-27
Status: done (builds clean; **apply migration 012**; two accounts to verify)
What shipped:
- **DB:** new `reactions` table (`012_reactions.sql`) — one row per `(message_id, user_id, emoji)`, unique constraint so a user can't double-react with the same emoji; RLS enabled with no policies (same default-deny net as migration 006 — backend uses the service_role key).
- **Backend:** `reactionService.ts` — `addReaction`/`removeReaction` resolve the message's connection and re-verify live membership before writing (never trusts the client, spec §20); a fixed 6-emoji allowlist (❤️ 👍 😂 😮 😢 🙏) is validated server-side too. `getReactionsForMessages` aggregates rows into `{ emoji, userIds }[]` per message, attached to `Message.reactions` in `getHistory`. Socket gained `reaction:add`/`reaction:remove` handlers that broadcast `reaction:update` (`{ messageId, emoji, userId, op }`) to the connection room.
- **Transport:** `sendReaction`/`onReaction` added to the interface and `InternetTransport` — additive, matches the existing message-send/receive shape.
- **UI, per user's interaction spec (explicit: "long press message to react in phone, in PC right click to react or reply"):** phone = long-press a row (~450ms, cancelled by real movement so it doesn't fight the reply-swipe) opens a 6-emoji picker at the touch point; desktop = the same right-click context menu from Phase B gained a **React** item that opens the identical picker. Both routes go through a new shared `openPopover()` helper. Tapping an emoji (in the picker, or an existing chip) toggles your own reaction — optimistic local update, reverted if the server call fails.
- **Rendering:** reaction chips render under the message body (`chat__reactions`), grouped by emoji with a count once >1, highlighted when you're among the reactors; updates apply live to the right row via an in-memory `reactionsByMessage` map keyed by message id (same id-lookup pattern as Phase B's reply quotes).
Notes/deviations: This explicitly overrides spec §29's V1 non-goals list (Reactions) — user confirmed this trade-off during planning, before any code was written. Reactions on a still-pending (unsent) message aren't offered, for the same reason replies aren't — no server id yet. Verified compile/build only; needs two accounts to confirm the long-press timing feels right and doesn't fire spuriously during scroll.

## [Phase B] Quoted replies: swipe (phone) / right-click (desktop) — 2026-08-27
Status: done (builds clean; **apply migration 011** — already applied by user in Supabase; two accounts to verify)
What shipped:
- **DB:** `messages.reply_to` (nullable, `references messages(id) on delete set null`) via `011_message_reply.sql`.
- **Backend:** `saveMessage(..., replyTo)` validates the target is a real message **in the same connection** (never trusts a client-supplied id, spec §20) before storing; `getHistory`/`toMessage` return `replyTo`. Socket `message:send` reads `replyTo` off the payload.
- **Transport:** `Transport.sendMessage` gained an optional `replyTo` 4th arg; `IncomingMessage`/`HistoryMessage` gained `replyTo`. Additive — `BluetoothTransport` (V3) just needs to plumb the same field.
- **Reply UI, per user's interaction spec:** phone = right-swipe a message row (translateX + a fading "↩" icon, ~60px trigger); desktop = right-click a row opens a small context menu with **Reply** (`.chat__ctx-menu`, reuses `.menu` styling) — built as a shared menu so Phase C's **React** can be added as a second item without rebuilding it. Both call `startReply(id)`, which shows a quoted-reply bar above the composer (sender + snippet, ✕ to cancel); the next send carries `replyTo` and clears the bar.
- **Rendering:** replied-to messages show a small quoted block above their text (`quoteBlock()`) — sender + one-line snippet, resolved from an in-memory `messagesById` map populated as messages render (history load, live incoming, and pending→confirmed). Tapping the quote scrolls to the original and briefly flashes it (`chat__message--flash`).
Notes/deviations: Reply is disabled on still-pending (not-yet-confirmed) rows — they have no server id yet, so `dataset.id` is unset and the swipe/right-click handlers no-op; this is implicit, not a special-cased guard. Letters don't carry reply context (composing `/letter` while a reply is staged just clears the reply bar rather than attaching it) — a deliberate scope cut, not a bug. Verified compile/build only; needs two accounts to confirm the swipe threshold feels right and the desktop context menu behaves.

## [Phase A] Appearance overhaul + multi-line composer + linkify + mobile `/letter` fix — 2026-08-27
Status: done (client-only, no migration; builds clean; browser + phone testing pending)
What shipped:
- **Bubbles is now the default** (`appearancePreview.ts` `DEFAULT.style`), not line/terminal.
- **iMessage-style bubble palette + Light/Dark theme.** New `--bubble-mine-*`/`--bubble-other-*` CSS vars: "me" is a fixed saturated blue (`#0a84ff`) with white text in both themes (like iOS); "them" flips grey-dark (`#26262a`) ↔ grey-light (`#e9e9eb`) via a new `data-theme` attribute on `.chat`, driven by a third **Theme (Light/Dark)** row added to the existing Appearance popover — stays a 3-row, uncrowded panel (Wallpaper / Message style / Theme), all in the same `appearancePreview` localStorage object.
- **"Love" wallpaper.** `client/public/love.jpg` (Vite's static dir — newly created, no `vite.config.ts` needed) served at `/love.jpg`; new `chat--wallpaper-love` option renders it behind the log with a legibility scrim, and swaps bubble colors to a palette pulled from the artwork itself (a dusk couple-silhouette scene) so bubbles read against the art instead of clashing. Went through two iterations with the user: first a placeholder pink wallpaper (later swapped for the final dusk image + a matching gold/steel-blue palette), and the receiver bubble color was corrected once for washing out against the art.
- **Read-tick contrast fix** (this was about legibility, not size, per user correction mid-session): ticks render white (`rgba(255,255,255,.65)` sent, solid white seen) against the always-saturated "mine" bubble, instead of a near-black tint that could wash out.
- **Multi-line messages / paragraph gaps work.** The single-line `<input>` composer is now an auto-growing `<textarea>` (capped ~120px, then scrolls); `.chat__message-text` gained `white-space: pre-wrap; overflow-wrap: anywhere`, so blank-line gaps between paragraphs survive send→render. Desktop: Enter sends, Shift+Enter newlines. Touch (`pointer:coarse`): Enter always newlines; the send button sends — this is what makes typing paragraph gaps possible from a phone keyboard.
- **Clickable links + phone numbers.** New `utils/linkify.ts` — splits message text into text nodes + `<a>` nodes (never `innerHTML`, stays XSS-safe like the existing search highlighter) for `http(s)://…`, `www…`, and phone-number-shaped digit runs (→ `tel:`), opened `target="_blank" rel="noopener noreferrer"`. Wired into `appendMessage()`; the search-highlight `clearHighlights()` path was fixed to re-linkify (not flatten to plain text) so links survive a search open/close cycle.
- **`/letter` fixed on mobile.** Root cause was twofold: `.slash-menu` had no positioned ancestor (`.chat__input-bar` now `position: relative`, so the drop-up renders on-screen instead of off the top of the viewport), and Android soft keyboards fire `keydown 229`/`Unidentified` instead of a catchable `Enter`/arrow keys, so selecting `/letter` via keyboard silently failed and the literal text got submitted. Added `slashCommands.ts` `matchCommand`/`runIfCommand` — the composer's `submit` handler now checks for an exact `/command` match before falling back to a normal send, covering the keyboard-Send-key path regardless of what keydown events actually fired.
Notes/deviations: Reactions (Phase C) and Web Push (Phase D) are explicitly out of scope for this part — see the plan at `~/.claude/plans/below-i-have-given-dazzling-elephant.md`. Reactions override spec §29's V1 non-goals list; user explicitly confirmed this trade-off before planning began. Verified compile/build only so far; needs a browser (both themes, both wallpapers) and a real phone for the `/letter` + composer verification.

## [1.x] Message-type foundation + `/letter` slash command (+ bubble tick) — 2026-08-27
Status: done (builds clean; **apply migration 010**; two accounts to verify)
What shipped:
- **Message-type groundwork (reusable):** `messages` gains `type` ('text'|'letter'|future 'voice') + `payload` (jsonb) via migration `010_message_types.sql` (**user applies**). The shape is threaded additively through the whole pipeline — backend `Message`/`saveMessage`/`getHistory` (letter body stays in `content`, so the length CHECK/search/export keep working; appearance+from+to go in `payload`, validated like nicknames), the socket `message:send`, `Transport.sendMessage(content, type?, payload?)` + `IncomingMessage`, `connectionsApi.HistoryMessage`, and `ChatPage` render. Adding voice later is now additive.
- **Slash commands:** new `features/slashCommands.ts` — a registry + drop-up menu on the composer (arrow/Enter/click, filters as you type). `/letter` (special), `/shrug` + `/flip` (text-insert). Grow the registry for more.
- **`/letter` end-to-end:** compose modal (write → preview with **2 appearances** `dawn`/`botanical`) → sends as a **folded letter card** in chat ("to X, from Y") → recipient taps → styled letter opens in a modal → **Download .html** (self-contained). "To" auto = sender's nickname for recipient; "From" = typed signature (remembered per device). New `components/Modal.ts` (reusable overlay), `features/letters.ts` (themes/compose/view/`buildLetterHtml`), `utils/download.ts` (shared `downloadFile`+`escapeHtml`, extracted from ExportPage).
- **Export is type-aware:** TXT/JSON/HTML each render letters sensibly (HTML export shows a styled letter block).
- **Bubble tick darkened** (`rgba(4,23,10,0.55)`→`0.85`) so ✓ stands out on the green bubble.
Notes/deviations: Letter bodies aren't in the in-chat text search yet (card, not `.chat__message-text`) — minor. Optimistic dedup now keys on content+type. Image/PDF letter download deferred (needs a library). Master plan updated with the message-type foundation + voice-note/custom-wallpaper/extra-slash plans. Verified compile/build only; needs migration 010 + two accounts to confirm runtime.

## [1.D/1.F polish] Read-dot receipts, desktop centering, appearance preview — 2026-08-27
Status: done (builds clean; **apply migration 009**; two accounts to verify)
What shipped:
- **Read receipts — root cause fixed + redesigned.** The grey-forever-old-messages bug was *data, not logic*: `last_read_at` was nullable/no-backfill and written only by `markRead` (viewer poll), so reads that happened before the read-receipt route existed were never recorded. Fixes: (1) **`saveMessage` now advances the sender's `last_read_at`** to the message's DB `created_at` — replying proves you read the prior messages, and avoids app/DB clock skew; (2) **backfill migration `009_backfill_last_read.sql`** seeds existing members to `now()` (**user applies in Supabase**). Visual: a small **per-message read receipt at the end of my messages**, rendered by mode — **line/terminal mode: a dot** (green filled = seen, hollow = not seen); **bubble mode: WhatsApp ticks** (✓ sent, blue ✓✓ read). "Seen" is gated behind delivered (fixes the audit bug where a still-sending optimistic row could flash blue).
- **Desktop centering.** `.chat` is now a centered `max-width:720px` bordered "app column" (`margin-inline:auto` + `border-inline`), so it no longer hugs the far left on wide monitors. Mobile (<480px) unaffected — the cap is inert; scroll shell (`100dvh`/`min-height:0`/`overscroll`) untouched.
- **Premium preview (temporary, removable).** New `client/src/features/appearancePreview.ts` + an "Appearance" item in the ••• menu: switch **Wallpaper** (off / 1 / 2, self-contained CSS gradients with a contrast scrim) and **Message style** (Line ↔ Instagram-style **Bubbles** — mine right/accent, theirs left, keyed off `data-mine`). Remembered per device via localStorage. To remove later: delete the module, its ChatPage/MenuDropdown wiring, and the `/* PREVIEW */` CSS block.
- **Styling polish:** removed the brittle tick CSS and the duplicate `.chat__nav` rule.
Notes/deviations: Held the optional audit items (clientId-based optimistic dedup + message idempotency index, minor socket re-pin) — available if wanted. Read-marking still means "chat on screen" = seen (mark-all), which is acceptable for a single 1:1 conversation. Verified compile/build only; the read-dot flip and preview need a browser + two accounts (and migration 009) to confirm.

## [1.D polish] Search navigation (highlight + jump) + presence indicator — 2026-08-27
Status: done (client-only, builds clean)
What shipped:
- **Search is now useful** — instead of just opening a box, it highlights every message containing the query (substring, case-insensitive) with `<mark>`, shows a live `n/m` counter, and gives ▲/▼ arrows to jump between matches (▲ older, ▼ newer; Enter / Shift+Enter also step), scrolling each into view and emphasising the current one. Highlighting is built via DOM text nodes (no innerHTML) so message content stays XSS-safe. ✕ clears and closes.
- **Presence indicator** — the nav now shows **"in chat"** (green dot) vs **"away"** (grey dot) for the other person, not just a static "connected". Derived from their `last_read_at` heartbeat: since each side marks-read every ~4s while the chat is on screen, a reading within the last 15s means they're actually here. No new backend route — reuses `otherLastReadAt`.
Notes/deviations: **Presence and "Seen" both depend on the `/connections/:id/read` route being live on Railway.** Production is currently serving a stale backend (the leave + read routes 404), so until the backend is redeployed from `main`, presence will read "away" and ticks stay grey. Code + build verified; this is an infra redeploy, flagged to the user.

## [1.D/1.E polish] Tick placement, working "Seen", leave-flow OK button, in-chat Search — 2026-08-27
Status: done (builds clean; client-only, no migration; two accounts to verify)
What shipped:
- **Tick placement** — ticks sat at the far-right edge of the wide message body; moved them **inline right after the message text** (text is now `display:inline`, tick an inline-block sibling before the hidden full-timestamp). Reads right where the message ends.
- **"Seen" now actually flips to blue** — the receipt logic was correct, but the reader only marked-read on discrete events (connect / incoming socket message / focus), so an already-loaded message often never got marked. Now the reader **marks read continuously while the chat is visible** (poll-driven every 4s, `visibilityState==='visible'`) plus once at mount — self-healing, so the sender's tick reliably goes blue ✓✓. No backend change.
- **Leave flow** — the disabled "Next step available in ~24h" **button** did nothing; it's now **info text** and the action is a working **"OK"** button (advances the countdown when allowed, just returns during the 24h cooldown). Cancel/Keep connection unchanged. The acting user now **sees their own leave line in chat** ("You moved to leave — N days remaining") — leave step tracking moved to `sessionStorage` so the system line survives the navigate-to-Leave-and-back round trip.
- **Search works** — the ••• menu "Search" was inert; it now opens an in-chat search bar that live-filters the log to messages containing the query (date separators + system lines hidden while searching), with a ✕ to close. `mountMenuDropdown` takes an optional `onSearch`; ChatPage owns the filter.
Notes/deviations: Search is a client-side substring filter over loaded history (no server search) — fine for V1's single conversation. Continuous mark-read means while both are viewing, messages read as seen almost immediately (correct — both online + on-screen = seen).

## [1.D polish] WhatsApp-style read ticks (replaces "Seen" text) — 2026-08-26
Status: done (builds clean; needs migration 008 + two accounts to see live)
What shipped: The subtle grey "Seen" text under the last message was too quiet, so replaced it with per-message ticks on your sent messages: dim ✓ while sending, grey ✓ once delivered (saved server-side / echo received), blue ✓✓ once the other person has viewed it (their `last_read_at ≥ the message time`). Ticks live in the message body (right-aligned), recomputed on echo-confirm and on the 4s `/connections/current` poll. No backend change — reuses `otherLastReadAt` from the prior read-receipt work.
Notes/deviations: "Delivered" = reached the server (our model doesn't separately track the other device receiving it), so a single grey tick means saved+broadcast, not a device-level ACK. Removed the old `.chat__seen` element/CSS.

## [1.D/1.E/1.F polish] Instant messaging, read receipts, delete-on-leave, ID rotation, HTML export — 2026-08-26
Status: done (compiles + builds clean; **NOT runtime-tested** — needs migration 008 applied + two accounts)
What shipped:
- **Messaging feels instant** — root cause of the 15-20s first-message delay: the sender only saw their own message when the server's `message:new` echo returned (full round-trip, worst on a cold Railway/Supabase first hit), and `connectMessaging()` was awaited *before* the chat rendered (a flaky first handshake bounced the user to connection-id — the "not going through"). Fix in `ChatPage`: **optimistic local echo** (message renders immediately, dim until the echo confirms, reconciled by content match — no duplicate), chat **renders before the socket connects** (never blocks/bounces), and messages typed pre-connect are **queued and flushed on connect**. Failed sends get a subtle "· not sent" and retry on reconnect.
- **Enter / iOS send** — composer is now a `<form>` with `enterkeyhint="send"`; submit handles both desktop Enter and the iPhone keyboard's Go/Send key (was a manual keydown listener that iOS didn't reliably fire).
- **Read receipts ("Seen")** — subtle "Seen" under your latest message once the other person has viewed it; no ticks, no color-shifting `>` (user rejected that). New `connection_members.last_read_at` (migration `008_last_read.sql` — **apply to Supabase**), `POST /connections/:id/read` (marked on open, on receiving, on window focus), `getCurrentConnection` returns `otherLastReadAt`, "Seen" recomputed on the 4s poll.
- **Delete on termination** — `terminate()` now **deletes the `connections` row** instead of flipping status; `on delete cascade` wipes `connection_members` + `messages`. Both users freed, nothing retained (they export first).
- **Regenerate connection ID** — one-tap "Get a new ID" on the ID screen (`POST /me/connection-code/regenerate`); old ID stops resolving. For when a code gets shared too widely. Never affects an existing connection (those run off user ids).
- **HTML export** — added alongside TXT/JSON: a self-contained, readable left/right-layout HTML document (escaped). `ExportPage` now offers HTML (primary) / TXT / JSON.
Notes/deviations: The 15-20s tail on the *receiver* side (and slow first load) is Railway/Supabase cold-start — code changes make sending feel instant and stop the bounce-out, but a fully warm first receive needs an infra keep-warm (flagged, not done). Read receipts + leave state + termination all ride the single 4s `/connections/current` poll — deliberately kept off the message `Transport` (they're connection state, not messages). Verified compile + build only; needs migration 008 + two accounts to confirm runtime.

## [1.E] Leave/termination lifecycle + mobile scroll fix + nickname placeholder — 2026-08-26
Status: done (compiles + builds clean; **NOT runtime-tested** — needs migration 007 applied + two accounts)
What shipped:
- **Stage E leave lifecycle** — reconciled model confirmed with user, **overrides spec §25's passive auto-expire**: a deliberate, solo-completable **5-step countdown**, one step per 24h (server-gated). Per-member progress on `connection_members.leave_step` / `leave_last_step_at` (migration `007_leave_progress.sql` — **must be applied to Supabase manually**, like prior migrations). Backend `connectionService`: `advanceLeave` (24h-gated; own step→5 terminates solo, no agreement needed), `cancelLeave` (step→0; both cleared ⇒ back to active), `confirmEndLeave` (mutual fast-path when both leaving). Routes: `POST /connections/:id/leave`, `/leave/cancel`, `/leave/confirm-end`. `getCurrentConnection` now returns `myLeaveStep`/`otherLeaveStep`/`daysRemaining`/`bothLeaving`/`canAdvanceLeave` (replaced vestigial `leaveRequestedByMe`/`leaveRequestedAt`).
- **Frontend** — real `LeavePage` (advance / keep / mutual "This conversation is going to end. Do you want to leave it?"). `ChatPage` polls `/connections/current` every 4s: red leave banner ("You're leaving — N days remaining" / "{name} is leaving…" / both-leaving), live in-chat **system lines** on each transition, and auto-routes to connection-id when the connection terminates. Leave stays connection-state (polled), deliberately NOT routed through the message `Transport`.
- **Mobile scroll jank fix** (groundwork before Android): the shell was double-`100vh` (`#app` + `.chat`) with a flex scroll child lacking `min-height:0`, no `overscroll-behavior`, and <16px inputs → page pan + rubber-band + iOS focus-zoom. Fixed in `global.css` (locked non-scrolling shell, `100dvh`, `overscroll-behavior: contain/none`, `min-height:0` on flex scroll containers, 16px inputs on mobile, safe-area input padding) + `viewport-fit=cover`.
- **Nickname placeholder** `Arjun` → `Type a nickname`.
- **Premium features foundation** written into the master plan (Phase 2P): chat wallpapers, custom wallpaper upload, opt-in Instagram-style left/right bubbles — **plan only, not built**, with the cheap V1 seams noted (appearance-prefs model, single message-render path, wallpaper layer). Default stays the §16 no-bubble terminal aesthetic.
Notes/deviations: Design decision recorded — solo exit is the anti-trap guarantee (user picked it over §25 as-written and over strict-mutual). System leave events are shown as live state, NOT persisted message rows (keeps the hot `messages` table/RLS/export untouched) — trade-off: leave events aren't in the export. I can verify compile/build only; the 24h gate, termination, and two-way system lines need the migration applied and a second account to test.

## [1.D + bug fixes] Real-time chat, request-lock, empty chat — 2026-08-26
Status: done (verified end-to-end via real active connection)
What shipped: Stage D real messaging over Socket.IO with the transport abstraction (spec §22): client `services/transport/Transport.ts` (interface) + `InternetTransport.ts` (Socket.IO impl) + `messageService.ts` (factory — the only place that names a concrete transport). Backend: `websocket/socketServer.ts` (JWT-auth handshake, pins the user's live connection server-side, `message:send` → validate membership+state → persist → broadcast `message:new` to the connection room), `services/messageService.ts` (getHistory/saveMessage, re-verifies membership on every write per §20), `routes/messages.ts` (GET history), HTTP server now created explicitly so Socket.IO can attach. `/api/me` and current-connection now return the app `userId`/`myUserId` so the client can tell YOU from the other sender.
Bug fixes from user report: (1) removed all fake seed messages — chat starts empty; (2) send actually sends now (was a no-op) — real bidirectional delivery verified: sent a message, confirmed persist + broadcast echo + history reload; (3) recipient no longer stuck able to fire a duplicate request — ConnectionIdPage now polls and auto-routes to the request/chat screen when connection state changes. Also implemented real TXT/JSON export (was referencing the deleted fake data) and Enter-to-send.
Notes/deviations: Verified against the real active connection left from the user's earlier friend test (my user ↔ ARFAH). Broadcast is `io.to(room).emit`, so the other member receives identically to the sender's own echo (which I confirmed). Message content and nicknames now rendered via textContent (no HTML injection). NOT yet built: Stage E leave/termination is still a UI-only stub — the "Leave connection" menu item shows a fake "request sent" screen and does not actually end the connection server-side. Flagged for the user; it's the next stage.

## [1.B.2 + 1.C] Real database, users, connection system — 2026-08-26
Status: done (pending two-account test)
What shipped: 4 tables live in Supabase (`users`, `connections`, `connection_members`, `messages`) via manual SQL Editor run (direct `db.*.supabase.co` connection is IPv6-only and unreachable from this dev network — `pg`/`migrate.ts` kept for environments that can reach it, e.g. Railway may work; local dev applies migrations manually for now). Single-active-connection enforced by a DB trigger (spec §19), not just app logic. Backend: `database/supabaseAdmin.ts` (service-role client, HTTPS-based — sidesteps the IPv6 issue entirely for runtime queries), `services/userService.ts` (get-or-create user + connection code on first login), `services/connectionService.ts` (request/accept/decline, nickname — nicknames are stored on the *other* member's row since I set what I call them, not what I call myself, per spec §11), routes mounted at `/api/me` and `/api/connections/*`, all behind `requireAuth` (verifies Supabase JWT via `supabaseAdmin.auth.getUser`). Client: `connectionsApi.ts`, real ConnectPage/ConnectionRequestPage/NicknamePage/ChatPage wired to the backend, new WaitingPage (requester's pending view, polls every 2.5s), `main.ts` boot now resolves the real screen from connection state instead of a hardcoded default. Router got a cleanup-callback mechanism so polling pages clear their interval on navigation.
Notes/deviations: Verified end-to-end — real login → real generated Connection ID (`VN9SYUY`) → own-ID rejection → not-found rejection, all through the actual UI, no console errors. Have NOT verified the accept/decline path since it needs a second real account — that's the next thing to test with your friend. `client/package.json`/`backend/package.json` also picked up `@supabase/supabase-js`, `pg`, `cors` from npm installs along the way.

## [1.B.1] Supabase Auth wired (Google OAuth) — 2026-08-26
Status: done
What shipped: `@supabase/supabase-js` client (`services/supabaseClient.ts`), `services/authService.ts` (signInWithGoogle, getSession, onAuthStateChange), LoginPage now triggers real Google OAuth via Supabase instead of faking navigation, `main.ts` checks for an existing session on boot and routes signed-in users past login. Split env files: `client/.env` (VITE_SUPABASE_URL/ANON_KEY) and `backend/.env` (SUPABASE_URL/SERVICE_ROLE_KEY/DATABASE_URL) — removed the old root-level `.env`. Also renamed `server/` → `backend/` to match the Railway project's configured root directory.
Notes/deviations: Verified end-to-end up through Google's real consent screen (correct redirect_uri pointing at Supabase's callback, correct redirect_to back to localhost) — did not complete an actual sign-in myself, since that requires the user's Google credentials. User to test a real login themselves before 1.B.2 (users table + real Connection ID generation) starts, so there's an authenticated user to build against.

## [1.A] Visual prototype (fake data, no backend) — 2026-08-26
Status: done
What shipped: Full click-through prototype — Login, Connection ID (generated fake ID + copy), Connect, Connection Request (accept/decline), Nickname, Chat (date separators, no-bubble line format, color-coded sender names, click-to-expand full timestamp), top-nav ••• menu, Export screen, Leave/termination flow (request + pending state). Router (`state/router.ts`) is a minimal registered-page map, no framework. Design tokens (colors, font) in `styles/global.css`, mobile responsive breakpoint at 480px.
Notes/deviations: Verified by scripting clicks through the full flow and asserting rendered text/DOM state (screenshots from the browser tool were unreliable — cropped past ~1050px of the 1280px viewport, a tool quirk, not confirmed as an app bug via getBoundingClientRect checks). Export TXT/JSON buttons are inert (real export logic is Stage F). Search menu item is disabled (later feature per spec §27).

## [0.2] Client + server tooling init — 2026-08-26
Status: done
What shipped: `client/` — Vite + vanilla TS scaffold (package.json, tsconfig.json, index.html, src/main.ts), boots on `npm run dev` (verified HTTP 200 on :5173). `server/` — Node + TS + Express (package.json, tsconfig.json, src/index.ts with `/health` route), boots on `npm run dev` via tsx watch (verified `{"status":"ok"}` on :3000). `shared/` left empty for now, populated starting Stage B when auth/connection types exist.
Notes/deviations: Kept both minimal — no demo boilerplate (Vite's counter/assets), no Socket.IO yet (belongs to Stage 1.D.1 per plan), no Supabase client wiring yet (Stage B).

## [0.3] Env setup + secrets fix — 2026-08-26
Status: done
What shipped: User provided Supabase credentials. Real secrets had been pasted into `.env.example` (not gitignored) — moved to `.env` (gitignored, confirmed via `git check-ignore`), replaced `.env.example` with placeholder-only template. Never committed/pushed, no rotation needed. GitHub remote confirmed: https://github.com/aarahman04/One-on-One.git. Accent colors picked (YOU #7EE787 green, other #79C0FF cyan, bg #0D1117).
Notes/deviations: Google Cloud OAuth + Railway/Vercel setup deferred to Stage B / Stage H respectively.
(Note: 0.3 was actually completed before 0.2 within this session — env/secrets fix happened first, tooling init followed.)

## [0.1] Project scaffold + CLAUDE.md + docs — 2026-08-26
Status: done
What shipped: Repo directory structure (client/server/shared/database/docs), merged user's CLAUDE.md template with project-specific rules, created this progress log and docs/ARCHITECTURE.md.
Notes/deviations: none.
