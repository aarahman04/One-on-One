-- Emoji reactions on messages. One row per (message, user, emoji) so a user
-- can react with more than one emoji but not duplicate the same one.
create table reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index reactions_message_id_idx on reactions(message_id);

-- Client never talks to this table directly — same default-deny net as
-- migration 006 (backend uses the service_role key and bypasses RLS).
alter table reactions enable row level security;
