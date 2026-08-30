-- L-B5: the 24h leave-step gate was computed in Node (Date.now()), so a server
-- clock change between steps could wrongly allow or block one. Move the whole
-- conditional advance into SQL where both the cooldown check and the new
-- timestamp use the database clock (now()).
--
-- Returns the updated row when the advance is allowed, nothing otherwise
-- (from-step mismatch = concurrent request; cooldown not elapsed = too soon).

create or replace function advance_leave_step(
  p_connection_id uuid,
  p_user_id uuid,
  p_from_step int
)
returns setof connection_members
language sql
as $$
  update connection_members
     set leave_step = p_from_step + 1,
         leave_last_step_at = now(),
         updated_at = now()
   where connection_id = p_connection_id
     and user_id = p_user_id
     and leave_step = p_from_step
     and (leave_last_step_at is null or leave_last_step_at <= now() - interval '24 hours')
  returning *;
$$;
