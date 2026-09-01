-- Widen messages_type_chk to cover every MessageType the app already sends or
-- is about to: 'image'/'file' (media attachments) were already shipped in app
-- code without a migration ever widening this constraint here — the repo's
-- migration history alone would reject them, so this may be re-establishing
-- what the live DB already allows via an out-of-band change rather than a
-- first-time widening. 'ask'/'countdown'/'checkin' are new, added ahead of
-- their features (batches 4-6) landing. Written idempotently (drop if exists)
-- so it's safe to apply regardless of the constraint's current live state.

alter table messages drop constraint if exists messages_type_chk;

alter table messages add constraint messages_type_chk
  check (type in ('text', 'letter', 'voice', 'image', 'file', 'ask', 'countdown', 'checkin'));
