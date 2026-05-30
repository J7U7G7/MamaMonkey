# MamaMonkey — Phase 0 Design: "The Update Spine"

**Date:** 2026-05-30
**Status:** Approved (design); pending spec review
**Scope of this document:** Phase 0 only. Later phases are sketched for continuity but specced separately.

---

## 1. Project context (the whole of MamaMonkey)

MamaMonkey is a web-based remote control for **MediaMonkey 5** (latest version, "MediaMonkey 2024", 5.x) running on a Windows PC. It lets an **iPhone on the same home Wi-Fi** control playback and the library through a browser-based app that *feels* like a native app.

**Target user experience (final product):**
- Control library, playlists, the Now-Playing queue, volume, and transport (play/pause/stop, prev/next) from the phone.
- See now-playing info (title/artist/album), album art, and live progress; seek/scrub; toggle shuffle/repeat.
- Installable to the iPhone home screen as a **PWA** (app icon, full-screen, splash).
- Reachable at a friendly address (`mamamonkey.local`) where technically possible, with a **QR code** shown on the PC for first connection.
- **Open on the home network** in v1 (no login). Code structured so a shared PIN can be added later without a rewrite.

**Non-functional priorities (what "scalable" means here):**
- Easy to **extend/maintain** — small, single-purpose modules with clear interfaces.
- **Fast with a large library** (tens of thousands of tracks) — paging/lazy-loading on mobile (relevant from Phase 3).
- **Easy install + auto-update** via GitHub releases, at **zero hosting cost**.

**Explicitly out of scope (whole project):** simultaneous multi-phone synchronization is *not* a hard requirement (optimize for a single primary user; don't actively break multi-device). Streaming audio to the phone is not a goal — this is a *remote control*, audio plays on the PC.

---

## 2. The central architecture decision (A vs B)

MediaMonkey 5 addons are **sandboxed browser JavaScript** — no Node.js APIs (`require`/`http`/`net`/`fs`), no raw socket binding. However, MM5 ships a **built-in HTTP server** (the UPnP/DLNA "Media Sharing" server on a user-configurable port) and an official `sampleScripts/remoteControl/` addon demonstrates hooking it to receive HTTP requests. The control API we need (`app.player` for transport/volume/queue, `app.db` for the library) is available to addons.

Two viable hosting architectures:

- **Approach A — Pure MediaMonkey addon (preferred end state):** a single `.mmip` that hooks MM's HTTP port to serve the PWA *and* answer the control/query API. One install, GitHub auto-update, no extra process, $0 — exactly matching the "plugin" vision. **Risk:** it is *unverified* whether a sandboxed addon can serve full GET/HTML (not just the POST/JSON pattern the sample shows), and mDNS (`mamamonkey.local`) almost certainly cannot run from the sandbox (we'd reach it via QR + IP instead).
- **Approach B — Companion server on the PC (robust fallback):** a small packaged server (e.g., Node) that serves the PWA, runs mDNS for `mamamonkey.local`, generates the QR, handles big-library paging, and drives MM5 via the DevTools protocol (port 9222) or COM (`SongsDB5.SDBApplication.runJSCode`). Full capability, at the cost of a second installed component (still GitHub-distributed, still $0).

**Decision: "front-end first, host-flexible."** The iPhone PWA talks to a clean JSON API; the *host* behind that API can be A or B without changing the front-end. We pursue **A**, and **Phase 0 verifies the key unknown** (can the addon serve a web page over MM's HTTP port). If verification fails, we fall back to **B** with the same PWA and API contract. The user has approved this verify-then-fallback plan.

---

## 3. Phased roadmap (context for Phase 0; later phases specced separately)

Each phase is an independently installable release. We brainstorm → spec → implement **one phase at a time**.

- **Phase 0 — The update spine (THIS SPEC):** zero music features; prove install, GitHub auto-update, logging, HTTP-serving, plus a status panel.
- **Phase 1 — Core transport remote:** serve the PWA shell; now-playing (title/artist/album + live progress); play/pause/stop, prev/next, volume.
- **Phase 2 — Playback depth:** seek/scrub, shuffle/repeat, album art, Now-Playing queue (view/reorder/jump).
- **Phase 3 — Library & playlists:** browse + search library (paged/lazy), browse by artist/album, playlists (list/play/queue). The big-library performance work.
- **Phase 4 — "Real app" polish:** PWA install (home-screen/full-screen/splash), QR code from the PC, friendly hostname `mamamonkey.local` (depends on the A-vs-B outcome), settings panel (port; optional PIN later).

---

## 4. Phase 0 — goals and non-goals

**Goals (definition of done):**
1. A `.mmip` that installs into MM5 and boots cleanly on startup.
2. **GitHub auto-update works end-to-end:** pushing a version tag produces a new release that an already-installed addon detects and updates to.
3. **Autolog system:** a rolling log file plus an HTTP endpoint and a UI button to retrieve logs — our remote-debugging lifeline (developer cannot run on the Windows PC).
4. **HTTP serve-test:** the addon serves a "hello" web page over MM's HTTP port — resolving Approach A vs B.
5. **Status/liveness panel inside MediaMonkey:** shows version, LAN IP, port, and a "Copy logs" button.

**Non-goals for Phase 0:** any music/playback control, any PWA front-end, the iPhone UI, mDNS, QR code, authentication. (All deferred to later phases.)

---

## 5. Components (all inside the `.mmip`, plain modern JavaScript)

Each module is small and single-purpose with a clear interface.

- **`init.js`** — entry point. Runs on MM startup (wrapped in `window.whenReady()`), constructs the Logger, starts the HttpController, mounts the StatusPanel, and logs a boot line with the version. The idiomatic non-destructive injection (`*_add.js` / `init.js`) per MM5 addon conventions.
- **`logger.js` — `Logger`** — append-only rolling log to the addon's data folder (size-capped, oldest trimmed). API: `log(level, msg, data?)`, `getText()`, `clear()`. Used by every other module. Resilient: logging failures never crash the addon.
- **`http-controller.js` — `HttpController`** — registers request handlers on MM's Media-Sharing HTTP port (modeled on the `remoteControl` sample). Routes:
  - `GET /` → minimal HTML "hello" page (the A-vs-B serve-test).
  - `GET /health` → JSON `{ name, version, time, port }`.
  - `GET /logs` → `text/plain` dump of the rolling log (openable from the phone).
  - Each handler is registered through a small route table so later phases add routes without touching existing ones.
- **`status-panel.js` — `StatusPanel`** — a small panel/menu item in MM's UI showing: addon version, detected LAN IP (or MM's known sharing address as fallback), the port, the URL to open, and a **Copy logs** button (copies `Logger.getText()` to the clipboard).

**Packaging files:**
- **`info.json`** (at `.mmip` root) — `id`, `title`, `description`, `version` (`%d.%d.%d`), `type: general`, `author`, `minAppVersion`, `updateURL`, and `installScript`/`init` wiring per MM5 docs.

---

## 6. Data flows

**Flow A — Auto-update (the heart of Phase 0):**
1. Developer runs `git tag vX.Y.Z && git push --tags`.
2. **GitHub Action (`release.yml`)**: builds the `.mmip` via `build.mjs`, creates a GitHub Release with the `.mmip` attached, and rewrites `update.json` with the new version and the release-asset download URL.
3. **MM5 on startup** reads `info.json.updateURL` → fetches `update.json` from a stable raw GitHub URL → if the manifest version is newer than the installed version, downloads the `.mmip` and updates (prompting per MM's behavior).
4. Result: updated addon running. No servers, no hosting cost.

**Flow B — HTTP serve-test (A-vs-B verification):**
- A phone or PC browser hits `http://<PC-IP>:<MMport>/` → `HttpController` returns the hello page. Success confirms Approach A is viable; failure (or POST-only behavior) triggers the Approach B fallback decision. Outcome is logged.

**Flow C — Logging / remote debugging:**
- All modules call `Logger.log(...)`. The user retrieves logs three ways: `GET /logs` from the phone, the **Copy logs** button in the status panel, or directly from the log file on disk. Logs are pasted back to the developer for diagnosis.

---

## 7. Repository layout & tooling

```
mamamonkey/
├─ src/addon/
│   ├─ info.json
│   ├─ init.js
│   ├─ logger.js
│   ├─ http-controller.js
│   └─ status-panel.js
├─ scripts/
│   └─ build.mjs            # zips src/addon/ → dist/mamamonkey-vX.Y.Z.mmip
├─ .github/workflows/
│   └─ release.yml          # tag → build → GitHub Release → update update.json
├─ update.json              # manifest MM reads (served via raw.githubusercontent.com)
├─ docs/superpowers/specs/  # this spec and future phase specs
├─ .gitignore               # ignores dist/, node_modules/, .superpowers/
└─ README.md
```

**Decisions (approved):**
- **Plain modern JavaScript** for the addon (no transpile step → debugs directly in MM5's Chromium environment). TypeScript may be reconsidered for the PWA in later phases.
- **Auto-update manifest** = a committed `update.json` served via `raw.githubusercontent.com/<owner>/<repo>/main/update.json` (chosen over GitHub Pages for simplicity; `updateURL` in `info.json` points here). The Action rewrites it on each release.
- **Build tooling** runs on Node (now installed locally via Homebrew, v26).

---

## 8. CI/CD (GitHub Actions, `release.yml`)

Triggered on pushing a tag matching `v*.*.*`:
1. Checkout, set up Node.
2. Run `scripts/build.mjs` → produces `dist/mamamonkey-vX.Y.Z.mmip` (version read from the tag / `info.json`; the two must agree — the build asserts this).
3. Create a GitHub Release for the tag and upload the `.mmip` as a release asset.
4. Regenerate `update.json` (new version + asset URL) and commit it back to the default branch.

No secrets beyond the default `GITHUB_TOKEN`. No external hosting.

---

## 9. Open unknowns (designed against docs; resolved during Phase 0 on the PC)

These are the risks Phase 0 exists to retire. Each surfaces through the autolog system.

1. **Can a sandboxed MM5 addon serve GET/HTML** on the Media-Sharing port, or only POST/JSON (as the `remoteControl` sample shows)? → Decides Approach A vs B. *Verification:* the `GET /` hello page. **Most valuable input from the user:** the contents of `…\MediaMonkey 5\sampleScripts\remoteControl\` from the Windows PC (reveals the exact handler-registration API). Also helpful: MM5 version and the Media-Sharing port.
2. **File API** available to addons for the rolling log, and the **exact `updateURL` manifest schema** MM expects (version format + download-link field). Designed per docs; confirmed against the running app.
3. **Reading the LAN IP** from sandboxed JS for the status panel; fallback is to display MM's already-known sharing address.

---

## 10. Verification / testing approach

Because the developer cannot run on the Windows PC, verification is **observational via logs**, supported by what can be tested locally:
- **Locally (macOS):** `build.mjs` produces a valid `.mmip` (zip with root `info.json`); the workflow can be dry-run; `update.json` shape validated; the hello-page HTML and route table can be unit-checked against a stub.
- **On the PC (manual, user-assisted):** install the `.mmip`; confirm boot log line + status panel; open `http://<PC-IP>:<port>/` from the PC and the iPhone (serve-test); open `/logs`; then push a higher version tag and confirm the addon auto-updates. Each step's result is captured in the log and pasted back.

---

## 11. Definition of done (Phase 0)

- [ ] `.mmip` installs and boots; status panel shows version/IP/port; boot logged.
- [ ] `GET /`, `GET /health`, `GET /logs` reachable from PC and iPhone (or the A-vs-B outcome is conclusively logged, triggering the B fallback plan).
- [ ] Pushing a new version tag auto-updates an already-installed addon.
- [ ] Logs retrievable via `/logs` and the Copy-logs button.
- [ ] The three unknowns in §9 are answered and recorded.
