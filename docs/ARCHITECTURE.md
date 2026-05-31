# MamaMonkey — Architecture & Resume Guide

This is the single doc to read before resuming or extending MamaMonkey (whether you're a person or a fresh Claude Code instance). It captures the design, the MediaMonkey API reality, every hard-won gotcha, and the workflows. Per-phase specs/plans live under `docs/superpowers/`.

## Current state (keep this updated)

- **Addon:** `v0.5.5` · **Companion:** `companion-v0.3.6` · tests: green (60).
- The PWA is **network-resilient** (companion-v0.3.5): commands have a 4s timeout, polling skips while in-flight, the last screen stays on a dropped connection with a "Reconnexion…" pill, and it auto-recovers — so weak-Wi-Fi micro-drops are invisible. (Root cause of drops = the PC's own Wi-Fi quality; fix that with Ethernet/powerline/2.4GHz.)
- Repo `git@github.com:J7U7G7/MamaMonkey.git`, default branch `main`. GitHub Actions auto-release on tags. `update.json` served via `raw.githubusercontent.com`.
- Feature-complete per the original vision (now-playing, library, playlists, ratings, comfort/polish). See README "Features".

## The architecture (Approach "B-hybrid") and *why*

MediaMonkey 5/2024 addons are **sandboxed browser JS**: no Node, no raw sockets. The **only** way an addon receives network input is MM's media-sharing server `remoteRequest` event, which fires **only for `POST` requests with an `MMCustomRequest` header + JSON body**. A phone browser loading a page sends a plain `GET` (no such header) → never reaches addon code. **So a pure addon cannot serve the phone UI.**

Hence three pieces (see README diagram): **addon** = MM control API; **companion** = serves the PWA + relays commands (server→server, adding the header, so no CORS/mixed-content); **PWA** = the UI, embedded in the companion exe. The companion talks to the addon over `http://127.0.0.1:18391/` (loopback → no MM device-auth prompt).

Command envelope (PWA → companion `/api/command` → addon → back):
`{"target":"mamamonkey","command":"...","args":{...}}` → addon returns `{ok, command, result}` (the companion relays it verbatim; the PWA must read `.result`).

## MediaMonkey API cheat-sheet (all live-verified on 2024.2.2.3222)

- **Addon mechanics:** MM loads only `init.js` (startup) and `*_add.js` (appended to built-ins). It does **not** load arbitrary helper files → the build **bundles** `lib/*.js + mm-bindings.js + logger.js + init.js` into one `init.js`. Boot at top level (like the official `remoteControl` sample), not gated on `whenReady`. Detect entry with `import.meta.main`.
- **Request hook:** `app.listen(app, 'remoteRequest', r => { r.asyncResult = true; … r.responseBody = JSON })`.
- **Player:** `app.player.playAsync/pauseAsync/playPauseAsync/nextAsync/prevAsync/stopAsync`, `seekMSAsync(ms)`, `volume` (0–1), `isPlaying`/`paused`, `trackPositionMS`/`trackLengthMS`, `getCurrentTrack()`, `shufflePlaylist`/`repeatPlaylist`/`repeatOne` (booleans), `playlistPos`, `setPlaylistPosAsync(i)`, `getTracklist()` (now-playing), `addTracksAsync(tracklist, {withClear,startPlayback,afterCurrent,position,focusedTrackIndex})`.
- **Library:** `app.collections` is a *manager*, NOT a list (no `getArtistList`). Query the DB instead: `app.db.getTracklist(sql, -1)` (collID `-1` = whole library) returns a Tracklist (`.whenLoaded()` → `.locked()` → `.count`/`.getValue(i)`/`.getRange()`). Table is **`Songs`**, columns **`SongTitle`/`Artist`/`Album`/`Genre`/`Rating`** (`Rating` 0–100, 20 = 1★). `filterBySearchPhrase` is a **no-op** on this build → search uses SQL `LIKE` (escape `'`→`''`). Browse = `SELECT * FROM Songs … GROUP BY Artist/Album/Genre/Rating`.
- **Album art:** `getCurrentTrack().coverList` is NOT populated synchronously — `t.loadCoverListAsync()` (or `coverList.whenLoaded()`) first, then `coverList.getValue(0).getThumbAsync(300,300, cb)` → a `file:///` (or `C:\…`) path → normalize to `file:///` → `fetch().blob()` → `FileReader.readAsDataURL` → base64 returned by the `getArt` command. Guarded by a 6s timeout.
- **Playlists:** `app.playlists.root.getChildren()` (each: `id`, `title`, `childrenCount`), `app.playlists.getByIDAsync(id)`, `playlist.getTracklist()`, `newPlaylist()` + `name` + `commitAsync()`, `addTracksAsync/removeTrackAsync/moveTrackAsync(mv, before)/deleteAsync`. Reorder = `moveTrackAsync(track[from], track[to])` (inserts before `to`).
- **Now-playing queue reorder: DON'T.** Mutating the live list (`remove`/`insert`/`commit` on `getTracklist()`) **freezes MM's request handling**. No safe API. `queueMove` is a no-op stub. (If you ever call a queue-mutating command and the addon goes silent, restart MM.)

## Distribution gotchas (all fixed, don't regress)

- **Update manifest key is `updateUrl`** (camelCase) in the JSON `update.json` — NOT `downloadURL`. `info.json`'s field is `updateURL` (uppercase). Casing asymmetry is real.
- **Serve the `.mmip` from `raw.githubusercontent.com`**, not the GitHub release asset URL — release URLs `302`-redirect and MM's updater doesn't follow them (saves 0 bytes → "error reading zip"). The release workflow commits the built `.mmip` to `download/` on `main`.
- **Companion self-update** (Windows): download new exe → verify >40MB → back up to `.bak` → write `mm-update.bat` (retry-`move` until the old exe unlocks, `Unblock-File` to strip Mark-of-the-Web/SmartScreen, `Start-Process` to relaunch) → spawn detached → `process.exit`. The relaunch is finicky (each fix only applies once running the version that has it); **the reliable fallback is that the exe keeps its name, so any shortcut / Windows auto-start relaunches the updated version.** Can't be tested from a Mac.
- **mamamonkey.local:** `bonjour-service` advertised the *service* but no hostname A record → use `multicast-dns` to answer A queries for `mamamonkey.local` with the LAN IP. QR encodes the LAN IP (guaranteed) since `.local` can be network-flaky.
- **PWA caching:** companion serves assets with `Cache-Control: no-store` so phones never keep a stale UI after an update.
- **iPhone safe areas:** `#app` needs `padding-top: env(safe-area-inset-top)` + bottom padding for the tab bar/home indicator; `[hidden]{display:none!important}` (a `.art{display:flex}` rule overrode the `hidden` attribute).

## Security posture (after the v0.5.5 audit)

Threat model = trusted home LAN, **no auth by design** (v1). Audited; hardened:
- **SQL injection: safe** — search/`libTracks` escape `'`→`''` (SQLite literals); rating is numeric; browse columns are a fixed whitelist.
- **Static serving: safe** — assets are a fixed in-memory map; no filesystem per request → no path traversal.
- **getArt `fetch('file://')`: safe** — path derives from the *current track*, never request args.
- **Companion `/api/config`: hardened** — only `mmPort`/`servePort` are network-settable and validated; `mmHost` is NOT (stays local, default `127.0.0.1`) so the relay can't be turned into an SSRF pivot. Set `mmHost` via CLI/config file only.
- **`/api/command`: open relay by design** (LAN). Removed `introspect` (info disclosure) and the `queueMove` stub. If you ever distribute widely, consider a relayable-command allowlist + a PIN.
- **Self-update: HTTPS from GitHub** + size + **PE-magic (`MZ`)** check before executing. No signature/hash pinning yet — **for public distribution, publish & verify a SHA-256** (or Authenticode-sign the exe). It strips Mark-of-the-Web to relaunch, so the integrity check is the only gate.
- **Remaining design choices (not bugs):** optional PIN (config scaffolds it), and the CI commits the served `.mmip` to `main` (raw hosting is required because release URLs 302-redirect).

## Workflows

- **Build/test:** see README "Develop". Tests load the real addon `lib/*.js` files via `node:vm` (`test/helpers/load-addon-script.mjs`) — pure logic only; MM glue is verified live.
- **Release:** bump versions, tag `vX.Y.Z` (addon) or `companion-vX.Y.Z` (companion), push the tag. Watch the run; the addon `update.json` flips on `main` (raw has ~5 min cache).
- **Verify live (Mac on the PC's LAN):** `curl` the addon at `http://<PC-IP>:18391/` with the `MMCustomRequest` header (see README). For the companion, `GET http://<PC-IP>:8088/api/config` returns the running version. This is how every MM-side feature was validated without running on Windows.
- **Resuming as a fresh Claude instance:** read this file + `README.md`. The repo path also has persistent memory (`MEMORY.md` + notes) that auto-loads for this project; it mirrors these facts.

## Ideas not yet built (optional)

- Optional PIN/auth (companion config already scaffolds it; "open on LAN" chosen for v1).
- Desktop shortcut auto-created by the companion (`--install-startup` only does the Startup folder today).
- Light/dark theme toggle, sleep timer, lyrics.
- Albums/genres browse could show counts; rating drill sometimes shows empty artists (library tag data, not a bug).
