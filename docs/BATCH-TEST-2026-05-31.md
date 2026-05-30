# MamaMonkey — Batch test checklist (morning of 2026-05-31)

Everything below was built offline (no live PC access the evening of 05-30). Deploy once, then run through the list. Report results per section; for anything that fails, paste what you see — I can also `curl` the addon directly from the Mac (same Wi-Fi) to diagnose.

## 0. Deploy (once)
- [ ] **Addon → v0.4.2**: MediaMonkey → check for updates → install → **fully restart MM**.
- [ ] **Companion → companion-v0.2.1** (latest — includes the Library/Playlists fix + theme): download the new `MamaMonkeyCompanion.exe` from the companion-v0.2.1 release, run it (SmartScreen → "Run anyway"; allow through the firewall on private network). It prints the URL.
- [ ] **iPhone**: open the printed `http://<PC-IP>:8088`, then **Add to Home Screen** → you should get the pink monkey icon, full-screen app.

## 1. Look & feel (offline-built, should just work)
- [ ] Classy **Barbie-pink theme** everywhere (plum-black bg, pink accents).
- [ ] **App icon** = pink monkey + note on the home screen; opens full-screen (no Safari bars).

## 2. Now-Playing tab (already worked in Phase 2 — regression check)
- [ ] Album art, title/artist/album, seek bar, ⏮⏯⏭, shuffle/repeat, queue (☰). All still good.

## 3. Library tab  ← key new stuff
- [ ] **Search**: type e.g. "bowie" → results should FILTER to matches (not the whole library). ⚠️ If it shows unfiltered/empty, tell me — the SQL column names may need adjusting.
- [ ] **All**: scroll the full library; tap a track's ⋯ → Play now / Play next / Add to queue / Add to playlist.
- [ ] **Artists / Albums / Genres** segments: ⚠️ MOST UNCERTAIN. Do they list names? Tapping one → its tracks? If empty or wrong, just say so — I'll read the built-in diagnostic from the Mac and patch fast.
- [ ] Play / enqueue from a track or a drilled album/artist works (music changes on the PC).

## 4. Playlists tab
- [ ] Lists your playlists; tap one → its tracks; tap a track → plays.
- [ ] **＋ New playlist** (creates), rename, delete.
- [ ] From a library track ⋯ → **Add to playlist** → pick one; verify it was added.
- [ ] Remove a track from a playlist (⋯ on a playlist track).

## What I'll do as soon as the PC is on
From the Mac (same LAN) I'll `curl http://192.168.1.98:18391/` to run `introspect` + `lib{view:'artists'}` (read the `_sampleKeys` field) and the playlist CRUD, finalize the browse mapping, and ship any patch addon version. Then we re-test the few edges.

## Known-uncertain (expected to maybe need a patch)
- Browse-by Artists/Albums/Genres item mapping (name field / drill-down).
- Search SQL column casing (`SongTitle`/`Artist`/`Album`).
- `play` from a huge token (e.g. all 6438) is heavy but should work.
