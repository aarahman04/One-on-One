-- A2 (code-quality audit): drop the vestigial connection-level leave columns.
--
-- `connections.leave_requested_by` / `leave_requested_at` (migration 002) were
-- the original spec §25 "one member requests, 5-day auto-expire" model. Stage E
-- (migration 007) replaced it with a per-member countdown on
-- `connection_members.leave_step` / `leave_last_step_at`. Nothing has read or
-- written the connection-level columns since — they are always NULL. Dropping
-- `leave_requested_by` also removes its dormant `... references users(id)`
-- (NO ACTION) FK, one fewer latent blocker on user deletion.

alter table connections drop column if exists leave_requested_by;
alter table connections drop column if exists leave_requested_at;
