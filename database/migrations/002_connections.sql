create table connections (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references users(id),
  user_b_id uuid not null references users(id),
  status text not null check (status in ('pending', 'active', 'leave_pending', 'terminated', 'declined')),
  leave_requested_by uuid references users(id),
  leave_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_a_id <> user_b_id)
);

create index connections_user_a_id_idx on connections(user_a_id);
create index connections_user_b_id_idx on connections(user_b_id);
