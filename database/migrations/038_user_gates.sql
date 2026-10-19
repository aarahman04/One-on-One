-- Sign-in gates (2.0.6): when the user confirmed they are 18+ and accepted the
-- terms. Set once by POST /api/me/gates (only while null, never cleared) and
-- returned by GET /api/me so a reinstall or a second device skips the gates.
-- Idempotent (if not exists), like every migration since 024.

alter table users add column if not exists age_verified_at timestamptz;
alter table users add column if not exists terms_accepted_at timestamptz;
