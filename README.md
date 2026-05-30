# MamaMonkey

Web-based remote control for **MediaMonkey 5** on Windows, controllable from an iPhone on the same Wi-Fi.

**Status:** Phase 0 — "the update spine" (no music features yet; proves install + auto-update + logging + HTTP-serving).

See the design spec: `docs/superpowers/specs/2026-05-30-mamamonkey-phase0-update-spine-design.md`.

## Develop

```bash
npm install
npm test        # run unit tests
npm run build   # produce dist/mamamonkey-<version>.mmip
```

## Release

Releases are automated by GitHub Actions on tag push (see `.github/workflows/release.yml`):

```bash
# bump "version" in src/addon/info.json AND package.json to X.Y.Z first, then:
git tag vX.Y.Z && git push origin vX.Y.Z
```

The workflow builds the `.mmip`, attaches it to a GitHub Release, and rewrites `update.json`.
MediaMonkey reads `update.json` via the `updateURL` in `info.json` and auto-updates.

## Companion

The companion is a small Node.js HTTP server that runs on the same PC as MediaMonkey. It serves the mobile PWA and proxies `/api/command` requests to the addon's media-server endpoint (`http://127.0.0.1:18391/`).

**Prerequisites:** MediaMonkey's Media Sharing must be enabled (the addon registers a `remoteRequest` handler on that port).

### Run locally (development)

```bash
npm run companion:dev
# or with custom ports:
node scripts/bundle-web.mjs && node src/companion/server.js --serve-port 8088 --mm-host 127.0.0.1 --mm-port 18391
```

The companion prints its LAN URL on startup — open that URL on your iPhone.

### Release a new companion build

```bash
git tag companion-vX.Y.Z && git push origin companion-vX.Y.Z
```

GitHub Actions (`.github/workflows/companion-release.yml`) will compile a single Windows `.exe` via `bun build --compile` and attach it to a GitHub Release.

## PC verification checklist

See `docs/superpowers/plans/2026-05-30-mamamonkey-phase0-update-spine.md` (Task 18).
