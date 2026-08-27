-- Web Push subscriptions: one row per device/browser a user has enabled
-- notifications on. endpoint is unique per browser install, so re-subscribing
-- the same device (e.g. after clearing permission) just replaces its row.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on push_subscriptions(user_id);

-- Client never talks to this table directly — same default-deny net as
-- migration 006 (backend uses the service_role key and bypasses RLS).
alter table push_subscriptions enable row level security;
