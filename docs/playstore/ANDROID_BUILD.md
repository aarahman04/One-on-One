# Android build — Trusted Web Activity (TWA)

Stage 4 of the Google Play packaging plan (`~/.claude/plans/ancient-weaving-raven.md`).
The Android app is the deployed site (`https://one-on-one-mu.vercel.app/`) wrapped
as a **Trusted Web Activity** with **Bubblewrap**. No native code — Chrome renders
the real site and mediates every browser API the app uses (camera, mic, geolocation,
web push via notification delegation).

## What's in the repo

| Path | Purpose | Committed? |
| --- | --- | --- |
| `android/twa-manifest.json` | Bubblewrap config — the single source of truth for the Android build. Hand-authored (no local `bubblewrap init` was run). | yes |
| `android/.gitignore` | Ignores the generated Gradle project (`app/`), build output, and **all** signing material. | yes |
| `.github/workflows/android-build.yml` | Builds the signed `.aab` on a GitHub runner. No local Android toolchain needed. | yes |
| `client/public/.well-known/assetlinks.json` | Digital Asset Links — **placeholder fingerprint** until the first Play upload. | yes |
| `android/app/`, `android/android.keystore`, `*.aab` | Generated / secret — never committed. | no |

## Prerequisites

1. **The Stage 3 frontend must be live** at `https://one-on-one-mu.vercel.app/`
   — Bubblewrap and Play both fetch `/manifest.webmanifest` and the icons.
   Deploy the `feat/playstore-stage1-compliance` branch (or merge it) first and
   confirm:
   - `https://one-on-one-mu.vercel.app/manifest.webmanifest` → the Stage 3 manifest
   - `https://one-on-one-mu.vercel.app/icons/icon-512.png` → 200
   - `https://one-on-one-mu.vercel.app/.well-known/assetlinks.json` → 200, `application/json`

## twa-manifest.json — key fields

| Field | Value | Why |
| --- | --- | --- |
| `packageId` | `app.web.oneonone` | Stage 0 decision. **Immutable after first Play upload.** |
| `host` / `fullScopeUrl` | `one-on-one-mu.vercel.app` | The Vercel prod URL. A custom domain later = change this + `assetlinks.json` + Vercel domain + rebuild. |
| `startUrl` | `/?src=twa` | Matches the web manifest; lets the site tell TWA launches apart. |
| `display` | `standalone` | Full-screen, no browser chrome (once Asset Links verify). |
| `orientation` | `portrait` | Chat app; matches the web manifest. |
| `themeColor` / `backgroundColor` | `#0d1117` | Brand dark; matches the web manifest and the splash. |
| `enableNotifications` | `true` | Chrome notification delegation forwards the existing web push to the Android notification channel. Adds `POST_NOTIFICATIONS` (Android 13+). |
| `fallbackType` | `customtabs` | If Asset Links don't verify, open in a Custom Tab (with an address bar) rather than a raw WebView. |
| `minSdkVersion` | `21` | Android 5.0. |
| `splashScreenFadeOutDuration` | `300` | Milliseconds. Required key in Bubblewrap's manifest schema — omitting it makes the generated `build.gradle` unparseable. |
| `appVersion` | `1.0.0` | The schema key is `appVersion` (Bubblewrap maps it to the `appVersionName` class field / Gradle `versionName`). The CI workflow overwrites this from its `versionName` input. |
| `signingKey.path` | `./android.keystore` | The **upload** key. Play App Signing holds the real distribution key. |

`targetSdkVersion` and `compileSdkVersion` are hardcoded to `36` (Android 16) in
Bubblewrap 1.25.0's Gradle template — comfortably inside Google Play's "within one
year of the latest release" rule. Nothing to pin here; the `Verify generated
Gradle` CI step prints the emitted values.

Manifest permissions: `INTERNET` + `POST_NOTIFICATIONS` only. Camera / mic /
location are Chrome-mediated runtime grants, **not** app manifest permissions —
nothing to declare or justify for those in the manifest itself (the in-app
rationale modals from Stage 1 cover the Play "prominent disclosure" rule).

---

## Path A — build in CI (recommended)

No local JDK / Android SDK. `.github/workflows/android-build.yml`, run from the
Actions tab (`workflow_dispatch`).

### First run — generate the upload keystore

1. Run the workflow with **no secrets set**.
2. It generates `android.keystore`, prints the store + key passwords to the
   **job summary**, and uploads `android.keystore` as a 1-day artifact.
3. Download the artifact. Then add three repo secrets
   (Settings → Secrets and variables → Actions):
   | Secret | Value |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | `base64 -w0 android.keystore` |
   | `ANDROID_KEYSTORE_PASSWORD` | store password from the job summary |
   | `ANDROID_KEY_PASSWORD` | key password from the job summary |
4. **Back up `android.keystore` + both passwords somewhere safe** (password
   manager). Losing the upload key is recoverable via Google (reset upload key),
   but keep it anyway.

### Every later run

Reuses the keystore from the secrets. Inputs: `versionCode` (must strictly
increase per Play upload) and `versionName`. Output: the `android-release`
artifact containing `app-release-bundle.aab` → upload that to Play.

### `bubblewrap update` on the bare project

Confirmed working — the workflow's "Generate Android project from twa-manifest.json"
step (`bubblewrap update`) scaffolds the full Gradle project from the committed
`twa-manifest.json` alone, no prior `init` and no committed Gradle files needed
(run 34351166418, Bubblewrap 1.25.0).

---

## Path B — build locally

Needs **JDK 17** and the **Android SDK** (or let Bubblewrap install its own copies
on first run — it prompts).

```bash
npm install -g @bubblewrap/cli
cd android
# Fetches the web manifest and scaffolds the Gradle project. Answer the prompts
# to match twa-manifest.json (package app.web.oneonone, name "One on One",
# start URL /?src=twa, portrait, colors #0d1117, notifications yes).
bubblewrap init --manifest https://one-on-one-mu.vercel.app/manifest.webmanifest

# If init overwrote twa-manifest.json, restore this repo's version and re-sync:
git checkout twa-manifest.json
bubblewrap update

bubblewrap doctor        # must be clean
bubblewrap build         # prompts for keystore location + passwords on first run
```

Produces `app-release-bundle.aab` (upload to Play) and `app-release-signed.apk`
(for `bubblewrap install` onto a device/emulator).

---

## Digital Asset Links — the ordering dance

The TWA only goes full-screen (no address bar) once
`https://one-on-one-mu.vercel.app/.well-known/assetlinks.json` lists the SHA-256
of the signing key **Play** uses. That fingerprint doesn't exist until after the
first upload:

1. Build the `.aab` (Path A or B) with the placeholder `assetlinks.json` still live.
2. In Play Console → create the app → **App integrity** → opt into **Play App
   Signing** → upload the `.aab` to a **Closed testing** track.
3. Play Console → **App integrity** → **App signing key certificate** → copy the
   **SHA-256 certificate fingerprint**.
4. Put it in `client/public/.well-known/assetlinks.json` (replace the all-zero
   placeholder), commit, redeploy the frontend.
5. Confirm `curl https://one-on-one-mu.vercel.app/.well-known/assetlinks.json`
   shows the real fingerprint.
6. Reinstall the app on a device — it now opens full-screen with no URL bar.
   (Also add that same fingerprint under `fingerprints` in `twa-manifest.json`
   if you want `bubblewrap` to embed it for local verification.)

Interim check before step 3: `bubblewrap install` and the app opens the site in a
Custom Tab **with** an address bar = wiring is correct, fingerprint pending.

## Verify (Stage 4 exit)

- [ ] `android/twa-manifest.json` parses; `host` = `one-on-one-mu.vercel.app`.
- [ ] Frontend live at that host with the Stage 3 manifest + icons + assetlinks.
- [ ] CI workflow runs green through `bubblewrap build`; `android-release`
      artifact contains `app-release-bundle.aab`.
- [ ] `bubblewrap doctor` clean (in CI logs or locally).
- [ ] (device, optional) `bubblewrap install` → site loads; address bar present
      until the real fingerprint is live.
