-- One reaction per user per message (was: one per user per emoji, so a user
-- could stack multiple different emoji on the same message). Picking a new
-- emoji now replaces the user's previous reaction instead of adding to it.

-- Dedupe existing rows first — keep only the newest reaction per
-- (message_id, user_id), or the old unique constraint drop below can't be
-- followed by the new one if any user has more than one row today.
delete from reactions a using reactions b
  where a.message_id = b.message_id
    and a.user_id = b.user_id
    and a.created_at < b.created_at;

alter table reactions drop constraint reactions_message_id_user_id_emoji_key;
alter table reactions add constraint reactions_message_id_user_id_key unique (message_id, user_id);
