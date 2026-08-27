-- Wallpaper is shared per-connection (either member's choice applies to both),
-- unlike message style/theme which stay per-device localStorage preferences.
alter table connections
  add column wallpaper text not null default 'off';
