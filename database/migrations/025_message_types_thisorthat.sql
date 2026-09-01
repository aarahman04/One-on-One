-- Widen messages_type_chk to add 'thisorthat', replacing /daily (which was a
-- plain-text insert with no dedicated type — see slash-commands-refresh).
-- Written idempotently (drop if exists) matching 024's pattern.

alter table messages drop constraint if exists messages_type_chk;

alter table messages add constraint messages_type_chk
  check (type in ('text', 'letter', 'voice', 'image', 'file', 'ask', 'countdown', 'checkin', 'thisorthat'));
