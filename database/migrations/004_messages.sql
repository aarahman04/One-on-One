create table messages (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references connections(id) on delete cascade,
  sender_id uuid not null references users(id),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index messages_connection_id_created_at_idx on messages(connection_id, created_at);
