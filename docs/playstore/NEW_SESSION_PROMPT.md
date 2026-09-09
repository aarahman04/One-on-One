# New-session handoff — Google Play / TWA packaging

Paste this into a fresh session to resume. The plan is **fully implemented in
code**; what remains is user Play Console work, a few deferred verifications, and
one code paste-back (the real signing fingerprint).

---

## Prompt to paste

> Resume the Google Play / TWA packaging work for One-on-One. All 6 stages are
> implemented — plan `~/.claude/plans/ancient-weaving-raven.md`, status in
> `docs/PROGRESS.md` (top 6 entries = Stages 0–5 + this handoff). Read `CLAUDE.md`,
> `docs/ARCHITECTURE.md` ("PWA / TWA packaging" section), `docs/_playstore-inputs.md`
> (gitignored), and everything under `docs/playstore/`.
>
> **Decided, do not re-litigate:** TWA via Bubblewrap; 18+ age gate; full
> `blocks`-table block; personal Play account (20 testers × 14 days closed);
> host `one-on-one-mu.vercel.app` (no custom domain yet); CI generates the
> upload keystore.
>
> **State:** Stages 1–5 are three PRs against `main` (PR-A Stage 1, PR-B Stage 2,
> PR-C Stages 3–5). Migrations 030 + 031 are applied to the live DB.
>
> **Likely tasks this session (ask which):**
> 1. After the user uploads the first AAB: take the Play App Signing SHA-256 and
>    replace the all-zero placeholder in
>    `client/public/.well-known/assetlinks.json` (and optionally add it to
>    `android/twa-manifest.json` `fingerprints`), commit, confirm redeploy.
> 2. Tighten `client/vercel.json` CSP `connect-src` from the `*.supabase.co` /
>    `*.railway.app` wildcards to the exact backend origin, and verify OAuth +
>    sockets + calls still work on a preview deploy.
> 3. Run `npx @bubblewrap/cli validate --manifest https://one-on-one-mu.vercel.app/manifest.webmanifest`
>    (or PWABuilder) against the deployed manifest; fix any blocking issue.
> 4. Help debug the `.github/workflows/android-build.yml` first run (the
>    `bubblewrap update` vs `init` question, Android SDK licensing).
> 5. Add a `screenshots` array to `client/public/manifest.webmanifest` once the
>    user has real phone captures in `docs/playstore/screenshots/`.
> 6. Polish `docs/playstore/STORE_LISTING.md` copy / the `docs/playstore/CONTENT_RATING.md`
>    answers with the user.
>
> **Ground rules (`CLAUDE.md`):** surgical changes, simplest thing that works,
> match existing style, state assumptions, verify before claiming done. Do NOT
> touch anything needing the user's Play Console / Google account / device.

---

## What is done (committed on the three PRs)

| Stage | PR | Contents |
| --- | --- | --- |
| 1 — compliance code | PR-A | `blocks` table (migration 030) + `blockService` + `blockAndTerminate`; `DELETE /api/me` account deletion; report hardening (migration 031: `reported_user_id`, `category`); `npm run reports:review` + `docs/MODERATION.md`; 18+ DOB + Terms gate; permission-rationale modals; EXIF strip on non-GIF images. |
| 2 — legal pages | PR-B | `/privacy` `/terms` `/child-safety` `/delete-account` routes (`legalShared.ts`) + `client/public/legal/*.html` standalone mirrors; links from Login, age gate, chat menu. |
| 3 — PWA manifest / icons / SW | PR-C | Rewritten `manifest.webmanifest`; `scripts/gen-icons.mjs` + `scripts/vendor-fonts.mjs`; self-hosted fonts; `sw.js` offline fallback + `offline.html`; `client/public/.well-known/assetlinks.json` (placeholder fingerprint); `client/vercel.json` (SPA rewrite + security headers + CSP); Node pinned 24. |
| 4 — Android project | PR-C | `android/twa-manifest.json` (hand-authored); `android/.gitignore`; `.github/workflows/android-build.yml`; `docs/playstore/ANDROID_BUILD.md`. |
| 5 — console package | PR-C | `docs/playstore/{DATA_SAFETY,CONTENT_RATING,STORE_LISTING,REVIEWER_NOTES,PUBLISH_CHECKLIST}.md`; `scripts/shoot-screenshots.mjs` + `screenshots/README.md`. |

## Deferred / unverified (carry forward)

- **Not runtime-verified on a deploy:** Stages 1–3. Owed: two-account pass
  (block / delete / report / age gate / rationale modals); `bubblewrap validate`
  + Lighthouse on the deployed manifest; `offline.html` with the network off;
  CSP against a live browser (OAuth, sockets, TURN).
- **`assetlinks.json` fingerprint** is an all-zero placeholder until the first
  Play upload.
- **`android/` has no Gradle project** — CI's `bubblewrap update` generates it;
  the workflow has never run.
- **Screenshots** not captured (OAuth wall — user does it).
- **Store copy + IARC answers** are a first pass for the user to finalise.
- `targetSdkVersion` not pinned in `twa-manifest.json` — verify Bubblewrap's
  default meets Play's one-year rule at build time.

## User's remaining steps

`docs/playstore/PUBLISH_CHECKLIST.md` is the ordered list (register + verify
identity → deploy + browser-verify → build AAB via CI → Play App Signing +
assetlinks swap → fill Data Safety / Content Rating / Target audience 18+ / Child
safety / App access / Store listing → 20 testers × 14 days closed → production).
