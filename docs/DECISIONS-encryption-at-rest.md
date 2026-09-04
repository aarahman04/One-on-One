# Decision: Message encryption at rest (Option C — application-layer column encryption)

Status: **Approved** (2026-09-02). Design record; implementation staged separately and held for per-chunk sign-off.

## Context

Message text and structured payloads currently sit as **plaintext** in the
Supabase Postgres DB (`messages.content` text, and personal free-text inside
`messages.payload` jsonb — checkin notes, ask questions/answers, thisorthat
options, countdown labels, letter from/to). Supabase already encrypts the DB at
rest at the **disk layer** (AWS EBS) and everything is TLS in transit, so the
remaining exposure is **logical** access to the data: a `pg_dump`, a
leaked/misconfigured backup, a stolen `service_role`/DB credential, SQL
injection, or provider-side read. None of those are covered by disk-level
encryption because the key lives inside the same infrastructure.

Goal: encryption **at rest** so message content is not readable from a database
leak — the posture a platform like Instagram uses for regular (non-vanish) DMs.
Explicitly **not** full E2EE (ruled out: key exchange, device key storage,
recovery cost, and it would break the backend-as-sole-trust-boundary model).

## Decision

**Option C — application-layer column encryption.** The backend encrypts
`content` and `payload` with **AES-256-GCM** using a key held in the backend
host environment (never in the DB, never on the client), stores ciphertext in
Postgres, and decrypts on read before serving. Per-message random 12-byte
nonce; GCM auth tag stored alongside for tamper detection; every ciphertext
carries a key-version tag (e.g. `v1:`) from day one so rotation never needs a
flag day.

### Why C (and not the alternatives)

- **Keeps the trust model intact (spec §20).** The backend still decrypts to
  plaintext in memory and still runs every server-side check — membership, live
  status, reply-target-in-connection, media-path ownership. Nothing moves to
  the client. C *coexists* with the current model; E2EE is the option that
  would break it.
- **Closes exactly the named threat.** A DB dump / backup / stolen service-role
  key shows ciphertext, because the key is not in the DB.
- **Cheap here specifically** because there is **no content search** and no
  server-side logic that filters on message text — messages are only ever
  fetched by `connection_id` + `created_at`. The usual cost of app-layer
  encryption (losing `WHERE`/`ILIKE`/indexes on the column) does not apply.

### Honest limit

C protects the **database**, not a full **backend** compromise. If the host is
breached and the encryption key env leaks, an attacker has the key. That is the
**same trust boundary the app already stands on** — C is strictly more
protection than today, not a regression. It is not E2EE and must not be
described as such.

---

## Open decision 1 — Message reports / moderation snapshot

**Background.** `message_reports.message_content` (migration 018) is a
**plaintext snapshot** of the reported message, taken at report time so the
report survives the message/connection being deleted (`ON DELETE SET NULL`).
`reportService.reportMessage` fills it from
`connectionAccess.getConnectionByMessageId`, which reads `messages.content`.

**Decision: decrypt-on-read. Store the ciphertext snapshot; decrypt through the
backend only at moderation-review time.**

- At report write, copy the **stored ciphertext of `messages.content`
  verbatim** into `message_reports.message_content` (it already carries a valid
  key-version tag). **No decrypt, no re-encrypt at write.**
- The snapshot stays a real, independent copy → still survives message deletion
  (the reason 018 exists).
- Moderation review decrypts through the backend (which holds the key). There
  is **no admin review UI in the repo today** (reports are stored for Google
  Play UGC compliance, reviewed out-of-band), so review-time decryption is
  provided by a small backend decrypt helper/script until/unless a review
  endpoint is built.

**Why not decrypt-at-write (plaintext snapshot).** That would create a
**second uncontrolled plaintext copy at rest** — precisely the leak Option C
exists to prevent — and it would *outlive* the original message. It defeats the
whole exercise. Rejected.

**Rotation constraint (must document + honor).** Report snapshots are
long-lived moderation evidence encrypted under whatever key version was current
at report time. During key rotation, **either** retain every key version that
any report snapshot still references, **or** re-encrypt report snapshots as
part of the rotation backfill. Never destroy a key version while a report still
points at it.

---

## Open decision 2 — Push notification previews

**Confirmed: push previews are a real plaintext egress point, generated
backend-side post-decrypt. This is documented, not silently changed.**

- `socketServer.ts` `mediaNoticeFor(message)` builds the push `body`:
  - `letter` / `image` / `voice` / `file` / `alarm` / `call` / `location` →
    generic notice ("sent you a photo", "shared their location", …) — **no
    content**. (`location` deliberately joins this group rather than the
    default below — the coordinates would otherwise sit in plaintext on an OS
    lock-screen notification, which is a worse leak than the encrypted-at-rest
    message itself.)
  - **default (text, ask, countdown, checkin, thisorthat) → `message.content.slice(0, 120)`** — up to 120 chars of the **plaintext** message.
- The `message` object here is the in-memory decrypted `Message` returned by
  `saveMessage`, so the preview is plaintext by construction.
- web-push payloads are themselves encrypted to the subscription keys in
  transit (RFC 8291), but the **push service** (Google/Mozilla/Apple/Windows)
  and the recipient's device/OS lock screen see the preview in plaintext, and
  our backend composes it in plaintext.

**Scope statement:** Option C protects message data **at rest in our database**.
It does **not** cover notification previews in transit to/through push services
— that is an accepted, intentional egress (stripping previews would degrade the
core UX). A future opt-out ("hide message text in notifications") is possible
but **out of scope** for this work; flagged here so it is a known, deliberate
gap rather than an oversight.

---

## Open decision 3 — `/location` map tile requests (third-party leak, independent of at-rest encryption)

**Confirmed, user-chosen trade-off. Not a gap introduced silently.**

The `/location` card renders a single OpenStreetMap tile
(`tile.openstreetmap.org`) centered on the sender's coordinates, fetched
directly by the recipient's browser — never proxied through our backend. This
means:

- The coordinates, and the viewing device's IP address, reach a third party
  (OpenStreetMap's tile infrastructure) on every card render.
- This is **completely independent of Option C** above — the payload is still
  encrypted at rest in our DB; the leak is a live network request the *card
  itself* makes when displayed, not a database exposure.
- Mitigated, not eliminated: the tile is held behind an `IntersectionObserver`
  in `ChatPage.ts`'s `locationCard`, so it only fetches for a card actually
  scrolled into view — not for every location message in the entire history
  the moment a chat opens.

**Alternatives considered and rejected:** a Google Static Maps thumbnail (same
leak, plus an API key shipped client-side and a Google Cloud billing account);
a zero-request stylized card with coordinates as text only (no leak, but no
visual preview). User picked the OSM tile explicitly, with this trade-off
stated plainly beforehand — recorded here per this file's own pattern for
Option 2's push-preview trade-off above.

---

## Explicitly out of scope — attachment bytes

Image/voice/file **bytes** live in a separate private Supabase **Storage**
bucket and are served **directly to the browser via short-lived signed URLs**
(`attachmentService.signAttachments`). App-layer encryption of those bytes
would force every download to be **proxied and decrypted by the backend**,
killing the signed-URL design. Storage keeps its own disk-at-rest encryption.

- **In scope:** the attachment **metadata** (`path` / `mime` / `size` /
  dimensions / duration / name) is inside `payload` and therefore **is
  encrypted** with the rest of the payload.
- **Out of scope:** the attachment **object bytes** themselves. Revisit only if
  attachment-body-at-rest becomes a hard requirement.

---

## What changes (summary — full staged plan tracked separately)

- **Schema:** `messages.content` and `messages.payload` hold ciphertext; drop
  the plaintext `char_length(content)` check (length enforced pre-encrypt in
  `saveMessage`). `message_reports.message_content` holds a ciphertext copy.
- **Key management:** `ENCRYPTION_KEY_V1` (32 random bytes, base64) in host env;
  never in DB or client. Version-tagged ciphertext; rotation via added key
  versions + lazy/backfill re-encrypt, honoring the report-retention constraint
  above.
- **Wiring:** encrypt in `saveMessage` (validate plaintext first, return
  in-memory plaintext so the realtime/push path is unchanged); decrypt in
  `getHistory`. `assertReplyTargetInConnection` selects `id` only — no decrypt.
  Reactions (emoji, separate table) stay clear. Report snapshot copies
  ciphertext verbatim.
- **Backfill:** one-time job to encrypt existing message rows (and existing
  report snapshots).

## Unaffected

Search (none exists), signed URLs / attachment delivery, `markRead` /
`last_read`, membership / live-status / reply-target / media-path checks.
