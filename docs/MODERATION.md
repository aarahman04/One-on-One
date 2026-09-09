# Moderation & Trust-and-Safety process

Internal process for handling user reports in One on One. Satisfies the Google
Play UGC policy requirement that reports reach a real review process, and the
Child Safety Standards requirement for a documented CSAM response.

Responder / Child Safety point of contact: **Ahmed Abdul Rahman —
aarahman803@gmail.com**.

## What users can report

- **A specific message** — chat menu → Report. Captures the message, its
  sender, a category, and an optional note. The message text is snapshotted
  (ciphertext) so the report survives the connection being deleted.
- **A person** — chat menu → Report person, or "Report & block" from the leave
  flow. No message; records the reported user + category + note.

Categories: `harassment`, `hate`, `sexual`, `child_safety`, `spam`, `other`.

## Review

Run from `backend/`:

```
npm run reports:review                      # newest 100 reports
npm run reports:review -- --category child_safety
npm run reports:review -- --limit 50
```

Output shows reporter id, reported user id, category, note, and the decrypted
message snapshot (or "person-level report" when there is no message).

**Triage SLA:** review new reports within 48h. `child_safety` reports are
handled immediately on discovery — see below.

## Actions

All actions are manual, against the live database / Supabase console. There is
no in-app moderation UI in V1.

| Action | How |
| --- | --- |
| Delete a single message | Delete the `messages` row by id (the report snapshot is retained — `message_id` becomes null). |
| End a connection | Delete the `connections` row by id; `connection_members` + `messages` cascade. Both users are dropped to the connection-id screen on their next poll. |
| Ban a user | Delete the user in Supabase Auth (`auth.users`); this cascades to `users` and everything they own. Their reports-about survive with `reported_user_id` nulled. Note: a banned user can create a new account with the same Google identity — there is no identity-level ban in V1. |

Reports about a user are preserved as evidence: `reported_user_id` is
`ON DELETE SET NULL`, `message_id` is `ON DELETE SET NULL`, and the ciphertext
snapshot is never deleted with the message.

## CSAM / child sexual abuse and exploitation (CSAE)

Zero tolerance. On any credible `child_safety` report or discovery of CSAM:

1. **Preserve** the evidence — do NOT delete the `messages` row or the
   attachment yet. Note the message id, sender (`reported_user_id`), connection
   id, and timestamps.
2. For an image/file attachment, retrieve the bytes via a signed URL from the
   `attachments` bucket (path `{connectionId}/{uuid}.{ext}`) and preserve a copy
   securely.
3. **Report to NCMEC** via the CyberTipline: https://report.cybertip.org
   (US NCMEC is the appropriate clearinghouse; include the account identifiers,
   content, and timestamps).
4. Notify the Child Safety point of contact (above) if that is not the person
   doing the review.
5. **Then** remove the content (delete the message row + attachment) and **ban**
   the user (delete the Supabase auth user).
6. Record the incident (date, NCMEC report number, action taken) in a private
   log.

The app publishes its child-safety standards and the in-app reporting path on
the `/child-safety` page (Stage 2).
