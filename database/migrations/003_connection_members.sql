create table connection_members (
  connection_id uuid not null references connections(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  nickname text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (connection_id, user_id)
);
