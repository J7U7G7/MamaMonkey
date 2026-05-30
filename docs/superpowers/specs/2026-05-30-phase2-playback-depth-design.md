# MamaMonkey — Phase 2 Design: Playback Depth

**Date:** 2026-05-30
**Status:** Approved (design)
**Builds on:** Phase 1 (companion + PWA + addon v0.2.0). Companion is unchanged in Phase 2 (transparent relay).

## 1. Goal
Add seek/scrub, shuffle/repeat, album art, and a now-playing queue (view + jump). All via the existing addon `remoteRequest` channel + PWA. **Reorder/remove queue items is deferred** (no officially-supported MM Player API — verify later).

## 2. MM5 APIs (researched, confirmed via docs)
- Seek: `app.player.seekMSAsync(ms)`.
- Shuffle/repeat: booleans `app.player.shufflePlaylist`, `repeatPlaylist`, `repeatOne` (read/write). 3-state repeat = derived (off: both false; all: repeatPlaylist; one: repeatOne).
- Art: `track.coverList` → `getValue(0).getThumbAsync(w, h, cb)` → `cb(fileUrl)` (a `file:///…` thumb path). Convert to base64 in the addon (read the file). *Runtime unknown:* how to read the local file in MM's sandbox (try `fetch(fileUrl)→arrayBuffer`, fallback to MM filesystem API) — validated live from the Mac after deploy.
- Queue: `app.player.getTracklist()` (5.0.4+) with `whenLoaded()`/`locked()`/`count`/`getValue(i)`; current index `app.player.playlistPos`; jump `app.player.setPlaylistPosAsync(idx)`.

## 3. Addon → v0.3.0 (new commands + status fields)
New `remoteRequest` commands (added to `buildHandlers()` in the bundled `init.js`):
- `seek` `{ms}` → `seekMSAsync(clamp(ms,0,trackLengthMS))`.
- `setShuffle` `{on}` → `shufflePlaylist = !!on`.
- `setRepeat` `{mode:'off'|'all'|'one'}` → set the two booleans accordingly (mutually exclusive).
- `getArt` → resolve `{ ok, key, dataUrl }` where dataUrl is `data:image/jpeg;base64,…` for the current track's cover (or `{available:false}`); async (coverList → whenLoaded → getThumbAsync → read file → base64). Returns the same `key` as status `trackKey` so the PWA can cache per track.
- `queue` `{limit?=200}` → `{ index, count, items:[{title,artist}] }` from the tracklist (locked/whenLoaded), capped at `limit` (log if truncated).
- `jump` `{index}` → `setPlaylistPosAsync(index)` then `playAsync()`.

`status` result gains: `shuffle` (bool), `repeatAll` (bool), `repeatOne` (bool), `queueIndex` (= `playlistPos`), `trackKey` (string identifying the current track, e.g. its `summary`, used by the PWA to know when to refetch art).

Bump addon to **0.3.0**; ships via the existing `.mmip` pipeline.

## 4. PWA additions (`src/web/`)
- **Album art**: `<img>` in the art box; when `status.trackKey` changes, call `getArt` and set the image (cache by key). Fallback to the ♪ placeholder.
- **Seek**: progress bar becomes interactive — tap/drag maps x-fraction × `durationMs` → `seek`. Optimistic UI; reconciled by polling.
- **Shuffle / repeat**: two buttons under transport. Shuffle highlights when on. Repeat cycles off → all → one with distinct icons (🔁 / 🔂), reflecting `repeatAll`/`repeatOne`.
- **Queue**: a toggle button opens a panel listing `queue.items`; current row (`queueIndex`) highlighted; tapping a row → `jump {index}` then refresh. (No reorder in Phase 2.)
- Polling unchanged (~1s) for status; art fetched only on track change; queue fetched when the panel opens (and on track change while open).

## 5. Companion
**No changes.** It already relays any `{target,command,args}` to the addon and returns the response (including the base64 art payload). Stays at companion-v0.1.0 unless a fix is needed.

## 6. Testing / verification
- Unit (Node): extend `test/init.test.mjs` with a fake player to assert `seek` (clamping + calls seekMSAsync), `setShuffle`, `setRepeat` (the three modes set the right booleans), and `queue` (reads a fake tracklist, returns index+items). Art is MM-glue → covered by live test.
- Live (Mac on LAN, after deploy): `curl` the new commands against the real addon — `setShuffle`, `setRepeat`, `seek`, `queue`, and especially `getArt` (confirm base64 returns; iterate on the file-read approach if needed). Then test the PWA on the iPhone.

## 7. Out of scope (Phase 2)
Queue reorder/remove (deferred — API uncertain), library/playlists (Phase 3), PWA install/QR/mDNS (Phase 4), companion auto-update.
