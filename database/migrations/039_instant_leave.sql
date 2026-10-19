-- Instant leave (2.0.6) replaces the 5-step / 24h countdown (migration 007).
--
-- POST /api/connections/:id/leave now moves the connection straight to
-- status 'ended' with ended_at / ended_by. 'ended' is not a live status, so
-- migration 016's unique indexes and single-active trigger (which only count
-- pending/active/leave_pending) already let BOTH members start a new
-- connection at once. The partner (not the leaver) keeps read-only history
-- until they acknowledge or ended_at + 7 days; the backend then hard-deletes
-- the row (members/messages cascade) and its Storage objects.
--
-- Non-destructive: connection_members.leave_step / leave_last_step_at and the
-- advance_leave_step function stay (unused) so an older backend still runs.
-- Idempotent: safe to run more than once.

alter table connections add column if not exists ended_at timestamptz;
alter table connections add column if not exists ended_by uuid references users(id) on delete set null;

-- The status CHECK is the unnamed inline one from migration 002 (normally
-- connections_status_check). Drop whichever status check exists, re-add with 'ended'.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.connections'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.connections drop constraint %I', c.conname);
  end loop;
end $$;

alter table connections add constraint connections_status_check
  check (status in ('pending', 'active', 'leave_pending', 'terminated', 'declined', 'ended'));

-- Hourly purge sweep: ended connections older than 7 days.
create index if not exists connections_ended_at_idx on connections (ended_at) where status = 'ended';

-- Countdowns already in progress can no longer advance or be cancelled
-- (those endpoints now return 410), so return them to a plain active chat.
-- Leaving is one tap now.
update connection_members m
   set leave_step = 0, leave_last_step_at = null, updated_at = now()
  from connections c
 where c.id = m.connection_id and c.status = 'leave_pending' and m.leave_step <> 0;
update connections set status = 'active', updated_at = now() where status = 'leave_pending';
