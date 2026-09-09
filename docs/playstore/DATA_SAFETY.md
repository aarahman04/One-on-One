# Play Console — Data Safety answer sheet

Transcribe into Play Console → **App content → Data safety**. Must stay
consistent with the privacy policy (`/privacy`, `client/src/pages/legalShared.ts`).
Source: plan `~/.claude/plans/ancient-weaving-raven.md` Part 2 data inventory.

Developer: **Ahmed Abdul Rahman** · Contact: **aarahman803@gmail.com**
Privacy policy URL: **https://one-on-one-mu.vercel.app/privacy**

---

## Section 1 — Data collection & security (overview answers)

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS + WSS everywhere) |
| Do you provide a way for users to request that their data is deleted? | **Yes** — in-app (menu → Delete account; connection-ID screen → Delete account) and web (**https://one-on-one-mu.vercel.app/delete-account**) |

## Section 2 — Data types

For every type below: **Collected = Yes, Shared = No** (the app has no ads, no
analytics SDKs, no data brokers, and sells nothing). "Processed ephemerally" =
No unless noted. Deletion: all of it is removed when the connection ends or the
account is deleted (report snapshots excepted — see notes).

| Data type (Play category) | Collected | Purposes | Optional? | Notes |
| --- | --- | --- | --- | --- |
| **Name** (Personal info) | Yes | App functionality; Account management | Required | Google display name, via OAuth sign-in. |
| **Email address** (Personal info) | Yes | App functionality; Account management | Required | Google account email, via OAuth sign-in. |
| **User IDs** (Personal info) | Yes | App functionality; Account management | Required | Google `sub` + an internal user id. |
| **Approximate/precise location** (Location) | Yes | App functionality | Optional | Only when the user runs `/location`. One-shot, rounded to ~5 decimal places. Not continuous, no background access. See notes on the map tile. |
| **Messages** (Messages — "Other in-app messages") | Yes | App functionality | Required for use | Text, captions, letter bodies, slash-card fields. **Encrypted at rest** (AES-256-GCM). |
| **Photos** (Photos and videos) | Yes | App functionality | Optional | Image messages. Stored in a private bucket, 1-hour signed URLs. EXIF/GPS stripped client-side before upload (non-GIF). |
| **Voice or sound recordings** (Audio) | Yes | App functionality | Optional | Voice-note messages. |
| **Files and docs** (Files and docs) | Yes | App functionality | Optional | File-attachment messages. |
| **Other user-generated content** | Yes | App functionality | Optional | Emoji reactions, per-connection nicknames, call logs (`{kind, outcome, durationSec}` — no call media is ever stored). |

### Not collected (answer "No" / leave unchecked)

Financial info · Health & fitness · Web browsing history · App activity /
analytics · Device or other IDs (advertising ID etc.) · Contacts · Calendar ·
SMS or call log · Installed apps · Crash logs / diagnostics (no crash-reporting
SDK) · Purchase history.

IP address is **not** collected — `req.ip` is used only for in-memory rate
limiting and is never persisted.

## Section 3 — Notes to keep the form consistent with the privacy policy

1. **Location + the map tile.** A visible `/location` card fetches one map tile
   from `tile.openstreetmap.org`, which necessarily sees the coordinates and the
   viewer's IP. This is disclosed in the privacy policy. It is infrastructure
   (transient, no account linkage, no storage by us) rather than data "sharing"
   in Google's sense — recommend **Shared = No** for Location, and rely on the
   privacy-policy disclosure. If you prefer to be maximally conservative, declare
   Location as shared with "a mapping/CDN provider" for "app functionality".
2. **Push notification previews.** For text messages, up to ~120 characters of
   message text plus the sender nickname are included in the (RFC-8291-encrypted)
   web-push payload and shown on the lock screen. The push service and the device
   OS therefore see that preview. Disclosed in the privacy policy. This is part
   of "Messages … App functionality", not separate sharing.
3. **WebRTC calls.** Audio/video call media is peer-to-peer (DTLS-SRTP) and never
   recorded or stored. For ~10–20% of calls a Cloudflare TURN relay forwards the
   already-encrypted media packets and sees both peers' IPs. No content is
   readable or retained. Not a stored data type.
4. **Processors** (not "sharing"): Supabase (database, auth, storage), Vercel
   (frontend hosting), Railway (backend hosting), Cloudflare (STUN/TURN),
   browser push services (Google/Mozilla/Apple/Microsoft), Google (OAuth). List
   these in the privacy policy's "who we share with" section (already done in
   `legalShared.ts`).
5. **Retention.** No TTL/cron. Data persists until the connection is terminated
   (whole conversation cascade-deleted) or the account is deleted (`auth.users`
   delete cascades). **Report snapshots deliberately survive** account deletion
   as moderation evidence, with the message link nulled — call this out under
   "Data retention" and in the deletion page copy (already done).
