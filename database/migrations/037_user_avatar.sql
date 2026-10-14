-- Profile photo: one optional image per user, stored in the private
-- `attachments` bucket under avatars/<userId>/<uuid>.<ext>. Only the owner
-- writes it (PUT/DELETE /api/me/avatar); signed URLs go only to the owner and
-- the member of their live connection (GET /api/me/avatars).
-- Idempotent (if not exists), like every migration since 024.

alter table users add column if not exists avatar_path text;
