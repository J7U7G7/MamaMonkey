# MamaMonkey — Phase 3 Design: Library & Playlists

**Date:** 2026-05-31
**Status:** Approved (design)
**Builds on:** Phase 2 (addon v0.3.2, PWA, companion). Done in one block (browse + play + playlist editing). UI = multi-tab.

## 1. Goal
Turn the single now-playing screen into a 3-tab app: **Now-Playing**, **Library**, **Playlists**. Browse the whole library (search + by artist/album/genre/year), play/enqueue any selection, and fully manage playlists (create/rename/delete, add/remove/reorder tracks) — like MediaMonkey on the desktop.

## 2. MM5 APIs (researched, confirmed) + the design pattern
- **Library list:** `app.collections` → `getArtistList()`, `getAlbumList()`, `getGenreList()` (each item is a node with its own `getTracklist()`); full library via `app.collections.getTracklist()` or `app.db.getTracklist("SELECT * FROM Songs", -1)`.
- **Search:** load a base Tracklist once, then `tracklist.filterBySearchPhrase(q)` (no SQL escaping). Tracklist read: `whenLoaded()` → `locked()` → `count`/`getValue(i)`; slice with `getRange(from,to)`.
- **Play/enqueue:** `app.player.addTracksAsync(tracklist, { withClear, startPlayback, afterCurrent, position, focusedTrackIndex })`.
- **Playlists read:** `app.playlists.root.getChildren()` → each `Playlist` has `id`, `title`/`name`, `childrenCount` (>0 = folder), `getTracklist()`.
- **Playlists write:** `parent.newPlaylist()` + set `name` + `commitAsync()`; `addTracksAsync/addTrackAsync/insertTracksAsync/setTracksAsync/removeTrackAsync/clearTracksAsync/moveTrackAsync/reorderAsync/deleteAsync`; `app.playlists.getByIDAsync(id)`.

**Design pattern — token-referenced Tracklist cache (avoids SQL/schema + escaping):** the addon keeps a small in-memory map of recently produced lists/tracklists keyed by a `token` string (e.g. `lib:all`, `lib:artists`, `album:<i>`, `search`, `pl:<id>`). The PWA navigates by asking for a token's items (paged via `getRange`), and "play/enqueue" references the token (optionally a start index). This keeps the PWA stateless-ish and sidesteps building/escaping SQL. Single primary user → a tiny cache (last ~8 tokens) is safe.

> **Live-verified during build (like getArt):** the exact item shape of `getArtistList()/getGenreList()` and whether each exposes `getTracklist()`, plus the `years/decades` accessor. A temporary `sqlSelect`/`introspect` command may be used during development to confirm, then removed. Album drill-down (`album.getTracklist()`) is confirmed.

## 3. Addon → v0.4.0 (new commands; cache + browse/play + playlist CRUD)
Library/browse (all paged with `{offset=0, limit=100}`, returning `{ token, total, items, truncated }`):
- `lib` `{view:'all'|'artists'|'albums'|'genres'|'years', q?, offset, limit}` → builds/loads the matching native list (cached under a token), applies `filterBySearchPhrase(q)` when `q` is set, returns a page. Items carry display fields + a stable `index` within the token.
- `open` `{token, index, offset, limit}` → drill into item `index` of a browse token (e.g. an album/artist/genre/playlist) → its `getTracklist()`, cached under a new token, returns a page of tracks.
- `play` `{token, index?, mode:'now'|'next'|'queue'}` → `addTracksAsync(cache[token], flags)`; `now`={withClear,startPlayback,focusedTrackIndex:index}; `next`={afterCurrent}; `queue`={position:-1}. (Playing a single track = its token + index with `now`.)

Playlists:
- `playlists` → `{ items:[{id,title,isFolder}] }` from `app.playlists.root.getChildren()` (+ optional folder drill by id).
- `playlistTracks` `{id, offset, limit}` → page of the playlist's tracks (cached under `pl:<id>`).
- `playlistCreate` `{name}` → `root.newPlaylist()`+name+commit → `{id}`.
- `playlistRename` `{id, name}`, `playlistDelete` `{id}`.
- `playlistAdd` `{id, token, index?}` → add cached token's track(s) to playlist; `playlistRemove` `{id, trackIndex}`; `playlistReorder` `{id, from, to}` → `moveTrackAsync`/`reorderAsync`.

`status` already provides now-playing. All new handlers are async, wrapped, and return structured results/diagnostics. Bump addon to **0.4.0**.

## 4. PWA — multi-tab app (`src/web/`)
- **Bottom tab bar:** ▶ Now-Playing · 🎵 Library · ☰ Playlists. Single-page, JS view-switching (no framework; keep it light).
- **Now-Playing tab:** the current Phase 2 screen (art, transport, seek, shuffle/repeat, queue) unchanged.
- **Library tab:** a search field (debounced → `lib{view:'all',q}`); segmented control Artists/Albums/Genres/Years/All; tap a row → `open` drill-down → track list; each track/album/artist row has a "…" action sheet: **Play now / Play next / Add to queue / Add to playlist**. Infinite scroll via `offset`/`limit`.
- **Playlists tab:** list playlists → tap → tracks (play/enqueue); **＋ New playlist**, rename/delete (long-press or edit mode), and within a playlist: remove (swipe) + reorder (drag handle) + "Add to playlist" target from anywhere.
- Reuse the existing `cmd()` relay; new views call the new commands. Now-Playing keeps polling ~1s; library/playlist views fetch on demand.

## 5. Companion
**No changes** (transparent relay). Stays companion-v0.1.0.

## 6. Build & verification
- Unit (Node): the pure command-dispatch already tested; add fake-`app` tests for `lib`/`open`/`play`/`playlists`/playlist-CRUD where deterministic (fake collection/playlist objects asserting the right native calls + paging math). The cache/token logic is unit-testable with fakes.
- Live (Mac on LAN): after deploy, `curl` `lib`, `open`, `play`, `playlists`, `playlistCreate`/`Add`/`Reorder`/`Delete` against the real addon; confirm against the 6438-track library; iterate on list-item shape / years accessor as needed (temporary introspect command). Then test the multi-tab PWA on the iPhone.

## 7. Out of scope (Phase 3)
PWA home-screen install / QR / `mamamonkey.local` (Phase 4), the Barbie-pink theme + icon + description (Phase 4 polish), companion auto-update, auth/PIN.
