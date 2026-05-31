# MamaMonkey — Phase 4 Design: Polish (the rest, in one block)

**Date:** 2026-05-31
**Status:** Approved (design)
**Builds on:** Phase 3 (addon v0.4.4, companion-v0.2.3, themed PWA). Done as one block; fine-tuning after.

## 1. Goal
Make it effortless and complete for SuperMama: reach the app without typing an IP, zero-manip updates, a settings screen, rating-based browsing, and the deferred finitions.

## 2. Scope (one block)

### Companion (Node/JS → exe)
- **mDNS / `mamamonkey.local`**: advertise via Bonjour (`bonjour-service`, pure-JS, bundles in the bun exe). The iPhone opens `http://mamamonkey.local:<port>`. Console + QR reflect this name (with the IP as fallback).
- **QR code at startup**: render the connect URL as an ASCII QR in the console banner (`qrcode` → terminal string, pure-JS). Scan from the iPhone, no typing.
- **Real auto-update (self-replacing exe)** — the risky one, done defensively:
  - Embed `COMPANION_VERSION` at build time (release workflow writes `src/companion/version.js` = the `companion-vX.Y.Z` tag; server.js imports it, fallback `'dev'`).
  - On startup (after the server is up), query the GitHub API for the latest `companion-v*` release; if newer than `COMPANION_VERSION`, download its `.exe` to a temp file next to the running exe, **verify size (>40 MB)**, back up the current exe to `*.bak`, write an `mm-update.bat` that waits for this process to exit, swaps the new exe in, relaunches it, and deletes itself; then spawn the bat detached and `process.exit(0)`. On ANY failure (download/size/spawn), log and keep running the current version (never break the install). Skips when `COMPANION_VERSION === 'dev'` (local runs).
- **Auto-start with Windows**: a `--install-startup` flag (and a one-time prompt/printed hint on first run) that writes a shortcut/`.bat` to the user's `shell:startup` folder pointing at the exe. A `--uninstall-startup` to remove it. Best-effort; never fatal.
- **Settings backend**: read/write a `mamamonkey-config.json` next to the exe (`{ servePort, mmHost, mmPort, autoStart }`). New endpoints: `GET /api/config` and `POST /api/config`. Changing `mmHost/mmPort` applies live (the proxy reads current config). Changing `servePort` is persisted and takes effect on next launch (documented in the UI). PIN is scaffolded (config field) but not enforced in v1 (user chose "open on the network").

### Addon (v0.5.0)
- **Rating browse**: `lib {view:'ratings'}` → `SELECT * FROM Songs WHERE Rating > 0 GROUP BY Rating ORDER BY Rating DESC` → items mapped to a stars label (`Rating/20` → ★). Drill via `libTracks {by:'rating', value:<ratingNumber>}` → `WHERE Rating = <num>`. (Verify the `Rating` column + 0–100 scale live.)
- **Play-now resume fix**: ensure playback actually starts (after `addTracksAsync({withClear,startPlayback,focusedTrackIndex:0})`, if `!isPlaying` call `playAsync()`; small retry). Already partially addressed in 0.4.4 — confirm/strengthen.
- (`playlistReorder` already exists — no addon change needed for reorder; it's a PWA drag UI.)

### PWA
- **Settings tab/screen**: shows connection info (the `mamamonkey.local` URL + IP + QR hint), lets you edit MM port (live) and serve port (with a "restart needed" note), toggle auto-start, and a disabled PIN field (coming later). Calls `GET/POST /api/config`.
- **Ratings segment** in Library (alongside Artists/Albums/Genres) → star groups → drill.
- **Load-more pagination**: lists request the next page via `offset` when scrolled near the bottom (or a "Load more" button); the addon already returns `truncated`/`total`.
- **Playlist reorder (drag)**: drag handles on playlist-track rows → `playlistReorder {id, from, to}` (handler exists). Touch-drag on mobile.

## 3. Distribution
- Addon → v0.5.0 (auto-update pipeline as usual).
- Companion → next `companion-v*` (now self-updating from this version forward). Auto-start makes it launch with Windows.

## 4. Verification
- **Live from the Mac (now)**: rating browse + drill, play-now resume, reorder, load-more (via curl + PWA).
- **On the PC (user-assisted)**: `mamamonkey.local` resolves from the iPhone; QR scan opens the app; **the self-update** (install this companion, then ship the next version, confirm it auto-replaces on launch); auto-start after reboot; settings persist.

## 5. Risk notes
- **Self-update** can't be tested from the Mac (Windows-only) and could disrupt the install if wrong → built defensively (size check, `.bak` backup, fail-safe to current version). First real auto-update is a user-assisted verification step.
- mDNS may be blocked by some routers; QR + IP remain the fallback.

## 6. Out of scope / later
Enforced PIN/auth, multi-user, streaming audio, advanced playlist features (smart playlists), localization.
