-- push_tokens.platform distinguishes the two Android clients:
--   'android'        the Capacitor (WebView) app — keeps notification+data sends
--   'android-native' the native Kotlin app — gets data-only high-priority sends
-- The column existed since migration 032 (default 'android') with no check, so
-- every existing row is 'android' and this constraint is safe to add.
alter table push_tokens
  add constraint push_tokens_platform_check
  check (platform in ('android', 'android-native'));
