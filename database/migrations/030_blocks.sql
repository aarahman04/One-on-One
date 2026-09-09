-- Blocking a user (Google Play UGC safety policy: a way to stop another user
-- contacting you, distinct from the deliberate 5-step leave). A block is
-- directional and permanent until the blocker removes it: while a row exists,
-- neither user can send a connection request to the other (checked in
-- connectionService.requestConnection, backend-only — spec §20).
--
-- "Block & end" terminates the current connection immediately (no countdown),
-- then writes the row. The connection cascade (migration 017) deletes the
-- conversation; this row is all that survives, and it carries no message data.
create table blocks (
  blocker_user_id uuid not null references users(id) on delete cascade,
  blocked_user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id)
);

create index blocks_blocked_user_id_idx on blocks(blocked_user_id);

-- Client never talks to this table directly — default-deny net, same as
-- migration 006 (backend uses the service_role key and bypasses RLS).
alter table blocks enable row level security;
