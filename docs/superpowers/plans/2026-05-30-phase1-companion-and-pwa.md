# MamaMonkey Phase 1 — Companion + PWA Implementation Plan

> Executor: TDD where tests exist; commit per task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Node at `/opt/homebrew/bin` (prefix `export PATH="/opt/homebrew/bin:$PATH"`). Do NOT push/tag (controller handles release). Spec: `docs/superpowers/specs/2026-05-30-phase1-companion-and-pwa-design.md`.

**Goal:** A PC companion (Node-compatible JS → single Windows exe via `bun build --compile`) that serves a mobile PWA and relays its commands to the addon's media-server endpoint; plus extending the addon's `status` for now-playing. Phase 1 features: now-playing + transport + volume.

**Architecture:** PWA (same-origin) → `POST /api/command` on companion → `fetch` to `http://127.0.0.1:18391/` with header `MMCustomRequest:true` → addon `remoteRequest` → `app.player.*`. Companion serves the PWA from an in-memory asset map embedded in the exe.

**Tech:** Node `http` + global `fetch`; `node:test`; `bun build --compile` for packaging; plain HTML/CSS/JS PWA.

---

## Task A: `config.js` — companion config resolution (TDD)

**Files:** Create `src/companion/config.js`, Test `test/companion-config.test.mjs`

- [ ] **Step 1: Failing test** — `test/companion-config.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../src/companion/config.js';

test('defaults', () => {
  const c = resolveConfig({ argv: [], env: {} });
  assert.deepEqual(c, { servePort: 8088, mmHost: '127.0.0.1', mmPort: 18391 });
});

test('env overrides', () => {
  const c = resolveConfig({ argv: [], env: { MM_SERVE_PORT: '9000', MM_HOST: '10.0.0.5', MM_PORT: '18391' } });
  assert.equal(c.servePort, 9000);
  assert.equal(c.mmHost, '10.0.0.5');
});

test('CLI flags beat env', () => {
  const c = resolveConfig({ argv: ['--serve-port', '7777', '--mm-port', '20000'], env: { MM_SERVE_PORT: '9000' } });
  assert.equal(c.servePort, 7777);
  assert.equal(c.mmPort, 20000);
});

test('invalid port falls back to default', () => {
  const c = resolveConfig({ argv: ['--serve-port', 'abc'], env: {} });
  assert.equal(c.servePort, 8088);
});
```

- [ ] **Step 2:** Run `node --test test/companion-config.test.mjs` → FAIL.

- [ ] **Step 3: Implement** — `src/companion/config.js`

```js
function flag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}
function port(v, dflt) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : dflt;
}

export function resolveConfig({ argv = [], env = {} } = {}) {
  return {
    servePort: port(flag(argv, '--serve-port') ?? env.MM_SERVE_PORT, 8088),
    mmHost: flag(argv, '--mm-host') ?? env.MM_HOST ?? '127.0.0.1',
    mmPort: port(flag(argv, '--mm-port') ?? env.MM_PORT, 18391),
  };
}
```

- [ ] **Step 4:** Run test → PASS (4). **Step 5:** Commit: `feat(companion): config resolution (defaults < env < CLI)`

---

## Task B: `bundle-web.mjs` — embed PWA assets (TDD)

**Files:** Create `scripts/bundle-web.mjs`, Test `test/bundle-web.test.mjs`

- [ ] **Step 1: Failing test** — `test/bundle-web.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAssetsMap } from '../scripts/bundle-web.mjs';

test('maps files to {contentType, base64} keyed by url path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-'));
  writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
  writeFileSync(join(dir, 'app.js'), 'console.log(1)');
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'a.css'), 'body{}');

  const map = buildAssetsMap(dir);

  assert.equal(map['/index.html'].contentType, 'text/html; charset=utf-8');
  assert.equal(map['/app.js'].contentType, 'text/javascript; charset=utf-8');
  assert.equal(map['/sub/a.css'].contentType, 'text/css; charset=utf-8');
  assert.equal(Buffer.from(map['/index.html'].base64, 'base64').toString(), '<h1>hi</h1>');
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** — `scripts/bundle-web.mjs`

```js
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, relative } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function walk(dir, base, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(full);
  }
  return out;
}

export function buildAssetsMap(webDir) {
  const map = {};
  for (const file of walk(webDir, webDir, [])) {
    const urlPath = '/' + relative(webDir, file).split('\\').join('/');
    map[urlPath] = {
      contentType: TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      base64: readFileSync(file).toString('base64'),
    };
  }
  return map;
}

// CLI: generate src/companion/assets.js from src/web/
if (process.argv[1] && process.argv[1].endsWith('bundle-web.mjs')) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const map = buildAssetsMap(join(root, 'src', 'web'));
  const body = `// GENERATED by scripts/bundle-web.mjs — do not edit.\nexport const ASSETS = ${JSON.stringify(map)};\n`;
  writeFileSync(join(root, 'src', 'companion', 'assets.js'), body);
  console.log(`Wrote src/companion/assets.js (${Object.keys(map).length} files)`);
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Add `src/companion/assets.js` to `.gitignore` (generated). **Step 6:** Commit: `feat(companion): web asset bundler (embeds PWA into the exe)`

---

## Task C: `server.js` — static serve + command proxy (TDD on the handler)

**Files:** Create `src/companion/server.js`, Test `test/companion-server.test.mjs`

- [ ] **Step 1: Failing test** — `test/companion-server.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/companion/server.js';

const assets = { '/index.html': { contentType: 'text/html; charset=utf-8', base64: Buffer.from('<h1>MM</h1>').toString('base64') } };

function mockRes() {
  return { statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(s, h) { this.statusCode = s; if (h) for (const k in h) this.setHeader(k, h[k]); },
    end(b) { this.body = b ? (Buffer.isBuffer(b) ? b.toString() : b) : ''; this.ended = true; } };
}
function mockReq(method, url, bodyObj) {
  const chunks = bodyObj ? [Buffer.from(JSON.stringify(bodyObj))] : [];
  return { method, url, _chunks: chunks,
    on(ev, cb) { if (ev === 'data') chunks.forEach((c) => cb(c)); if (ev === 'end') cb(); return this; } };
}

test('GET / serves index.html', async () => {
  const h = createHandler({ assets, forward: async () => ({}) });
  const res = mockRes();
  await h(mockReq('GET', '/'), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /MM/);
});

test('POST /api/command forwards body and returns addon JSON', async () => {
  let seen = null;
  const h = createHandler({ assets, forward: async (obj) => { seen = obj; return { status: 200, text: '{"ok":true,"result":{"pong":true}}' }; } });
  const res = mockRes();
  await h(mockReq('POST', '/api/command', { target: 'mamamonkey', command: 'ping' }), res);
  assert.deepEqual(seen, { target: 'mamamonkey', command: 'ping' });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).result.pong, true);
});

test('forward failure -> 502 JSON', async () => {
  const h = createHandler({ assets, forward: async () => { throw new Error('down'); } });
  const res = mockRes();
  await h(mockReq('POST', '/api/command', { target: 'mamamonkey', command: 'ping' }), res);
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).ok, false);
});

test('unknown path -> 404', async () => {
  const h = createHandler({ assets, forward: async () => ({}) });
  const res = mockRes();
  await h(mockReq('GET', '/nope'), res);
  assert.equal(res.statusCode, 404);
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** — `src/companion/server.js`

```js
import http from 'node:http';
import { networkInterfaces } from 'node:os';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// forward(bodyObj) -> Promise<{status, text}>  (real impl posts to the media server)
export function makeForward(config) {
  return async function forward(bodyObj) {
    const r = await fetch(`http://${config.mmHost}:${config.mmPort}/`, {
      method: 'POST',
      headers: { 'MMCustomRequest': 'true', 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
    });
    return { status: r.status, text: await r.text() };
  };
}

export function createHandler({ assets, forward }) {
  return async function handler(req, res) {
    try {
      const path = (req.url || '/').split('?')[0];
      if (req.method === 'POST' && path === '/api/command') {
        const raw = await readBody(req);
        let bodyObj;
        try { bodyObj = JSON.parse(raw); } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end('{"ok":false,"error":"invalid json"}');
        }
        try {
          const out = await forward(bodyObj);
          res.writeHead(out.status || 200, { 'Content-Type': 'application/json' });
          return res.end(out.text || '');
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'companion->MM failed: ' + String(e && e.message || e) }));
        }
      }
      if (req.method === 'GET') {
        const key = path === '/' ? '/index.html' : path;
        const asset = assets[key];
        if (asset) {
          res.writeHead(200, { 'Content-Type': asset.contentType });
          return res.end(Buffer.from(asset.base64, 'base64'));
        }
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('error');
    }
  };
}

export function lanUrls(port) {
  const urls = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${port}`);
    }
  }
  return urls;
}

// Entry point (skipped during unit tests).
if (process.argv[1] && /server\.js$/.test(process.argv[1])) {
  const { resolveConfig } = await import('./config.js');
  const { ASSETS } = await import('./assets.js');
  const config = resolveConfig({ argv: process.argv.slice(2), env: process.env });
  const handler = createHandler({ assets: ASSETS, forward: makeForward(config) });
  http.createServer(handler).listen(config.servePort, '0.0.0.0', () => {
    console.log(`🐒 MamaMonkey companion on port ${config.servePort} -> MM ${config.mmHost}:${config.mmPort}`);
    const urls = lanUrls(config.servePort);
    console.log('Open on your iPhone:');
    (urls.length ? urls : [`http://localhost:${config.servePort}`]).forEach((u) => console.log('  ' + u));
  });
}
```

- [ ] **Step 4:** Run → PASS (4). **Step 5:** Commit: `feat(companion): http server — static PWA + /api/command proxy to MM`

---

## Task D: The PWA (`src/web/`)

**Files:** Create `src/web/index.html`, `src/web/style.css`, `src/web/app.js`, `src/web/manifest.webmanifest`

- [ ] **Step 1: `src/web/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#111111">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="stylesheet" href="/style.css">
  <title>MamaMonkey</title>
</head>
<body>
  <main id="app">
    <h1>🐒 MamaMonkey</h1>
    <div id="art" class="art">♪</div>
    <div id="title" class="title">—</div>
    <div id="artist" class="artist">—</div>
    <div id="album" class="album">—</div>
    <div class="progress"><div id="bar" class="bar"></div></div>
    <div class="times"><span id="pos">0:00</span><span id="dur">0:00</span></div>
    <div class="transport">
      <button id="prev" aria-label="Previous">⏮</button>
      <button id="playpause" aria-label="Play/Pause">⏯</button>
      <button id="next" aria-label="Next">⏭</button>
    </div>
    <div class="volume">🔊 <input id="vol" type="range" min="0" max="1" step="0.01" value="0.5"></div>
    <div id="status" class="status">connecting…</div>
  </main>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: `src/web/style.css`**

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #111; color: #eee; font-family: -apple-system, system-ui, sans-serif;
  -webkit-user-select: none; user-select: none; }
#app { max-width: 480px; margin: 0 auto; padding: 24px 20px calc(24px + env(safe-area-inset-bottom)); text-align: center; }
h1 { font-size: 18px; font-weight: 600; color: #9af; margin: 8px 0 20px; }
.art { width: 220px; height: 220px; margin: 0 auto 20px; border-radius: 16px;
  background: #1c1c1e; display: flex; align-items: center; justify-content: center; font-size: 64px; color: #444; }
.title { font-size: 22px; font-weight: 700; margin-top: 8px; }
.artist { font-size: 16px; color: #bbb; margin-top: 4px; }
.album { font-size: 13px; color: #777; margin-top: 2px; }
.progress { height: 4px; background: #2c2c2e; border-radius: 2px; margin: 20px 0 6px; overflow: hidden; }
.bar { height: 100%; width: 0%; background: #9af; transition: width .3s linear; }
.times { display: flex; justify-content: space-between; font-size: 12px; color: #888; }
.transport { display: flex; justify-content: center; gap: 24px; margin: 28px 0; }
.transport button { width: 72px; height: 72px; border-radius: 50%; border: none; background: #2c2c2e;
  color: #fff; font-size: 28px; cursor: pointer; }
.transport button:active { background: #3a3a3c; }
#playpause { background: #9af; color: #111; }
.volume { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.volume input { flex: 1; }
.status { margin-top: 18px; font-size: 12px; color: #666; min-height: 16px; }
```

- [ ] **Step 3: `src/web/app.js`**

```js
(function () {
  'use strict';
  var POLL_MS = 1000;
  var $ = function (id) { return document.getElementById(id); };
  var dragging = false;

  function fmt(ms) {
    if (!ms || ms < 0) return '0:00';
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function cmd(command, args) {
    return fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'mamamonkey', command: command, args: args || {} }),
    }).then(function (r) { return r.json(); });
  }

  function render(st) {
    if (!st || !st.ok || !st.result || !st.result.available) {
      $('status').textContent = 'MediaMonkey not reachable';
      return;
    }
    var r = st.result;
    $('title').textContent = (r.track && r.track.title) || '—';
    $('artist').textContent = (r.track && r.track.artist) || '—';
    $('album').textContent = (r.track && r.track.album) || '—';
    $('playpause').textContent = r.isPlaying ? '⏸' : '▶';
    if (r.durationMs) {
      $('bar').style.width = Math.min(100, (100 * (r.positionMs || 0) / r.durationMs)) + '%';
      $('pos').textContent = fmt(r.positionMs); $('dur').textContent = fmt(r.durationMs);
    }
    if (!dragging && typeof r.volume === 'number') $('vol').value = r.volume;
    $('status').textContent = '';
  }

  function poll() { cmd('status').then(render).catch(function () { $('status').textContent = 'offline'; }); }

  $('prev').onclick = function () { cmd('prev').then(poll); };
  $('next').onclick = function () { cmd('next').then(poll); };
  $('playpause').onclick = function () { cmd('playpause').then(poll); };
  var vol = $('vol');
  vol.addEventListener('input', function () { dragging = true; });
  vol.addEventListener('change', function () { cmd('setVolume', { value: Number(vol.value) }).then(function () { dragging = false; poll(); }); });

  poll();
  setInterval(poll, POLL_MS);
})();
```

- [ ] **Step 4: `src/web/manifest.webmanifest`**

```json
{
  "name": "MamaMonkey",
  "short_name": "MamaMonkey",
  "display": "standalone",
  "background_color": "#111111",
  "theme_color": "#111111",
  "start_url": "/"
}
```

- [ ] **Step 5:** Run `node scripts/bundle-web.mjs` → writes `src/companion/assets.js`. Then `node --test` → all green. **Step 6:** Commit: `feat(web): Phase 1 PWA — now-playing, transport, volume`

---

## Task E: Addon v0.2.0 — extend `status` for now-playing

**Files:** Modify `src/addon/init.js` (status handler), `src/addon/info.json` + `package.json` (version 0.2.0), update `test/init.test.mjs`

- [ ] **Step 1: Update the `status` handler** in `src/addon/init.js` `buildHandlers()` — replace the `status` function with:

```js
      status: function () {
        var p = a && a.player;
        if (!p) return { available: false };
        var track = null;
        try {
          var t = p.getCurrentTrack && p.getCurrentTrack();
          if (t) track = { title: t.title, artist: t.artist, album: t.album, summary: t.summary };
        } catch (e) {}
        return {
          available: true,
          isPlaying: !!p.isPlaying,
          paused: !!p.paused,
          volume: (typeof p.volume === 'number') ? p.volume : null,
          positionMs: (typeof p.trackPositionMS === 'number') ? p.trackPositionMS : null,
          durationMs: (typeof p.trackLengthMS === 'number') ? p.trackLengthMS : null,
          track: track,
        };
      },
```

- [ ] **Step 2: Bump** `MM.VERSION` in `init.js` to `'0.2.0'`, and `version` in `src/addon/info.json` and `package.json` to `0.2.0`.

- [ ] **Step 3: Update `test/init.test.mjs`** — extend the fake player and the status assertion:
  - In `fakePlayer` add: `trackPositionMS: 5000, trackLengthMS: 200000,` and make `getCurrentTrack: () => ({ title: 'T', artist: 'Benoit & Sergio', album: 'Alb', summary: 'A - T' })`.
  - In the status test add: `assert.equal(out.response.result.track.artist, 'Benoit & Sergio');` and `assert.equal(out.response.result.durationMs, 200000);`

- [ ] **Step 4:** Run `node --test test/init.test.mjs` and the full `npm test` → green. `npm run build` → `dist/mamamonkey-0.2.0.mmip`. **Step 5:** Commit: `feat(addon): extend status with artist/album/position/duration (v0.2.0)`

---

## Task F: Companion release workflow + packaging

**Files:** Create `.github/workflows/companion-release.yml`, add npm scripts, update `README.md`

- [ ] **Step 1: Add npm scripts** to `package.json`:

```json
    "bundle-web": "node scripts/bundle-web.mjs",
    "companion:dev": "node scripts/bundle-web.mjs && node src/companion/server.js"
```

- [ ] **Step 2: Create** `.github/workflows/companion-release.yml`

```yaml
name: companion-release
on:
  push:
    tags:
      - 'companion-v*'
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm test
      - name: Bundle PWA into assets.js
        run: node scripts/bundle-web.mjs
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: latest }
      - name: Compile Windows exe
        run: |
          mkdir -p dist
          bun build --compile --target=bun-windows-x64 src/companion/server.js --outfile dist/MamaMonkeyCompanion.exe
      - name: Release
        env: { GH_TOKEN: ${{ github.token }} }
        run: gh release create "${GITHUB_REF_NAME}" dist/MamaMonkeyCompanion.exe --title "${GITHUB_REF_NAME}" --notes "MamaMonkey companion ${GITHUB_REF_NAME}"
```

- [ ] **Step 3: README** — add a "Companion" section: `npm run companion:dev` to run locally; releases via `git tag companion-vX.Y.Z`; the exe prints the URL to open on the iPhone; note MM's Media Sharing must be ON and the companion runs on the same PC as MM.

- [ ] **Step 4:** Commit: `ci(companion): build Windows exe via bun --compile on companion-v* tags`

---

## Task G: Local end-to-end verification (controller-run, on the Mac/LAN)

- [ ] **Step 1:** `npm run bundle-web && node src/companion/server.js --mm-host 192.168.1.98 --mm-port 18391` (point at the real PC addon).
- [ ] **Step 2:** `curl -s localhost:8088/` → returns the PWA HTML. `curl -s -X POST localhost:8088/api/command -H 'Content-Type: application/json' -d '{"target":"mamamonkey","command":"status"}'` → returns live now-playing JSON (proves the proxy + addon path through the companion).
- [ ] **Step 3:** Confirm transport via the companion: POST `playpause`, re-`status`, assert `isPlaying` flips.
- [ ] **Step 4 (user):** open the printed LAN URL on the iPhone → see now-playing, use transport + volume. Then build/run the `.exe` on the PC for the real deployment.

---

## Done criteria
- `npm test` green (config, bundler, server-handler, addon status).
- Companion serves the PWA and proxies commands; now-playing reflects live MM state; transport + volume work from a browser/phone.
- Addon v0.2.0 status returns artist/album/position/duration.
- Companion release workflow produces a single Windows `.exe`.
