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

## PC verification checklist

See `docs/superpowers/plans/2026-05-30-mamamonkey-phase0-update-spine.md` (Task 18).
