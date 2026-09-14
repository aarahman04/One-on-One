# Play Store publish checklist

The ordered list of steps **only you** can do (Play Console + credentials +
device). Everything feeding these was produced by the Play Store prep
(Stages 1–5, 2026-09-09) and the Capacitor migration (Stages 1–7,
2026-09-10..14). Plan: `~/.claude/plans/pr-63-is-merged-radiant-dragon.md`.
Day-to-day release procedure (versioning, CI build, upload): `docs/RELEASING.md`.

## A. Start now — these gate everything and can take days

- [ ] Register a **Google Play Console** developer account ($25).
- [ ] Complete **identity verification** (ID, address, phone). Personal account.
- [ ] Create **two Google test accounts** (for the reviewer and your own testing).
- [ ] (Optional, deferred) Buy a custom domain. Not required — the app ships on
      `one-on-one-mu.vercel.app`. A later swap = Vercel domain + backend
      `CLIENT_ORIGIN` + `client/.env.production` `VITE_API_URL` (if the backend
      moves too) + rebuild.

## B. Get the web app live and correct

- [ ] `main` auto-deploys to Vercel production (`one-on-one-mu.vercel.app`);
      confirm the latest `main` deploy succeeded.
- [ ] Confirm the DB migrations are applied: **030 + 031 done (2026-09-09)**.
- [ ] Railway is deploying the branch you expect (dashboard setting, not in
      the repo) and `FIREBASE_SERVICE_ACCOUNT` is the full service-account
      JSON (boot log shows `fcm: configured for project …`).
- [ ] Verify in a browser:
  - [ ] `/privacy`, `/terms`, `/child-safety`, `/delete-account` all render,
        signed-out, light and dark.
  - [ ] `/manifest.webmanifest` is the Stage 3 manifest; `/icons/icon-512.png`,
        `/offline.html` return 200. (`/.well-known/assetlinks.json` is dormant
        since the Capacitor migration — no longer a gate.)
  - [ ] Two-account pass: block ends the chat and prevents reconnect; delete
        account removes the row and signs out; report captures the reported
        person + category; DOB in 2010 → dead-end; permission rationale modals
        fire once per session.
  - [ ] `offline.html` renders with the network disabled.

## C. Build the Android App Bundle

See `docs/playstore/ANDROID_BUILD.md` for detail.

- [ ] Pick the next `versionCode` from the Version history table in
      `docs/RELEASING.md` (first upload = `1`, `versionName` `1.0.0`); append
      the row after the run.
- [ ] Repo secrets present: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
      `ANDROID_KEY_PASSWORD` (existing, unchanged — the `oneonone-upload` key),
      plus `GOOGLE_SERVICES_JSON_BASE64`, `VITE_SUPABASE_URL`,
      `VITE_SUPABASE_ANON_KEY`.
- [ ] Run `.github/workflows/android-build.yml` (Actions → *Run workflow*) with
      the next `versionCode` → job log shows signer
      `SHA1: 36:A9:69:D6:10:20:E0:7E:33:79:9F:0C:04:CE:F5:1A:63:BB:90:C6` for
      both the AAB and APK → download `android-release`.
- [ ] Sideload `app-release.apk` on a device (uninstall the debug build first):
      Google sign-in works, a push arrives while backgrounded.
- [ ] Push arrives on the release APK with the app **swiped from recents**
      (not force-stopped) — still owed from Stage 6.

## D. Create the app in Play Console

- [ ] Create app: name **One on One**, **Free**, default language en-US.
- [ ] **App integrity** → opt into **Play App Signing** → upload the `.aab` to a
      **Closed testing** track.
- [ ] Copy the **SHA-1** from App integrity → **App signing key certificate** →
      Google Cloud Console project `one-on-one-508202` → add a second **Android**
      OAuth client (package `app.web.oneonone`, that SHA-1) — the **third**
      Android client (see `docs/RELEASING.md` "Google OAuth clients"). Additive;
      keep the existing clients. Without it native Google sign-in fails on
      Play installs.
- [ ] Install from the Closed-testing track on a device: sign-in works, push
      arrives.

## E. Fill the Play Console content sections

- [ ] **Privacy policy URL:** `https://one-on-one-mu.vercel.app/privacy`
- [ ] **Data safety:** transcribe `docs/playstore/DATA_SAFETY.md`.
- [ ] **Content rating:** run the IARC questionnaire per
      `docs/playstore/CONTENT_RATING.md`.
- [ ] **Target audience and content:** 18+.
- [ ] **Child safety standards** self-certification: use the published
      `/child-safety` page; child-safety contact **Ahmed Abdul Rahman —
      aarahman803@gmail.com**.
- [ ] **App access:** "restricted" + paste `docs/playstore/REVIEWER_NOTES.md`
      with the two demo-account credentials filled in.
- [ ] **Ads:** No. **News app:** No. **COVID-19 app:** No.
- [ ] **Store listing:** text + graphics from `docs/playstore/STORE_LISTING.md`;
      2–8 phone screenshots from `docs/playstore/screenshots/`.

## F. Closed testing (personal-account rule)

- [ ] Add **20+ testers**; send them the opt-in URL; confirm they actually
      install.
- [ ] Keep the closed track running **14 continuous days**.

## G. Production

- [ ] After 14 days + Google's checks pass, promote to **Production** and submit
      for review.
- [ ] Check the **pre-launch report** on the closed track — no crashes / policy
      flags.

## H. Housekeeping (low urgency)

- [ ] Rotate the `VERCEL_OIDC_TOKEN` in `.env.local` if desired.
- [ ] Install `gitleaks` locally (still owed from the Aug security audit).
- [ ] If you switch dev machines, register the new
      `~/.android/debug.keystore` SHA-1 as another Android OAuth client
      (`docs/RELEASING.md`).
