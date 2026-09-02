-- Widen messages_type_chk to add 'alarm' — the /alarm emergency command.
-- An alarm is a dedicated message type (like letter / thisorthat): a "raise"
-- carries an empty payload; an acknowledgement is a follow-up alarm message
-- with payload {ack:<originalId>} reply-linked to the original (no message-
-- mutation path is needed). Written idempotently (drop if exists) matching
-- 024/025's pattern.

alter table messages drop constraint if exists messages_type_chk;

alter table messages add constraint messages_type_chk
  check (type in ('text', 'letter', 'voice', 'image', 'file', 'ask', 'countdown', 'checkin', 'thisorthat', 'alarm'));
