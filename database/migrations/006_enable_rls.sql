-- Client never talks to these tables directly (spec §20/§28 — all reads/
-- writes go through the backend, which uses the service_role key and
-- bypasses RLS). Enabling RLS with no policies is a default-deny net for
-- the anon/authenticated roles in case that ever changes.

alter table users enable row level security;
alter table connections enable row level security;
alter table connection_members enable row level security;
alter table messages enable row level security;
