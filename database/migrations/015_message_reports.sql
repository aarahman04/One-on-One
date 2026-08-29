-- User reports on messages (Google Play UGC policy: an in-app way to flag
-- objectionable content; blocking is already covered by the one-connection /
-- leave model). One row per report — a user can report a message more than once.
create table message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  reporter_id uuid not null references users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

create index message_reports_message_id_idx on message_reports(message_id);

-- Client never talks to this table directly — same default-deny net as
-- migration 006 (backend uses the service_role key and bypasses RLS).
alter table message_reports enable row level security;
