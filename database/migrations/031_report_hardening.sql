-- Report hardening (Google Play UGC + Child Safety policy).
--
-- 1. reported_user_id: who the report is ABOUT. Nullable + ON DELETE SET NULL
--    for the same reason message_id is (migration 018) — the report is
--    moderation evidence that must outlive the accounts/messages it references.
--    A person-level report (message_id null) still records the reported user.
alter table message_reports add column reported_user_id uuid
  references users(id) on delete set null;

-- 2. category: a coarse reason bucket the moderation review keys off. Free-text
--    `reason` stays as the optional note. 'child_safety' is the CSAE category
--    required by the Child Safety Standards policy.
alter table message_reports add column category text;

-- 3. One person-level report per (reporter, reported) — the existing unique
--    index only covers message-level reports (message_id, reporter_id), and a
--    null message_id doesn't collide there. Partial index closes the gap.
create unique index message_reports_one_person_per_reporter
  on message_reports (reporter_id, reported_user_id)
  where message_id is null;
