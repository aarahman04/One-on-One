create table users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  connection_code text not null unique,
  created_at timestamptz not null default now()
);

create index users_auth_user_id_idx on users(auth_user_id);
