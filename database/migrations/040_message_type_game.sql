-- Widens messages_type_chk to add 'game' — a server-authored row written when
-- an authoritative match (API-CONTRACT §12) that was actually played ends,
-- the same way 'call' rows are (migration 028): message:send rejects a
-- client-sent 'game' type, `content` is a readable summary for clients that
-- don't render the type, and the payload carries
-- {game, inviter, winner, reason, durationSec} — both encrypted at rest.
-- Idempotent drop-then-add, matching 029/034.

alter table messages drop constraint if exists messages_type_chk;

alter table messages add constraint messages_type_chk
  check (type in ('text', 'letter', 'voice', 'image', 'file', 'ask', 'countdown', 'checkin', 'thisorthat', 'alarm', 'call', 'location', 'system', 'game'));
