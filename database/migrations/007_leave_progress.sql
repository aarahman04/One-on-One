-- Stage E: per-member leave progress for the solo-completable 5-step leave countdown.
-- Each member advances their own step (0->5), one step per 24h (gated server-side).
-- Reaching 5 terminates the connection on its own; the other member's agreement is not required.
alter table connection_members
  add column leave_step smallint not null default 0 check (leave_step between 0 and 5),
  add column leave_last_step_at timestamptz;
