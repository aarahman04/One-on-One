-- Widen messages_type_chk to add 'location' — the /location slash command.
-- A location is a keepsake card like checkin / thisorthat: `content` holds the
-- human-readable coordinate string (the display fallback, and what satisfies
-- saveMessage's 1-4000 char rule for non-media types) and the payload carries
-- {lat, lng, accuracy?} — both encrypted at rest like every other message.
--
-- It is a ONE-SHOT snapshot, not live location sharing: there is no update
-- path, so a location row is immutable history the same way every other
-- message is. Written idempotently (drop if exists), matching 024/025/027/028.

alter table messages drop constraint if exists messages_type_chk;

alter table messages add constraint messages_type_chk
  check (type in ('text', 'letter', 'voice', 'image', 'file', 'ask', 'countdown', 'checkin', 'thisorthat', 'alarm', 'call', 'location'));
