# ADR: Approach B-Hybrid (addon control API + PC companion for the UI)

**Date:** 2026-05-30
**Status:** Accepted
**Supersedes:** the "Approach A" hosting assumption in `2026-05-30-mamamonkey-phase0-update-spine-design.md` §2.

## Context

Phase 0's serve-test (Task 18, run on MediaMonkey **2024.2.2.3222** at `192.168.1.98:18391`) resolved the central unknown by reading MediaMonkey's official `remoteControl` sample:

- The **only** network hook MM exposes to an addon is `app.listen(app, 'remoteRequest', (r) => {...})`, where `r.requestBody` is the request JSON string, `r.responseBody` is the string returned, and `r.asyncResult = true` enables async responses.
- It fires **exclusively for `POST` requests that carry an `MMCustomRequest` header and a JSON body.** A browser loading a page issues a plain `GET` with no such header, so it never reaches addon code.

**Therefore a pure addon cannot serve the iPhone web app.** (It can, however, execute control commands inside MM via `app.player.*`.)

Secondary finding: v0.1.0's `mm-bindings.js` used three non-existent APIs (`app.sharing.addRequestHandler`, sync `app.filesystem.appendString`, `app.menus.addItem`), which silently no-op'd — hence no menu, no log file, no served page, even though the addon loaded. The correct APIs (from the samples) are: commands via `actions.x = {title, execute, hotkeyAble, category}` in a `*_add.js` file; dialogs via `messageDlg(...)`; toasts via `uitools.toastMessage.show(...)`; hotkeys via `hotkeys.addHotkey(...)`; file IO is async (`app.filesystem.*Async`).

## Decision

Adopt **Approach B-Hybrid**:

- **MamaMonkey addon** (in MM): defines `remoteRequest` command handlers that drive `app.player.*` and `app.db`. Distributed + auto-updated via the existing GitHub pipeline. The sanctioned, config-free, stable control path.
- **MamaMonkey companion** (small PC app): serves the PWA to the iPhone over HTTP (same-origin → no CORS/mixed-content issues) and forwards the app's commands to the MM media server (`127.0.0.1:18391`) as `POST` + `MMCustomRequest` header + JSON — reaching the addon's handler. Later also handles mDNS (`mamamonkey.local`), QR, and big-library paging.

Data path: `iPhone PWA → companion(:UI port)/api → POST+MMCustomRequest → MM media server :18391 → addon remoteRequest → app.player.* → response back`.

Rejected alternative — **Solo companion via DevTools (:9222)**: fewer components but requires enabling MM remote debugging and is less officially supported (fragile across MM updates).

## Consequences

- Two PC components instead of one (both GitHub-distributed; addon auto-updates; companion can reuse the same release workflow pattern).
- The addon's HTTP-serving code from v0.1.0 (`http-controller.js`, `pages.js`'s HTML, the GET router) is obsolete *for the addon* — `pages.js` HTML moves to the companion/PWA; the router concept becomes a command dispatcher. `log-buffer.js`, the build tooling, and the release pipeline are reused unchanged.

## Revised roadmap

- **Phase 0 (finish via v0.1.1):** correct the addon to real MM APIs — visible load confirmation (boot toast + "MamaMonkey: Status" action showing version/server/log), a working `remoteRequest` handler (`ping`, `status`, transport commands), async file logging. Shipping v0.1.1 validates **auto-update** (still unproven) and that the addon loads + acts.
- **Phase 1:** companion app (serves PWA + command proxy to the media server) and the iPhone PWA core: now-playing + transport + volume.
- **Phases 2–4:** unchanged in intent (queue/seek/shuffle/art → library/playlists → PWA install/QR/mamamonkey.local), now implemented across companion (UI/serving) + addon (MM access).
