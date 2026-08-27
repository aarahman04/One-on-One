-- Message-type foundation: messages can now be more than plain text.
-- `type` distinguishes 'text' (default) from special types like 'letter' (and
-- 'voice' later). `payload` holds type-specific metadata as JSON. The letter
-- BODY still lives in `content` (so the length CHECK, search, and export keep
-- working); only its appearance/from/to go in `payload`.
alter table messages
  add column type text not null default 'text',
  add column payload jsonb;
