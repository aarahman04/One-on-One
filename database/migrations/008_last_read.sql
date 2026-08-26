-- Read receipts: when each member last viewed the conversation. A member's
-- sent message is "seen" once the OTHER member's last_read_at >= its created_at.
alter table connection_members
  add column last_read_at timestamptz;
