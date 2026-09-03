-- Widen messages_type_chk to add 'call' — the audio/video call log row.
-- A call message is server-authored ONLY (callService.resolveCall, at every
-- call resolution path); message:send rejects a client-sent 'call' type
-- outright, so call history can't be forged. `content` is empty and the
-- payload carries {kind, outcome, durationSec} — both encrypted at rest like
-- every other message. Written idempotently (drop if exists), matching the
-- pattern of 024/025/027.

alter table messages drop constraint if exists messages_type_chk;

alter table messages add constraint messages_type_chk
  check (type in ('text', 'letter', 'voice', 'image', 'file', 'ask', 'countdown', 'checkin', 'thisorthat', 'alarm', 'call'));
