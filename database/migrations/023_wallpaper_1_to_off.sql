-- Wallpaper option "1" removed from the picker (a gradient-only placeholder
-- wallpaper, no image asset) — reset any connection still on it back to the
-- default. Everything else about wallpaper (off/love/samurai) stays.
update connections set wallpaper = 'off' where wallpaper = '1';
