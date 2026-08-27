-- Quoted replies: a message can point at the message it's replying to.
-- Nullable, no cascade-delete of the reply itself if the original is removed
-- (there's no message deletion in V1, but set null defensively either way).
alter table messages
  add column reply_to uuid references messages(id) on delete set null;
