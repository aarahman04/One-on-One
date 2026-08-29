-- Harden single-active-connection (spec §19) against races.
--
-- The existing trigger (005) does `select count(*)` under READ COMMITTED with
-- no locking, so two concurrent inserts/updates can both pass and both commit,
-- leaving a user with ≥2 live connections. That then breaks getCurrentConnection
-- (which expects at most one) and locks the user out.
--
-- Two layers:
--  1. Partial unique indexes — atomic, cover the common case (same user as
--     user_a, or as user_b, in two simultaneously-live rows).
--  2. Advisory locks in the trigger — cover the cross-column case (a user who
--     is user_a of one live row and user_b of another), which no single-column
--     index can catch.

create unique index connections_one_live_per_user_a
  on connections (user_a_id)
  where status in ('pending', 'active', 'leave_pending');

create unique index connections_one_live_per_user_b
  on connections (user_b_id)
  where status in ('pending', 'active', 'leave_pending');

create or replace function enforce_single_active_connection()
returns trigger as $$
declare
  conflicting_count integer;
  lock_a bigint;
  lock_b bigint;
begin
  if new.status not in ('pending', 'active', 'leave_pending') then
    return new;
  end if;

  -- Serialize every concurrent transaction that touches either of these two
  -- users, ordered to avoid deadlock. Released at commit/rollback.
  lock_a := hashtextextended(least(new.user_a_id, new.user_b_id)::text, 0);
  lock_b := hashtextextended(greatest(new.user_a_id, new.user_b_id)::text, 0);
  perform pg_advisory_xact_lock(lock_a);
  perform pg_advisory_xact_lock(lock_b);

  select count(*) into conflicting_count
  from connections
  where id <> new.id
    and status in ('pending', 'active', 'leave_pending')
    and (
      user_a_id in (new.user_a_id, new.user_b_id)
      or user_b_id in (new.user_a_id, new.user_b_id)
    );

  if conflicting_count > 0 then
    raise exception 'user already has an active or pending connection'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$ language plpgsql;
