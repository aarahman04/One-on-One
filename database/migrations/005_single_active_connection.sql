-- Spec §19: "A user can have only one active connection" is a backend/DB
-- constraint, not a UI hint. Blocks it at insert/update time regardless of
-- what the client claims.

create or replace function enforce_single_active_connection()
returns trigger as $$
declare
  conflicting_count integer;
begin
  if new.status not in ('pending', 'active', 'leave_pending') then
    return new;
  end if;

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

create trigger connections_single_active_trigger
  before insert or update on connections
  for each row
  execute function enforce_single_active_connection();
