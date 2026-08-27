-- Backfill read receipts. last_read_at (008) was added nullable with no default,
-- so conversations that existed before the read-receipt feature have NULL and
-- their history is stuck "unseen". Seed every member to now(): by deploy time
-- both participants have seen the existing history.
update connection_members set last_read_at = now() where last_read_at is null;
