# Play Store publish checklist

The ordered list of steps **only you** can do (Play Console + credentials +
device). Everything feeding these was produced in Stages 1–5. Plan:
`~/.claude/plans/ancient-weaving-raven.md` Part 5.

## A. Start now — these gate everything and can take days

- [ ] Register a **Google Play Console** developer account ($25).
- [ ] Complete **identity verification** (ID, address, phone). Personal account.
- [ ] Create **two Google test accounts** (for the reviewer and your own testing).
- [ ] (Optional, deferred) Buy a custom domain. Not required — the app ships on
      `one-on-one-mu.vercel.app`. A later swap = update `assetlinks.json` +
      `android/twa-manifest.json` `host` + Vercel domain + rebuild.

## B. Get the web app live and correct

- [ ] Merge / deploy the `feat/playstore-stage1-compliance` branch to Vercel
      production (`one-on-one-mu.vercel.app`).
- [ ] Confirm the DB migrations are applied: **030 + 031 done (2026-09-09)**.
- [ ] Verify in a browser:
  - [ ] `/privacy`, `/terms`, `/child-safety`, `/delete-account` all render,
        signed-out, light and dark.
  - [ ] `/manifest.webmanifest` is the Stage 3 manifest; `/icons/icon-512.png`,
        `/offline.html`, `/.well-known/assetlinks.json` all return 200
        (assetlinks as `application/json`).
  - [ ] Two-account pass: block ends the chat and prevents reconnect; delete
        account removes the row and signs out; report captures the reported
        person + category; DOB in 2010 → dead-end; permission rationale modals
        fire once per session.
  - [ ] `npx @bubblewrap/cli validate --manifest https://one-on-one-mu.vercel.app/manifest.webmanifest`
        (or a PWABuilder report) — no blocking errors.
  - [ ] `offline.html` renders with the network disabled.

## C. Build the Android App Bundle

See `docs/playstore/ANDROID_BUILD.md` for detail.

- [ ] Run `.github/workflows/android-build.yml` once with no secrets → download
      the `android-keystore` artifact, copy the passwords from the job summary.
- [ ] Add repo secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
      `ANDROID_KEY_PASSWORD`. Back up the keystore + passwords offline.
- [ ] Re-run the workflow → download `app-release-bundle.aab`.

## D. Create the app in Play Console

- [ ] Create app: name **One on One**, **Free**, default language en-US.
- [ ] **App integrity** → opt into **Play App Signing** → upload the `.aab` to a
      **Closed testing** track.
- [ ] Copy the **SHA-256 certificate fingerprint** from App signing key
      certificate → replace the placeholder in
      `client/public/.well-known/assetlinks.json` → commit → redeploy → confirm
      `curl https://one-on-one-mu.vercel.app/.well-known/assetlinks.json` shows it.
- [ ] Reinstall on a device: the TWA opens full-screen with **no address bar**.

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
