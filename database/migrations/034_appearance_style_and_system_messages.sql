-- Message style (bubbles/line) becomes shared per connection, same model as
-- wallpaper already is (migration adds no wallpaper column since that one
-- shipped earlier) — either member's choice applies to both. Defaults to
-- 'bubbles' to match the existing per-device default everyone already sees.
--
-- Also widens messages_type_chk to add 'system' — a server-authored
-- appearance-change notice (wallpaper/style), written the same way 'call'
-- rows are (migration 028): message:send rejects a client-sent 'system' type
-- outright, `content` is empty, and the payload carries {event, value} —
-- both encrypted at rest like every other message. Written idempotently
-- (add-if-not-exists / drop-then-add), matching the pattern of 024/025/027/028/029.

alter table connections
  add column if not exists message_style text not null default 'bubbles'
    check (message_style in ('line', 'bubbles'));

alter table messages drop constraint if exists messages_type_chk;

alter table messages add constraint messages_type_chk
  check (type in ('text', 'letter', 'voice', 'image', 'file', 'ask', 'countdown', 'checkin', 'thisorthat', 'alarm', 'call', 'location', 'system'));
