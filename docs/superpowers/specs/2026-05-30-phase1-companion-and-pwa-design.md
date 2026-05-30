# MamaMonkey — Phase 1 Design: Companion + PWA (core transport remote)

**Date:** 2026-05-30
**Status:** Approved (design)
**Builds on:** Phase 0 (addon control API proven) and `2026-05-30-adr-approach-b-hybrid.md`.

## 1. Goal

Give the iPhone a real screen. A small PC **companion** serves a mobile **PWA** and relays its commands to the proven addon. Phase 1 scope: **now-playing (title/artist/album + read-only progress) + transport (play/pause/prev/next) + volume.** (Seek/queue/album-art = Phase 2; library/playlists = Phase 3; PWA-install/QR/`mamamonkey.local` = Phase 4.)

## 2. Architecture (B-hybrid, validated in Phase 0)

```
iPhone PWA ──http (same origin)──► Companion (exe on PC, 0.0.0.0:8088)
                                     ├─ serves the embedded PWA (HTML/CSS/JS)
                                     └─ POST /api/command ─► POST http://127.0.0.1:<MMport>/
                                                              header MMCustomRequest:true, JSON body
                                                              ─► addon remoteRequest ─► app.player.*
```
- Same-origin for the PWA's calls (no CORS); companion→addon is server-to-server (no CORS); companion runs on localhost relative to MM (no device-auth prompt).
- MM media-server port default **18391** (configurable); companion serve port default **8088** (configurable).

## 3. Components

### 3.1 Addon → v0.2.0 (small extension)
Extend the existing `status` command handler (in `src/addon/init.js` `buildHandlers()`) to return, in addition to current fields:
- `artist` — `track.artist`
- `album` — `track.album`
- `positionMs` — `app.player.trackPositionMS`
- `durationMs` — `app.player.trackLengthMS`

(Field names verified against MM's `Native.Player` API; wrapped in try/catch, null on absence. Transport + `setVolume` already exist. No new commands needed for Phase 1.) Bump addon to **0.2.0**; ships via the existing `.mmip` pipeline.

### 3.2 Companion (`src/companion/`, Node-compatible JS)
- **`server.js`** — HTTP server (Node `http`):
  - `GET /` and static assets → serve the embedded PWA.
  - `POST /api/command` → read JSON body, forward to `http://127.0.0.1:<mmPort>/` via `fetch` with header `MMCustomRequest: true`, return the addon's JSON (status passthrough; 502 + JSON error on failure/timeout).
  - On listen: log all LAN URLs (`http://<each-LAN-IP>:<port>`) so the user knows what to open on the phone.
- **`config.js`** — resolve `{ servePort=8088, mmHost='127.0.0.1', mmPort=18391 }` from CLI flags / env / defaults (pure, testable).
- **`assets.js`** — generated at build by `scripts/bundle-web.mjs`: an in-memory map `{ path -> {contentType, bytes} }` of `src/web/*`, so the server serves from memory and the PWA embeds cleanly into the single exe. (Pure data; the bundler is testable.)
- **Dev:** `node src/companion/server.js` (after `npm run bundle-web`). **Tests:** `node:test` for config parsing, the command-proxy (against a stub MM server), and the asset bundler.
- **Package:** `bun build --compile --target=bun-windows-x64 src/companion/server.js --outfile dist/MamaMonkeyCompanion.exe` → single Windows exe with assets embedded.

### 3.3 PWA (`src/web/`)
- `index.html`, `app.js`, `style.css` — one mobile-first screen (plain JS, no framework):
  - now-playing: title / artist / album; read-only progress bar from `positionMs`/`durationMs`.
  - transport: ⏮ / ⏯ (play-pause, reflecting `isPlaying`) / ⏭.
  - volume slider (0–1) → `setVolume`.
  - polls `POST /api/command {target:'mamamonkey',command:'status'}` every ~1s; buttons POST the matching command then refresh.
- `manifest.webmanifest` + viewport meta (basic; full install polish = Phase 4).

## 4. Command protocol (companion ↔ PWA ↔ addon)
The PWA posts the **same** envelope the addon already accepts, through the companion:
`{"target":"mamamonkey","command":"status|play|pause|playpause|next|prev|setVolume","args":{...}}`
The companion is a transparent relay (adds only the `MMCustomRequest` header), so the protocol stays single-sourced.

## 5. Repository additions
```
src/
  addon/        (existing; status extended, v0.2.0)
  companion/    server.js, config.js, assets.js(generated)
  web/          index.html, app.js, style.css, manifest.webmanifest
scripts/
  bundle-web.mjs       (src/web → src/companion/assets.js)
.github/workflows/
  companion-release.yml (tag 'companion-v*' → bun --compile → GitHub Release with the .exe)
```
`assets.js` is generated (gitignored). Addon release stays on `v*.*.*` tags; companion release on `companion-v*` tags → **two independent release streams**.

## 6. Distribution
- **Addon:** `.mmip` via existing auto-update pipeline (raw-hosted, `updateUrl`).
- **Companion:** single `.exe` attached to its own GitHub Release. Companion auto-update is **out of scope for Phase 1** (revisit in Phase 4); for now the user downloads/replaces the exe.

## 7. Out of scope (Phase 1)
Album art, seek/scrub, queue, shuffle/repeat, library/playlists, PWA home-screen install, QR, mDNS/`mamamonkey.local`, companion autostart, companion auto-update, auth/PIN.

## 8. Verification
- **Local (Mac, on the same LAN):** run the companion with Node, point it at the real addon (`192.168.1.98:18391`); load the PWA in a desktop browser and from the iPhone (Mac's LAN IP) — confirm now-playing reads live state and transport/volume control MM.
- **On the PC:** run the compiled `.exe`; open the printed URL from the iPhone; confirm end-to-end.
- Unit tests: config parsing, command-proxy (stub MM), asset bundler, addon status fields.
