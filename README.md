# 🦸‍♀️ MamaMonkey

A web-based remote control for **MediaMonkey** (the "2024"/5.x line) on Windows, driven from an iPhone (or any phone/browser) on the same Wi-Fi. Now-playing, full library browse/search, playlists (incl. editing), volume, seek, shuffle/repeat, ratings — all controlling the PC's MediaMonkey, wrapped in a pink "SuperMama" theme installable to the iPhone home screen.

> Built as a Mother's Day gift 💕. Works great as a general MediaMonkey phone remote too.

---

## What it is (3 pieces)

```
 iPhone PWA  ──http (same Wi-Fi)──►  Companion (small .exe on the PC)
  (home-screen app)                   ├─ serves the PWA
                                      ├─ /api/command  ─┐  POST + "MMCustomRequest" header
                                      ├─ mamamonkey.local (mDNS) + QR
                                      └─ auto-update + settings
                                                         │
                                      MediaMonkey media server :18391
                                                         │  remoteRequest event
                                                         ▼
                                      MamaMonkey addon (.mmip)  ─►  app.player / app.db
```

1. **Addon** (`src/addon/`, a `.mmip`) — runs inside MediaMonkey. It's the only thing that can touch MM. It listens on MM's media-sharing server (`remoteRequest`) and runs commands against `app.player` / `app.db`. Distributed + **auto-updated** from GitHub.
2. **Companion** (`src/companion/`, a single Windows `.exe`) — runs on the same PC. Serves the PWA over HTTP and relays the app's commands to the addon (server-to-server, so no browser CORS/mixed-content issues). Also does mDNS (`mamamonkey.local`), a startup QR code, **self-update**, auto-start, and a settings API.
3. **PWA** (`src/web/`) — the phone UI (plain HTML/CSS/JS, no framework). Embedded inside the companion `.exe`. Three tabs + settings.

**Why this split?** MM5 addons are sandboxed browser JS that can only answer `POST` requests carrying an `MMCustomRequest` header on MM's media-sharing port — they can't serve a web page to a phone browser. So a tiny companion serves the UI and bridges to the addon. See `docs/ARCHITECTURE.md`.

---

## Features

- **Now-Playing:** album art, title/artist/album, live progress + **seek**, ⏮ ⏯ ⏭, **volume**, **shuffle**, **repeat** (off/all/one), **queue** view + tap-to-jump.
- **Library:** **search** the whole library; browse by **Artists / Albums / Genres / ★ ratings**; drill into tracks; **Play now / Play next / Add to queue / Add to playlist**; **Tout lire / Mélanger** (play/shuffle the whole library or current results); **load-more** paging for big lists.
- **Playlists:** list, open, play/enqueue; **create / rename / delete**; **add / remove** tracks; **reorder** (↑/↓).
- **Comfort:** installable PWA (home-screen icon, full-screen), `mamamonkey.local`, QR connect, **zero-manip auto-update** (addon *and* companion), Windows auto-start, in-app **settings** (ports), pink theme + custom icon.

**Not supported:** reordering the *now-playing queue* (modifying MM's live playing list freezes MM — no safe API). Playlist reorder works fine.

---

## Install (for the end user)

1. **Addon:** open the latest `mamamonkey-X.Y.Z.mmip` (from [Releases](https://github.com/J7U7G7/MamaMonkey/releases)) in MediaMonkey. It then **auto-updates** itself. Make sure MM's **Media Sharing** is enabled (Tools → Options → Media Sharing).
2. **Companion:** download `MamaMonkeyCompanion.exe` from the latest `companion-v*` release, run it (SmartScreen → "More info" → "Run anyway"; allow through the firewall on private networks). Optionally run it once with `--install-startup` so it launches with Windows. It then **self-updates** from GitHub. The console shows the URL + a QR code.
3. **iPhone:** open **`http://mamamonkey.local:<port>`** (default port `8088`) or scan the QR, then **Add to Home Screen**.

> The companion replaces its own `.exe` in place during updates, keeping the same filename — so a desktop/Start-menu shortcut to it always launches the current version (clicking the shortcut is the reliable way to relaunch after an update).

---

## Develop

Requires Node 22+ (dev/test) and [Bun](https://bun.sh) (only to compile the companion `.exe`).

```bash
npm install
npm test                 # unit tests (pure logic, run via node:test in a vm sandbox)
npm run build            # build dist/mamamonkey-<version>.mmip
npm run bundle-web       # regenerate src/companion/assets.js from src/web/ (gitignored)
npm run companion:dev    # bundle-web + run the companion locally (Node)
npm run gen-icons        # regenerate src/web/icons/*.png from src/web/icon.svg (needs sharp)
```

**Live-testing trick:** if your dev machine is on the same Wi-Fi as the PC, you can curl the running addon directly — no UI needed:

```bash
curl -s -X POST http://<PC-IP>:18391/ -H "MMCustomRequest: true" -H "Content-Type: application/json" \
  -d '{"target":"mamamonkey","command":"ping"}'
```

Commands: `ping`, `status`, `play/pause/playpause/next/prev`, `seek {ms}`, `setVolume {value}`, `setShuffle {on}`, `setRepeat {mode}`, `queue {limit}`, `jump {index}`, `getArt`, `lib {view,q,offset,limit}`, `libTracks {by,value}`, `play {token,index,mode}`, `playlists`, `playlistTracks {id}`, `playlistCreate/Rename/Delete/Add/Remove/Reorder`, `introspect`.

## Release (two independent streams)

```bash
# Addon: bump "version" in src/addon/info.json + package.json + MM.VERSION in src/addon/init.js, then:
git tag vX.Y.Z && git push origin vX.Y.Z

# Companion exe:
git tag companion-vX.Y.Z && git push origin companion-vX.Y.Z
```

- `release.yml` (on `v*.*.*`): tests → builds the `.mmip` → GitHub Release → rewrites `update.json` (committed to `main`, served raw). MM reads `info.json`'s `updateURL` → `update.json` (key **`updateUrl`**) → downloads the `.mmip` from the **raw** URL (not the release asset — GitHub release URLs 302-redirect and MM won't follow).
- `companion-release.yml` (on `companion-v*`): tests → `bun build --compile --target=bun-windows-x64` → GitHub Release with the `.exe`. Embeds the version into `src/companion/version.js`.

## Repo layout

```
src/addon/      MM addon — bundled into a single init.js at build (MM only loads init.js + *_add.js)
  init.js       all runtime logic (boot, remoteRequest dispatcher, all command handlers)
  lib/          pure, unit-tested helpers (log-buffer, commands, pages…)
  info.json     MM manifest (id, version, updateURL)
src/companion/  Node/JS HTTP server compiled to a Windows .exe via Bun
src/web/        the PWA (index.html, app.js, style.css, icon.svg, icons/)
scripts/        build.mjs, bundle-web.mjs, write-update-manifest.mjs, gen-icons.mjs
docs/           ARCHITECTURE.md (how it works + gotchas) + superpowers/ (per-phase specs & plans)
.github/workflows/  release.yml (addon) + companion-release.yml (exe)
update.json     the addon auto-update manifest (served raw); download/  the raw-hosted .mmip
```

## The gauntlet — MediaMonkey quirks we rode out 🥷

Half the work was discovering, the hard way, how MM5/2024 actually behaves (the docs are thin and several APIs differ from them). If you're building an MM addon, this list alone may save you days:

1. **Addons can't serve a web page.** MM's only network hook (`remoteRequest`) fires only for `POST` + `MMCustomRequest` header + JSON — a phone GET never reaches it. → split into addon + companion.
2. **MM loads only `init.js` / `*_add.js`**, not arbitrary helper files. → bundle everything into one `init.js` at build time.
3. **Auto-update manifest key is `updateUrl`** (camelCase), while `info.json`'s field is `updateURL` (uppercase). One wrong key = silent failure.
4. **GitHub release URLs 302-redirect** and MM's updater doesn't follow → it saved 0 bytes ("error reading zip"). → host the `.mmip` on `raw.githubusercontent.com`.
5. **Album art isn't loaded synchronously** — must `loadCoverListAsync()` then `getThumbAsync()`, normalize the `C:\…`/`file://` path, and base64 it yourself.
6. **`app.collections` has no list getters** (it's a manager) and `filterBySearchPhrase` is a no-op → browse/search via raw SQL on the `Songs` table.
7. **Reordering the live now-playing queue freezes MM** — no safe API; abandoned (playlist reorder works fine).
8. **Self-updating a Windows `.exe`** that's replacing itself: Mark-of-the-Web/SmartScreen blocks the silent relaunch, and the swap races the still-locked exe → retry-`move` + `Unblock-File` + `Start-Process`, with a stable-filename shortcut as the reliable fallback.
9. **`mamamonkey.local` needs an explicit A record** (advertising the service isn't enough) → `multicast-dns`.
10. **iPhone PWA safe-areas** (notch/home-indicator) + an attribute-vs-CSS `hidden` override.

Every one of these is documented with the fix in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## For the MediaMonkey community 🐒

If you run MediaMonkey on a PC and want a proper **mobile remote++** to drive it over your home network — now-playing with art, full library search/browse, ratings, playlist editing, all installable as a phone app with zero-manip auto-updates — MamaMonkey is meant to be shareable. It's self-hosted, $0 (GitHub-distributed), and needs no account or cloud. Contributions / issues welcome.

## Credits

Made with care by **J7U7G7** (idea, direction, and relentless live-testing on the real MediaMonkey) in pair-programming with **Claude (Anthropic)** — design, implementation, and a lot of MM-API archaeology. A genuinely fun build; every wall above became a small victory. 🦸‍♀️🎵💕

## License / notes

Project code is the authors'. `SampleScripts.zip` (Ventis Media's MediaMonkey sample scripts, used only as API reference) is gitignored and not redistributed.

See **`docs/ARCHITECTURE.md`** for the design rationale, the MediaMonkey API cheat-sheet, every hard-won gotcha, and how to resume/extend the project.
