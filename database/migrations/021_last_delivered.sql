-- Read receipts, part 2: track when each member's device has actually
-- received the conversation (distinct from last_read_at, which tracks when
-- they last had the chat open). A member's sent message is "delivered" once
-- the OTHER member's last_delivered_at >= its created_at, and "read" once
-- their last_read_at >= its created_at (existing semantics, migration 008).
alter table connection_members
  add column last_delivered_at timestamptz;

-- Backfill: a member can't have read past what they've received, so anyone
-- with a last_read_at has at least that much delivered already.
update connection_members
  set last_delivered_at = last_read_at
  where last_read_at is not null;
