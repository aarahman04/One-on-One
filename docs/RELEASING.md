# Releasing One on One

This is the runbook for shipping updates to the app after the initial
Capacitor migration (Stages 1–7). It assumes you can already run the app
locally but haven't done an Android release before. For low-level build
internals (what's in `android/`, signing details, CI steps) see
`docs/playstore/ANDROID_BUILD.md` — this file is the procedure, that file is
the reference.

---

## 1. How the pieces fit

- **Web client** (`client/`) — hosted on Vercel, auto-deploys from `main`.
  Users on a browser or the installed PWA get changes the moment `main`
  deploys.
- **Backend** (`backend/`) — hosted on Railway. Railway's deploy branch is
  set in the Railway dashboard, not in this repo. Users get backend changes
  the moment Railway deploys — no app update needed, native included.
- **Native Android app** (`android/`) — a Capacitor WebView shell around a
  **snapshot** of `client/dist`, baked in at build time. It talks to whatever
  backend URL is in `client/.env.production`
  (`https://one-on-one-production-a5b8.up.railway.app`), not to your Vercel
  deploy.

> **The one thing to internalize:** a change to `client/` reaches Android
> users **only** when you build a new AAB and roll it out through Play. A
> change to `backend/` reaches every user, web and native, as soon as Railway
> deploys — no Play release required.

## 2. Make a change and test it

### Web (fastest loop)

```bash
cd backend && npm run dev     # tsx watch, reads backend/.env
cd client && npm run dev      # Vite dev server
```

Open the Vite URL in a browser. This is mode `development` — it never reads
`client/.env.production`, only `client/.env`.

### Native, on a device (debug build)

Prerequisites, once: Android Studio installed; JDK 21 (Android Studio ships
one — point `JAVA_HOME` at `Android Studio\jbr`); `android/local.properties`
has `sdk.dir` set; a device with USB debugging on, or an emulator.

```bash
cd client
npm ci
npm run build          # needs client/.env with VITE_SUPABASE_URL / _ANON_KEY
npx cap sync android
```

Then either open `android/` in Android Studio and hit Run, or:

```bash
cd android
./gradlew installDebug
```

**The debug build talks to the deployed Railway backend** (via
`client/.env.production`), not to your local backend. If you're testing a
backend change natively, deploy it (or repoint Railway's dashboard branch)
first — there's no way to point a native build at `localhost`.

Rules that save you a debugging session:
- **Always `npx cap sync android` after any `client/` change** (or a
  Capacitor/plugin dependency bump) before building native. Forgetting this
  is the #1 cause of "I made the change but the app doesn't show it" — the
  native project has its own copy of the web assets
  (`android/app/src/main/assets/public`) that only `cap sync` refreshes.
- **Uninstall before switching between debug and release builds**:
  `adb uninstall app.web.oneonone`. They're signed with different keys, so
  Android refuses to install one over the other.
- What to actually check on-device after a change, depending on what you
  touched: Google sign-in still works; send/receive a message with the app
  **backgrounded** (not just foreground); make a call; run `/location`. For
  anything touching legal/compliance surfaces, also run the checks in
  `docs/playstore/PUBLISH_CHECKLIST.md` section B.

## 3. Versioning — read this before every upload

Every Android release is identified by two numbers, both supplied as inputs
to the CI workflow — **neither is stored anywhere in the repo**:

- **`versionCode`** — a plain integer. **Google Play requires every upload to
  have a `versionCode` strictly greater than every `versionCode` ever
  uploaded for this app, on any track, ever.** Re-uploading the same number,
  or a lower one, is rejected outright with an error like "Version code 1 has
  already been used". There's no way to reuse a number once it's gone to
  Play, even if you delete the release.
  - The CI workflow's input defaults to `"1"`. If you run the workflow twice
    without changing that input, the second AAB will be byte-different but
    carry the *same* `versionCode`, and Play will reject the second upload.
    **You must supply a new number by hand, every time.**
  - The rule: **increment by at least 1 per upload.** Gaps are fine (1, 2,
    5, 6 is legal); going backward or repeating is not.
- **`versionName`** — a human-readable string (`"1.0.0"`, `"1.1.0"`, ...).
  Play does not validate or compare it; it's just what's shown to users in
  the Play Store listing. Bump it however you like (semver is a reasonable
  default), but it does **not** substitute for incrementing `versionCode`.

### Version history

Keep this table current — it's the only record of what `versionCode` you
used last, since the number lives only in a GitHub Actions input box.
**Append a row every time you run the workflow for an upload** (not for a
throwaway test build):

| versionCode | versionName | date | git SHA | track | notes |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0.0 | (pending) | | closed testing | first upload |

### `targetSdkVersion`

`android/variables.gradle` currently pins `compileSdkVersion` and
`targetSdkVersion` to `36`. Play enforces a yearly minimum target API level
for new uploads — if Play Console warns that your `targetSdkVersion` is too
low, bumping it is a real code change (test the whole app again, not just a
version bump) — do it deliberately, not as a rubber-stamp.

## 4. Build the release (CI)

GitHub → **Actions** tab → **android-build** workflow → **Run workflow** →
branch `main` → fill in `versionCode` (the next number from your table above)
and `versionName` → Run.

Takes a few minutes. When it finishes green, download the `android-release`
artifact and unzip it — you get:

- `app-release.aab` — upload this to Play Console.
- `app-release.apk` — for sideloading onto a real device to sanity-check
  before you upload.

What "green" means, concretely — check the job log for:
- `SHA1: 36:A9:69:D6:10:20:E0:7E:33:79:9F:0C:04:CE:F5:1A:63:BB:90:C6` appearing
  **twice** (once for the restored keystore, once for the signed output).
- A `package:` line from `aapt2 dump badging` showing
  `versionCode='<the number you typed>' versionName='<what you typed>'`.

If the run fails at the **secret check** step, the log names exactly which
repo secret is empty (Settings → Secrets and variables → Actions to fix it).
Needed secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_PASSWORD`, `GOOGLE_SERVICES_JSON_BASE64`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`.

If CI is unavailable, `docs/playstore/ANDROID_BUILD.md` "Path B" covers
building locally with a copy of the keystore — treat it as a fallback, not
the normal path.

## 5. Sideload-test before uploading

```bash
adb uninstall app.web.oneonone   # if the debug build is installed
adb install app-release.apk
```

Sign in with Google. From the other test account, send a message while this
app is **swiped away from recents** (not just backgrounded, not
force-stopped) — a notification should still arrive. Make a call. Only once
this passes, upload the `.aab`.

## 6. Upload to Play Console

### First time only

1. Play Console → **Create app** → name **One on One**, Free, en-US.
2. **App integrity** → opt into **Play App Signing**, uploading with our
   `oneonone-upload` key (this happens automatically the first time you
   upload an `.aab` signed with it).
3. Immediately after that first upload: Play Console → **App integrity** →
   **App signing key certificate** → copy the **SHA-1** shown there. This is
   a *different* key from our upload key — Play re-signs the app for
   distribution with its own key. Go to Google Cloud Console (project
   `one-on-one-508202`) → Credentials → create **another** Android OAuth
   client: package `app.web.oneonone`, that SHA-1. This is the **third**
   Android OAuth client for this app (see §8 below). **Do this before any
   tester installs from Play** — otherwise every Play-installed copy fails
   Google Sign-In with `[16] Account reauth failed`.

### Every release

Play Console → your app → **Testing → Closed testing** (or **Production**
once you're past testing) → **Create new release** → upload the `.aab` →
write release notes → Review → Roll out. Play will show you the
`versionCode` it parsed from the upload — confirm it matches what you
intended before rolling out.

Promotion path: closed testing with **20+ testers for 14 continuous days**
(a personal Play account requirement) → then Production. Full checklist:
`docs/playstore/PUBLISH_CHECKLIST.md` sections F and G.

## 7. Never change these

| Item | Why | What breaks if you do |
| --- | --- | --- |
| Package name `app.web.oneonone` | This is the app's identity to Play, Firebase, and every OAuth client. | A different package name is a **new app** to Play — existing users never receive it as an update; they'd have to find and install a separate listing. |
| The `oneonone-upload` keystore (secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`) | Play only accepts uploads signed with the upload key it has on file for this app. | Play Console **rejects** an AAB signed with any other key outright. Play App Signing does support a formal upload-key reset via a support request, but it's a slow manual process — avoid ever needing it. Keep the offline keystore backup and the passwords in `docs/_playstore-inputs.md` safe; they exist nowhere else if the repo secret is lost. |
| `EXPECTED_UPLOAD_KEY_SHA1` / `EXPECTED_UPLOAD_KEY_SHA256` in `.github/workflows/android-build.yml` | These deliberately fail the build if the wrong keystore ever gets restored from secrets. | If this assertion ever fails, the fix is to fix *which keystore secret is loaded*, never to loosen or remove the assertion. |
| The Firebase Android app / `google-services.json` (secret `GOOGLE_SERVICES_JSON_BASE64`) | FCM registration tokens are tied to this specific Firebase app registration. | Re-creating the Firebase Android app (rather than reusing the existing one) invalidates every device's existing push token — all installed users stop getting push until they reopen the app and re-register. |

## 8. Things that must stay registered / valid

- **Three Android OAuth clients**, all in GCP project `one-on-one-508202`,
  package `app.web.oneonone`, and all must remain registered simultaneously:
  1. Debug keystore SHA-1 (`ED:02:08:A3:38:18:A4:18:40:AC:EF:D9:BD:C2:B2:0C:ED:37:55:9D`)
     — per developer machine. **A new machine has a new
     `~/.android/debug.keystore`** (different SHA-1) — register it as another
     client, or debug builds on that machine fail sign-in.
  2. Upload keystore SHA-1 (`36:A9:69:D6:10:20:E0:7E:33:79:9F:0C:04:CE:F5:1A:63:BB:90:C6`)
     — used for CI-built AABs/APKs, including the sideload APK.
  3. Play App Signing key SHA-1 — added once, after the first Play upload
     (§6). Used for anything actually installed from the Play Store.

  Symptom table — if Google Sign-In gives `[16] Account reauth failed`:

  | Which build fails | Which client is missing |
  | --- | --- |
  | `./gradlew installDebug` from Android Studio | client #1 (debug) |
  | Sideloaded `app-release.apk` | client #2 (upload) |
  | Installed from Play (any track) | client #3 (Play App Signing) |

- **`FIREBASE_SERVICE_ACCOUNT`** on Railway — the entire Firebase
  service-account JSON, on one line, not just the private key. (This broke
  once: a PEM-only value silently disabled FCM with no per-send error at the
  time.) After any rotation, replace the whole JSON blob. Confirm it's valid
  from Railway's boot log: `fcm: configured for project one-on-one-508202`.
  If a send ever logs `fcm: skipped for user … — FIREBASE_SERVICE_ACCOUNT not
  usable`, this is broken again.
- **`GOOGLE_SERVICES_JSON_BASE64`** repo secret — the build *succeeds*
  without it, but push notifications are silently disabled in that APK. Not
  a hard failure, so it's easy to miss.
- **`VITE_SUPABASE_URL`** / **`VITE_SUPABASE_ANON_KEY`** repo secrets — the
  web bundle throws at launch without them.
- **`client/.env.production`**'s `VITE_API_URL`** — if the Railway backend
  domain ever changes, edit this file and rebuild; also update the backend's
  `CLIENT_ORIGIN` and the CSP `connect-src` allowlist in both
  `client/index.html` and `client/vercel.json`.
- **Railway's deploy branch** is set only in the Railway dashboard, not in
  this repo — a native build always talks to whatever Railway currently
  serves, regardless of what branch you're testing locally.
- The **Web OAuth client** behind `VITE_GOOGLE_WEB_CLIENT_ID` (with a
  hardcoded fallback in `nativeGoogleAuth.ts`) — native sign-in exchanges the
  Google ID token against this client; don't delete it.
- Supabase's Google auth provider configuration — unrelated to the Android
  OAuth clients above, but also required for sign-in to work at all.
- Keep the **version history table** in §3 up to date — it's the only place
  the next `versionCode` is tracked.

### Device / OEM testing notes

- On **MIUI/Xiaomi**, the app needs **Autostart** enabled and battery saver
  set to **No restrictions**, or the OS freezes it and FCM never arrives.
- **"Force stop"** in Android's App Info blocks all FCM delivery on every OEM
  until the app is manually relaunched — this is not a bug, it's expected.
  "Fully killed" for testing purposes means **swiped away from recents**, not
  force-stopped.
- All migration testing was done on a physical **Xiaomi 22111317I, Android
  14**. An emulator is fine for UI work but cannot reliably validate push
  delivery — use a real device for that.

### Dependency upgrades

Bumping `@capacitor/*` or `@capgo/capacitor-social-login` major versions can
rewrite generated files under `android/`. After any such bump: `npx cap sync
android`, diff `android/` for unexpected changes, rebuild, and do a full
device retest (sign-in, push, calls) — don't assume a dependency bump is
docs-free.

`minifyEnabled false` in `android/app/build.gradle` is deliberate, not an
oversight — turning on R8/ProGuard would need keep rules written for the
social-login plugin, plus a full sign-in retest, before it's safe to enable.

## 9. Quick reference

```
1. Make your client/ or backend/ change, test locally (§2).
2. Backend-only change? Deploy it (Railway) — you're done, no Play release needed.
3. Client change, want it on Android? Continue below.
4. Pick the next versionCode from the table in §3. Increment — never reuse.
5. Actions → android-build → Run workflow → main → versionCode, versionName.
6. Download android-release artifact → app-release.aab, app-release.apk.
7. adb uninstall app.web.oneonone && adb install app-release.apk → sign in,
   backgrounded push, a call.
8. Play Console → your track → Create new release → upload the .aab → roll out.
9. Append a row to the version history table in §3.
```
