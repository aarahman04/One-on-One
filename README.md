# One on One

Private 1:1 messaging app. One account. One active connection. One person. One conversation.

No contacts, no groups, no feed — just one connection, reached only through Google sign-in.

## Features

- Real-time text chat with replies and emoji reactions
- WhatsApp-style read/delivery receipts (sent / delivered / read)
- Image, file, and voice-note attachments (EXIF stripped from images)
- Slash commands: `/letter`, `/countdown`, `/checkin`, `/ask`, `/thisorthat`, `/alarm`, `/location`
- Audio and video calls (WebRTC peer-to-peer, TURN relay fallback)
- Push notifications (Web Push on the web app, FCM on Android)
- Shared wallpaper and light/dark theme
- Block, report, and a documented moderation process (`docs/MODERATION.md`)
- Solo-completable 5-step leave/termination countdown, with TXT/JSON/HTML export
- Account deletion, an 18+ age gate, and public legal pages (privacy, terms, child safety)

Reactions, `/letter`, and calling are deliberate, user-confirmed overrides of the
original V1 non-goals list — see `docs/ARCHITECTURE.md`.

## Architecture at a glance

- **`client/`** — TypeScript SPA (Vite), hosted on Vercel.
- **`backend/`** — Node + Express + Socket.IO, hosted on Railway.
- **Supabase** — Auth (Google OAuth) + Postgres. Row Level Security is default-deny;
  the backend uses the service-role key and is the only thing that talks to the
  database directly.
- **`android/`** — a Capacitor 8 WebView shell wrapping the same web client, for
  the Google Play release.

Messages are encrypted at rest (AES-256-GCM) — this is *not* end-to-end encryption;
see `docs/DECISIONS-encryption-at-rest.md`. All message and call traffic goes
through a `MessageService → Transport → InternetTransport` abstraction so a future
Bluetooth transport doesn't require a rewrite (spec §22).

Full diagrams and detail: `docs/ARCHITECTURE.md`.

## Repo structure

```
client/     Vite + TypeScript web frontend
backend/    Node + Express + Socket.IO backend (Railway root dir)
android/    Capacitor Android shell (Gradle project)
database/   Migrations (raw SQL, applied via backend `npm run migrate`)
scripts/    Icon/font generation, screenshot capture, repo hygiene checks
docs/       Architecture, progress log, release runbook, Play Store material
```

## Build and ship the Android app

Release builds are signed and built by `.github/workflows/android-build.yml`
(manual trigger), using the committed `oneonone-upload` signing key. The full
runbook — versioning, sideload testing, and the Play Console upload steps — is
`docs/RELEASING.md`. Play Store submission material (content rating, data safety,
store listing, reviewer notes) lives in `docs/playstore/`.

## Status

V1 is feature-complete. The web app is live on Vercel + Railway. The Android app
has completed its TWA → Capacitor migration and the release build pipeline is
verified; a Play Console account has not yet been created, so Play Store
submission is the remaining open item (`docs/playstore/PUBLISH_CHECKLIST.md`).
See `docs/PROGRESS.md` for the full history.

Longer-term roadmap: V1 (web, done) → V2 (native Android, in flight) → V3
(Bluetooth transport) → V4 (BitChat-style mesh).

## Docs

- `docs/CONCEPT.md` — the original product spec (cited by section number
  elsewhere, e.g. CLAUDE.md's §19/§20/§22/§28/§29)
- `CLAUDE.md` — project rules for coding agents
- `docs/PROGRESS.md` — progress log
- `docs/ARCHITECTURE.md` — architecture and diagrams
- `docs/RELEASING.md` — release/ops runbook
- `docs/MODERATION.md` — trust & safety process
- `docs/DECISIONS-encryption-at-rest.md` — encryption design decision
- `docs/playstore/` — Play Store submission material
