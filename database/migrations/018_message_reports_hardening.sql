-- 1. One report per (message, reporter) — was unbounded, a bloat/abuse vector.
create unique index message_reports_one_per_reporter
  on message_reports (message_id, reporter_id);

-- 2. Keep the report as moderation evidence after the message/connection is
--    gone. message_id becomes nullable + ON DELETE SET NULL, and the message
--    text is snapshotted at report time.
alter table message_reports drop constraint if exists message_reports_message_id_fkey;
alter table message_reports alter column message_id drop not null;
alter table message_reports add constraint message_reports_message_id_fkey
  foreign key (message_id) references messages(id) on delete set null;

alter table message_reports add column message_content text;
