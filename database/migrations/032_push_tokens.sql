-- FCM registration tokens: one row per native (Android) install a user has
-- enabled notifications on. Separate table from push_subscriptions rather than
-- nullable columns on it — the two credential shapes share nothing (a web-push
-- row needs endpoint + p256dh + auth, all NOT NULL; an FCM row is just an opaque
-- token), and adding this alongside leaves the live web-push table, its unique
-- endpoint constraint, and saveSubscription's onConflict:'endpoint' upsert
-- completely untouched. sendToUser fans out to both tables.
create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token text not null unique,
  platform text not null default 'android',
  created_at timestamptz not null default now()
);

create index push_tokens_user_id_idx on push_tokens(user_id);

-- Client never talks to this table directly — same default-deny net as
-- push_subscriptions (backend uses the service_role key and bypasses RLS).
alter table push_tokens enable row level security;
