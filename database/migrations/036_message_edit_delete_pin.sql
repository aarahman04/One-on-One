-- Edit / delete-for-everyone (sender only, within 30 minutes — enforced in
-- messageService.editMessage / deleteMessage) and one shared pinned message per
-- connection (either member may pin; a new pin replaces the old one).
--
-- A deleted message keeps its row (so replies can still say "deleted") but its
-- content is overwritten with an encrypted empty string and its payload nulled.
-- Idempotent (if not exists), like every migration since 024.

alter table messages add column if not exists edited_at timestamptz;
alter table messages add column if not exists deleted_at timestamptz;

alter table connections add column if not exists pinned_message_id uuid references messages(id) on delete set null;
alter table connections add column if not exists pinned_by uuid references users(id) on delete set null;
alter table connections add column if not exists pinned_at timestamptz;
