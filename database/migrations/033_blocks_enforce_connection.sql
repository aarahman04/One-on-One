-- Defense-in-depth for blocking (spec §19/§20 posture: DB constraint, not an
-- app-level hint). Blocking was already pairwise and already enforced in
-- requestConnection (blockService.isBlockedBetween, either direction) — this
-- migration makes "a blocked pair can never have a live connection row"
-- true at the database level too, so it holds even against a direct insert
-- or a future code path that forgets the application-level check.
--
-- Two triggers, same spirit as migration 016's single-active-connection guard:
--  1. before insert/update of status on connections — reject any row that
--     would put a blocked pair into pending/active/leave_pending together.
--  2. after insert on blocks — belt-and-braces cleanup: if a live connection
--     somehow exists between the pair at the moment the block is written
--     (e.g. blockAndTerminate's terminate() step failing after addBlock()
--     succeeds), delete it immediately rather than leaving it live.

create or replace function enforce_no_connection_between_blocked_pair()
returns trigger as $$
begin
  if new.status not in ('pending', 'active', 'leave_pending') then
    return new;
  end if;

  if exists (
    select 1 from blocks
    where (blocker_user_id = new.user_a_id and blocked_user_id = new.user_b_id)
       or (blocker_user_id = new.user_b_id and blocked_user_id = new.user_a_id)
  ) then
    -- Distinct message from migration 016's guard so the backend can map
    -- this to the same generic "couldn't send a request to that connection
    -- ID" failure as an unknown code or a blocked pair caught earlier in
    -- application code — never a distinguishable error.
    raise exception 'connection blocked between this pair'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger connections_enforce_no_blocked_pair
  before insert or update of status on connections
  for each row
  execute function enforce_no_connection_between_blocked_pair();

create or replace function cleanup_connection_on_block()
returns trigger as $$
begin
  delete from connections
  where status in ('pending', 'active', 'leave_pending')
    and (
      (user_a_id = new.blocker_user_id and user_b_id = new.blocked_user_id)
      or (user_a_id = new.blocked_user_id and user_b_id = new.blocker_user_id)
    );
  return new;
end;
$$ language plpgsql;

create trigger blocks_cleanup_connection
  after insert on blocks
  for each row
  execute function cleanup_connection_on_block();
