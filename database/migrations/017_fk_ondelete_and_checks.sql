-- 1. FK ON DELETE: users could not be deleted at all.
--
-- `users.auth_user_id references auth.users(id) on delete cascade`, but
-- `connections.user_a_id/user_b_id` and `messages.sender_id` reference
-- `users(id)` with the default NO ACTION. Deleting a Supabase auth user
-- (account deletion / GDPR erasure) cascades to the `users` row, which then
-- violates those FKs → the whole delete fails for anyone who ever made a
-- connection. Cascade so a user delete tears down their connections + messages.

alter table connections drop constraint if exists connections_user_a_id_fkey;
alter table connections add constraint connections_user_a_id_fkey
  foreign key (user_a_id) references users(id) on delete cascade;

alter table connections drop constraint if exists connections_user_b_id_fkey;
alter table connections add constraint connections_user_b_id_fkey
  foreign key (user_b_id) references users(id) on delete cascade;

alter table messages drop constraint if exists messages_sender_id_fkey;
alter table messages add constraint messages_sender_id_fkey
  foreign key (sender_id) references users(id) on delete cascade;

-- 2. Value CHECKs that only the app enforced today.

alter table messages add constraint messages_type_chk
  check (type in ('text', 'letter', 'voice'));

alter table reactions add constraint reactions_emoji_chk
  check (emoji in ('❤️', '👍', '😂', '😮', '😢', '🙏'));
