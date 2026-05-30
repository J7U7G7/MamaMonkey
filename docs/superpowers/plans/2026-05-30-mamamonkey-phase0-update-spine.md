# MamaMonkey Phase 0 — "The Update Spine" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a feature-free MediaMonkey 5 `.mmip` addon that proves the entire pipeline works end-to-end: install, GitHub auto-update, in-addon logging, HTTP serve-test (which decides Approach A vs B), and a status/liveness surface.

**Architecture:** A plain-JavaScript MM5 addon split into two layers. **Pure logic** (`src/addon/lib/*.js`) is authored as classic IIFE scripts that attach to a shared `globalThis.MamaMonkey` namespace — these run unchanged in MM's Chromium sandbox AND are unit-tested in Node by `vm`-evaluating the exact source files. **MM-API glue** (`src/addon/*.js` — file IO, HTTP hook, UI menu, boot) is thin, wraps every uncertain MM call in `try/catch`, logs everything, and degrades gracefully; it is verified on the Windows PC via a log-based checklist rather than local unit tests. Separately, **Node build tooling** (`scripts/*.mjs`, ESM) is fully TDD'd and drives a **GitHub Actions** release workflow.

**Tech Stack:** Plain ES2020 JavaScript (addon, classic scripts), Node 22+ ESM (build tooling), `node:test` (tests), `node:vm` (loading addon scripts under test), `adm-zip` (build the `.mmip` ZIP, cross-platform + inspectable in tests), GitHub Actions + `gh` CLI (release), `raw.githubusercontent.com` (auto-update manifest hosting, $0).

**Repo:** `git@github.com:J7U7G7/MamaMonkey.git`, default branch `main`, already initialized and pushed (the spec is committed). The `.gitignore` already ignores `node_modules/`, `dist/`, `.superpowers/`.

**Spec:** `docs/superpowers/specs/2026-05-30-mamamonkey-phase0-update-spine-design.md`

**Commit convention:** Conventional Commits. Per harness policy, end every commit message body with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer (omitted from the example commands below for brevity — add it).

**Key design facts to keep in mind:**
- MM5 addons are sandboxed browser JS (no Node, no raw sockets). The addon hooks MM's **built-in Media-Sharing HTTP server** to serve HTTP. Whether it can serve arbitrary `GET`/HTML is the #1 unknown — Task 16's serve-test resolves it.
- The single most uncertain code is the MM binding in `src/addon/mm-bindings.js` (HTTP hook + file IO + menu). It is deliberately tiny so that if reality differs from the docs, only that file changes. If the user provides `…\MediaMonkey 5\sampleScripts\remoteControl\`, mirror its exact handler-registration API there.
- The served status page (Task 8 + 13) doubles as the user-facing status/copy-logs surface, so even if the in-MM menu (Task 14) proves hard, version/IP/port/copy-logs remain reachable from any browser.

---

## File Structure

**Addon — pure logic (classic IIFE, `globalThis.MamaMonkey` namespace, unit-tested via vm):**
- `src/addon/lib/log-buffer.js` — `createLogBuffer({maxBytes})`: in-memory rolling log, trims oldest lines past `maxBytes`.
- `src/addon/lib/router.js` — `createRouter()`: register `GET` handlers, `dispatch(method, path)` returns a response object or `null`.
- `src/addon/lib/pages.js` — `statusPage({name, version, port, host})` (HTML) and `healthBody({name, version, port, time})` (JSON string).

**Addon — MM glue (thin, try/catch, verified on PC):**
- `src/addon/mm-bindings.js` — the only MM-specific surface: `registerHttpHandler(onRequest)`, `readLogFile()/appendLogFile(text)`, `addStatusMenuItem({label, onClick})`, `getSharingInfo()` (port/host/IP best-effort).
- `src/addon/logger.js` — `Logger`: composes `createLogBuffer` + `mm-bindings` file IO; `log/getText/clear`.
- `src/addon/http-controller.js` — builds the router with `/`, `/health`, `/logs`, binds it via `mm-bindings.registerHttpHandler`.
- `src/addon/status-panel.js` — adds the in-MM menu item via `mm-bindings.addStatusMenuItem`.
- `src/addon/init.js` — boot entry; `window.whenReady()` wiring of Logger → HttpController → StatusPanel.
- `src/addon/info.json` — MM manifest (`id`, `version`, `updateURL`, …) at `.mmip` root.

**Build tooling (Node ESM, fully TDD'd):**
- `scripts/lib/version.mjs` — `parseTag`, `assertVersionsMatch`.
- `scripts/lib/manifest.mjs` — `buildUpdateManifest(...)`.
- `scripts/lib/package-addon.mjs` — `addonFileName`, `validateInfoJson`, `createMmip`.
- `scripts/build.mjs` — CLI: validate + zip `src/addon` → `dist/mamamonkey-<version>.mmip`.
- `scripts/write-update-manifest.mjs` — CLI: regenerate root `update.json` from `info.json` + a download URL.

**Tests:** `test/*.test.mjs` + `test/helpers/load-addon-script.mjs`.

**CI / meta:** `.github/workflows/release.yml`, root `update.json`, `package.json`, `package-lock.json`, `README.md`.

---

## Task 1: Project scaffold + test runner

**Files:**
- Create: `package.json`
- Create: `README.md`
- Create: `test/helpers/load-addon-script.mjs`
- Create: `test/helpers/load-addon-script.test.mjs`
- Create: `src/addon/lib/.gitkeep` (placeholder so the dir exists for the loader test target; removed when first lib file lands)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mamamonkey",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Web-based MediaMonkey 5 remote control for iPhone (Phase 0: the update spine).",
  "scripts": {
    "test": "node --test",
    "build": "node scripts/build.mjs"
  },
  "devDependencies": {
    "adm-zip": "^0.5.16"
  }
}
```

- [ ] **Step 2: Install deps (creates `package-lock.json`)**

Run: `npm install`
Expected: creates `node_modules/` and `package-lock.json`; exit 0.

- [ ] **Step 3: Create the addon-script test loader** — `test/helpers/load-addon-script.mjs`

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Loads a classic addon script (one that attaches to globalThis.MamaMonkey)
// into a fresh sandbox and returns that namespace object. This evaluates the
// EXACT file MediaMonkey loads, so tests exercise real source.
export function loadAddonScript(relPathFromAddon) {
  const url = new URL(`../../src/addon/${relPathFromAddon}`, import.meta.url);
  const code = readFileSync(fileURLToPath(url), 'utf8');
  const sandbox = { console };
  vm.createContext(sandbox); // sandbox becomes the context's globalThis
  vm.runInContext(code, sandbox, { filename: relPathFromAddon });
  return sandbox.MamaMonkey;
}
```

- [ ] **Step 4: Write a failing test for the loader** — `test/helpers/load-addon-script.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAddonScript } from './load-addon-script.mjs';

test('loadAddonScript exposes the MamaMonkey namespace from a classic script', () => {
  const ns = loadAddonScript('lib/_loader-probe.js');
  assert.equal(typeof ns, 'object');
  assert.equal(ns.probe(), 'ok');
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `node --test test/helpers/load-addon-script.test.mjs`
Expected: FAIL — cannot read `src/addon/lib/_loader-probe.js` (file does not exist).

- [ ] **Step 6: Create the probe script** — `src/addon/lib/_loader-probe.js`

```js
(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});
  MM.probe = function probe() { return 'ok'; };
})();
```

- [ ] **Step 7: Run it to confirm it passes**

Run: `node --test test/helpers/load-addon-script.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 8: Write `README.md` skeleton**

````markdown
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
````

- [ ] **Step 9: Remove the probe artifacts now the loader is proven, and add the real `.gitkeep`**

Run: `rm src/addon/lib/_loader-probe.js test/helpers/load-addon-script.test.mjs && touch src/addon/lib/.gitkeep`
(The loader itself stays; it's covered by real lib tests from Task 2 onward.)

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json README.md test/helpers/load-addon-script.mjs src/addon/lib/.gitkeep
git commit -m "chore: scaffold project, deps, and addon-script test loader"
```

---

## Task 2: `log-buffer.js` — rolling in-memory log (pure, TDD)

**Files:**
- Create: `src/addon/lib/log-buffer.js`
- Test: `test/log-buffer.test.mjs`

- [ ] **Step 1: Write the failing tests** — `test/log-buffer.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAddonScript } from './helpers/load-addon-script.mjs';

const { createLogBuffer } = loadAddonScript('lib/log-buffer.js');

test('appends lines and returns them as text', () => {
  const buf = createLogBuffer({ maxBytes: 1000 });
  buf.append('first');
  buf.append('second');
  assert.equal(buf.text(), 'first\nsecond');
});

test('trims oldest lines when over maxBytes', () => {
  const buf = createLogBuffer({ maxBytes: 12 }); // tiny cap
  buf.append('aaaa'); // 4
  buf.append('bbbb'); // "aaaa\nbbbb" = 9
  buf.append('cccc'); // would be 14 -> drop "aaaa"
  assert.equal(buf.text(), 'bbbb\ncccc');
  assert.ok(buf.bytes() <= 12);
});

test('clear empties the buffer', () => {
  const buf = createLogBuffer({ maxBytes: 1000 });
  buf.append('x');
  buf.clear();
  assert.equal(buf.text(), '');
  assert.equal(buf.bytes(), 0);
});

test('a single line longer than maxBytes is kept (never produces empty on append)', () => {
  const buf = createLogBuffer({ maxBytes: 4 });
  buf.append('toolongline');
  assert.equal(buf.text(), 'toolongline');
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test test/log-buffer.test.mjs`
Expected: FAIL — `createLogBuffer` is undefined / not a function.

- [ ] **Step 3: Implement** — `src/addon/lib/log-buffer.js`

```js
(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function byteLen(s) {
    // UTF-8 byte length without Buffer (sandbox-safe).
    return unescape(encodeURIComponent(s)).length;
  }

  function createLogBuffer(opts) {
    const maxBytes = (opts && opts.maxBytes) || 64 * 1024;
    let lines = [];

    function bytes() {
      return byteLen(lines.join('\n'));
    }
    function trim() {
      // Drop oldest lines until within cap, but always keep at least one line.
      while (lines.length > 1 && bytes() > maxBytes) {
        lines.shift();
      }
    }
    return {
      append(line) {
        lines.push(String(line));
        trim();
      },
      text() {
        return lines.join('\n');
      },
      bytes,
      clear() {
        lines = [];
      },
    };
  }

  MM.createLogBuffer = createLogBuffer;
})();
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test test/log-buffer.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/addon/lib/log-buffer.js test/log-buffer.test.mjs
git commit -m "feat(addon): rolling in-memory log buffer with byte-cap trimming"
```

---

## Task 3: `router.js` — minimal GET router (pure, TDD)

**Files:**
- Create: `src/addon/lib/router.js`
- Test: `test/router.test.mjs`

- [ ] **Step 1: Write the failing tests** — `test/router.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAddonScript } from './helpers/load-addon-script.mjs';

const { createRouter } = loadAddonScript('lib/router.js');

test('dispatches a registered GET route', () => {
  const r = createRouter();
  r.get('/health', () => ({ status: 200, contentType: 'application/json', body: '{}' }));
  const res = r.dispatch('GET', '/health');
  assert.deepEqual(res, { status: 200, contentType: 'application/json', body: '{}' });
});

test('ignores query string when matching path', () => {
  const r = createRouter();
  r.get('/logs', () => ({ status: 200, contentType: 'text/plain', body: 'log' }));
  const res = r.dispatch('GET', '/logs?x=1');
  assert.equal(res.body, 'log');
});

test('returns null for unknown path', () => {
  const r = createRouter();
  assert.equal(r.dispatch('GET', '/nope'), null);
});

test('returns null for non-GET method', () => {
  const r = createRouter();
  r.get('/', () => ({ status: 200, contentType: 'text/html', body: 'hi' }));
  assert.equal(r.dispatch('POST', '/'), null);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test test/router.test.mjs`
Expected: FAIL — `createRouter` is undefined.

- [ ] **Step 3: Implement** — `src/addon/lib/router.js`

```js
(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function createRouter() {
    const routes = {}; // path -> handler

    return {
      get(path, handler) {
        routes[path] = handler;
        return this;
      },
      dispatch(method, rawPath) {
        if (method !== 'GET') return null;
        const path = String(rawPath).split('?')[0];
        const handler = routes[path];
        if (!handler) return null;
        return handler();
      },
    };
  }

  MM.createRouter = createRouter;
})();
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test test/router.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/addon/lib/router.js test/router.test.mjs
git commit -m "feat(addon): minimal GET router with query-string-tolerant matching"
```

---

## Task 4: `pages.js` — status page + health body (pure, TDD)

**Files:**
- Create: `src/addon/lib/pages.js`
- Test: `test/pages.test.mjs`

- [ ] **Step 1: Write the failing tests** — `test/pages.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAddonScript } from './helpers/load-addon-script.mjs';

const { statusPage, healthBody } = loadAddonScript('lib/pages.js');

test('statusPage embeds name, version, host and port', () => {
  const html = statusPage({ name: 'MamaMonkey', version: '0.1.0', host: '192.168.1.42', port: 56887 });
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /MamaMonkey/);
  assert.match(html, /0\.1\.0/);
  assert.match(html, /192\.168\.1\.42/);
  assert.match(html, /56887/);
});

test('statusPage includes a copy-logs control wired to /logs', () => {
  const html = statusPage({ name: 'MamaMonkey', version: '0.1.0', host: 'x', port: 1 });
  assert.match(html, /\/logs/);
  assert.match(html, /Copy logs/i);
});

test('statusPage escapes angle brackets in dynamic values', () => {
  const html = statusPage({ name: '<x>', version: '0.1.0', host: 'h', port: 1 });
  assert.doesNotMatch(html, /<x>/);
  assert.match(html, /&lt;x&gt;/);
});

test('healthBody returns valid JSON with the expected fields', () => {
  const json = healthBody({ name: 'MamaMonkey', version: '0.1.0', port: 56887, time: '2026-05-30T00:00:00Z' });
  const obj = JSON.parse(json);
  assert.equal(obj.name, 'MamaMonkey');
  assert.equal(obj.version, '0.1.0');
  assert.equal(obj.port, 56887);
  assert.equal(obj.time, '2026-05-30T00:00:00Z');
  assert.equal(obj.ok, true);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test test/pages.test.mjs`
Expected: FAIL — `statusPage` is undefined.

- [ ] **Step 3: Implement** — `src/addon/lib/pages.js`

```js
(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function esc(v) {
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusPage(info) {
    const name = esc(info.name);
    const version = esc(info.version);
    const host = esc(info.host);
    const port = esc(info.port);
    return [
      '<!DOCTYPE html>',
      '<html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + name + '</title>',
      '<style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#111;color:#eee}',
      'h1{font-size:20px}.row{margin:8px 0}.k{color:#9af}button{font-size:16px;padding:10px 16px;margin-top:16px}',
      'a{color:#9af}</style></head><body>',
      '<h1>🐒 ' + name + '</h1>',
      '<div class="row"><span class="k">version</span> ' + version + '</div>',
      '<div class="row"><span class="k">host</span> ' + host + '</div>',
      '<div class="row"><span class="k">port</span> ' + port + '</div>',
      '<div class="row"><a href="/health">/health</a> · <a href="/logs">/logs</a></div>',
      '<button id="copy">Copy logs</button><pre id="out"></pre>',
      '<script>document.getElementById("copy").onclick=async function(){',
      'try{var t=await (await fetch("/logs")).text();await navigator.clipboard.writeText(t);',
      'document.getElementById("out").textContent="Copied "+t.length+" chars.";}',
      'catch(e){document.getElementById("out").textContent="Copy failed: "+e;}};</script>',
      '</body></html>',
    ].join('\n');
  }

  function healthBody(info) {
    return JSON.stringify({
      ok: true,
      name: info.name,
      version: info.version,
      port: info.port,
      time: info.time,
    });
  }

  MM.statusPage = statusPage;
  MM.healthBody = healthBody;
})();
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test test/pages.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/addon/lib/pages.js test/pages.test.mjs
git commit -m "feat(addon): status page (with copy-logs) and health JSON renderers"
```

---

## Task 5: `version.mjs` — tag parsing + version match (build lib, TDD)

**Files:**
- Create: `scripts/lib/version.mjs`
- Test: `test/version.test.mjs`

- [ ] **Step 1: Write the failing tests** — `test/version.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTag, assertVersionsMatch } from '../scripts/lib/version.mjs';

test('parseTag strips the leading v', () => {
  assert.equal(parseTag('v0.1.0'), '0.1.0');
  assert.equal(parseTag('v12.3.45'), '12.3.45');
});

test('parseTag rejects malformed tags', () => {
  assert.throws(() => parseTag('0.1.0'));
  assert.throws(() => parseTag('v1.2'));
  assert.throws(() => parseTag('vfoo'));
});

test('assertVersionsMatch passes when equal, throws when not', () => {
  assert.doesNotThrow(() => assertVersionsMatch('0.1.0', '0.1.0'));
  assert.throws(() => assertVersionsMatch('0.1.0', '0.2.0'), /mismatch/i);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test test/version.test.mjs`
Expected: FAIL — module not found / exports undefined.

- [ ] **Step 3: Implement** — `scripts/lib/version.mjs`

```js
const SEMVER = /^\d+\.\d+\.\d+$/;

export function parseTag(tag) {
  if (typeof tag !== 'string' || tag[0] !== 'v') {
    throw new Error(`Tag must look like vX.Y.Z, got: ${tag}`);
  }
  const v = tag.slice(1);
  if (!SEMVER.test(v)) {
    throw new Error(`Tag must look like vX.Y.Z, got: ${tag}`);
  }
  return v;
}

export function assertVersionsMatch(infoVersion, tagVersion) {
  if (infoVersion !== tagVersion) {
    throw new Error(
      `Version mismatch: info.json has ${infoVersion} but tag is v${tagVersion}. ` +
        `Update src/addon/info.json before tagging.`
    );
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test test/version.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/version.mjs test/version.test.mjs
git commit -m "feat(build): tag parsing and info.json/tag version matching"
```

---

## Task 6: `manifest.mjs` — update manifest builder (build lib, TDD)

**Files:**
- Create: `scripts/lib/manifest.mjs`
- Test: `test/manifest.test.mjs`

> Note: MM's exact `updateURL` manifest schema is an accepted unknown (spec §9). This builder emits a superset (`id`, `version`, `minAppVersion`, `downloadURL`) so fields can be dropped/renamed after PC verification with a one-line change.

- [ ] **Step 1: Write the failing tests** — `test/manifest.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpdateManifest } from '../scripts/lib/manifest.mjs';

test('builds a manifest object from the inputs', () => {
  const m = buildUpdateManifest({
    id: 'mamamonkey',
    version: '0.1.0',
    minAppVersion: '5.0.0',
    downloadURL: 'https://example.com/x.mmip',
  });
  assert.deepEqual(m, {
    id: 'mamamonkey',
    version: '0.1.0',
    minAppVersion: '5.0.0',
    downloadURL: 'https://example.com/x.mmip',
  });
});

test('throws if version is not X.Y.Z', () => {
  assert.throws(() =>
    buildUpdateManifest({ id: 'x', version: '1.2', minAppVersion: '5.0.0', downloadURL: 'u' })
  );
});

test('throws if downloadURL is missing', () => {
  assert.throws(() =>
    buildUpdateManifest({ id: 'x', version: '1.2.3', minAppVersion: '5.0.0', downloadURL: '' })
  );
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test test/manifest.test.mjs`
Expected: FAIL — `buildUpdateManifest` not found.

- [ ] **Step 3: Implement** — `scripts/lib/manifest.mjs`

```js
const SEMVER = /^\d+\.\d+\.\d+$/;

export function buildUpdateManifest({ id, version, minAppVersion, downloadURL }) {
  if (!SEMVER.test(String(version))) {
    throw new Error(`Manifest version must be X.Y.Z, got: ${version}`);
  }
  if (!downloadURL) {
    throw new Error('Manifest downloadURL is required');
  }
  return { id, version, minAppVersion, downloadURL };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test test/manifest.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/manifest.mjs test/manifest.test.mjs
git commit -m "feat(build): update.json manifest builder with version validation"
```

---

## Task 7: `package-addon.mjs` — naming, info.json validation, zip (build lib, TDD)

**Files:**
- Create: `scripts/lib/package-addon.mjs`
- Test: `test/package-addon.test.mjs`

- [ ] **Step 1: Write the failing tests** — `test/package-addon.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { addonFileName, validateInfoJson, createMmip } from '../scripts/lib/package-addon.mjs';

test('addonFileName uses the version', () => {
  assert.equal(addonFileName('0.1.0'), 'mamamonkey-0.1.0.mmip');
});

test('validateInfoJson accepts a complete manifest', () => {
  assert.doesNotThrow(() =>
    validateInfoJson({
      id: 'mamamonkey', title: 'MamaMonkey', description: 'd',
      version: '0.1.0', type: 'general', author: 'a', updateURL: 'http://x',
    })
  );
});

test('validateInfoJson rejects missing fields and bad version', () => {
  assert.throws(() => validateInfoJson({ id: 'x' }), /missing/i);
  assert.throws(() =>
    validateInfoJson({ id: 'x', title: 't', description: 'd', version: '1.2', type: 'general', author: 'a', updateURL: 'u' }),
    /version/i
  );
});

test('createMmip zips folder CONTENTS at the archive root (info.json at root)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-'));
  const src = join(dir, 'addon');
  mkdirSync(src);
  writeFileSync(join(src, 'info.json'), '{"id":"x"}');
  mkdirSync(join(src, 'lib'));
  writeFileSync(join(src, 'lib', 'a.js'), '// a');
  const out = join(dir, 'out.mmip');

  createMmip({ srcDir: src, outFile: out });

  const names = new AdmZip(out).getEntries().map((e) => e.entryName);
  assert.ok(names.includes('info.json'), 'info.json must be at root, got: ' + names.join(','));
  assert.ok(names.some((n) => n === 'lib/a.js'), 'nested files preserved');
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test test/package-addon.test.mjs`
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement** — `scripts/lib/package-addon.mjs`

```js
import AdmZip from 'adm-zip';

const REQUIRED = ['id', 'title', 'description', 'version', 'type', 'author', 'updateURL'];
const SEMVER = /^\d+\.\d+\.\d+$/;

export function addonFileName(version) {
  return `mamamonkey-${version}.mmip`;
}

export function validateInfoJson(info) {
  const missing = REQUIRED.filter((k) => !info || !info[k]);
  if (missing.length) {
    throw new Error(`info.json missing required field(s): ${missing.join(', ')}`);
  }
  if (!SEMVER.test(info.version)) {
    throw new Error(`info.json version must be X.Y.Z, got: ${info.version}`);
  }
}

export function createMmip({ srcDir, outFile }) {
  const zip = new AdmZip();
  // addLocalFolder adds the folder's CONTENTS at the archive root (no wrapper dir),
  // which MediaMonkey requires (info.json must sit at the .mmip root).
  zip.addLocalFolder(srcDir);
  zip.writeZip(outFile);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test test/package-addon.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/package-addon.mjs test/package-addon.test.mjs
git commit -m "feat(build): addon naming, info.json validation, and .mmip packaging"
```

---

## Task 8: `info.json` — the MM addon manifest

**Files:**
- Create: `src/addon/info.json`

- [ ] **Step 1: Create `src/addon/info.json`**

```json
{
  "id": "mamamonkey",
  "title": "MamaMonkey",
  "description": "iPhone remote control for MediaMonkey (Phase 0: update spine).",
  "version": "0.1.0",
  "type": "general",
  "author": "J7U7G7",
  "minAppVersion": "5.0.0",
  "updateURL": "https://raw.githubusercontent.com/J7U7G7/MamaMonkey/main/update.json",
  "init": "init.js"
}
```

> Note: `minAppVersion` and the `init` wiring key are best-effort per the MM5 docs and are confirmed/corrected during Task 18 (PC verification). If the user supplies the `remoteControl` sample's `info.json`, align field names to it.

- [ ] **Step 2: Add a test asserting info.json passes our validator and matches package.json version** — `test/info-json.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateInfoJson } from '../scripts/lib/package-addon.mjs';

const info = JSON.parse(readFileSync(new URL('../src/addon/info.json', import.meta.url)));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

test('info.json is a valid addon manifest', () => {
  assert.doesNotThrow(() => validateInfoJson(info));
});

test('info.json version matches package.json version', () => {
  assert.equal(info.version, pkg.version);
});

test('updateURL points at this repo raw manifest', () => {
  assert.equal(info.updateURL, 'https://raw.githubusercontent.com/J7U7G7/MamaMonkey/main/update.json');
});
```

- [ ] **Step 3: Run to confirm pass**

Run: `node --test test/info-json.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add src/addon/info.json test/info-json.test.mjs
git commit -m "feat(addon): MediaMonkey manifest (info.json) with GitHub updateURL"
```

---

## Task 9: `build.mjs` — build CLI producing the `.mmip`

**Files:**
- Create: `scripts/build.mjs`

- [ ] **Step 1: Implement** — `scripts/build.mjs`

```js
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { addonFileName, validateInfoJson, createMmip } from './lib/package-addon.mjs';
import { parseTag, assertVersionsMatch } from './lib/version.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const addonDir = join(root, 'src', 'addon');
const distDir = join(root, 'dist');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const info = JSON.parse(readFileSync(join(addonDir, 'info.json'), 'utf8'));
validateInfoJson(info);

const tag = arg('--tag');
if (tag) {
  assertVersionsMatch(info.version, parseTag(tag));
}

if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
const outFile = join(distDir, addonFileName(info.version));
createMmip({ srcDir: addonDir, outFile });

console.log(`Built ${outFile} (version ${info.version})`);
```

- [ ] **Step 2: Run the build locally**

Run: `npm run build`
Expected: prints `Built .../dist/mamamonkey-0.1.0.mmip (version 0.1.0)`; file exists.

- [ ] **Step 3: Verify the archive has `info.json` at root**

Run: `node -e "import('adm-zip').then(({default:Z})=>console.log(new Z('dist/mamamonkey-0.1.0.mmip').getEntries().map(e=>e.entryName)))"`
Expected: array includes `info.json` and `lib/...` entries; no wrapper folder prefix.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build.mjs
git commit -m "feat(build): build.mjs CLI to package src/addon into dist/*.mmip"
```

---

## Task 10: `mm-bindings.js` — the MM-specific surface (glue; verified on PC)

**Files:**
- Create: `src/addon/mm-bindings.js`

> This is the ONLY file with direct MM API calls and the highest-uncertainty code. Every call is wrapped so failures degrade gracefully and are logged. If the user provides `…\MediaMonkey 5\sampleScripts\remoteControl\`, replace the body of `registerHttpHandler` and `getSharingInfo` with the sample's exact API. The implementations below follow the documented MM5 mechanism (hook the Media-Sharing HTTP server; `MMCustomRequest`) as a concrete starting point.

- [ ] **Step 1: Implement** — `src/addon/mm-bindings.js`

```js
(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  // Resolve MM's global app object across possible names without throwing.
  function getApp() {
    try { if (typeof app !== 'undefined' && app) return app; } catch (e) {}
    try { if (globalThis.app) return globalThis.app; } catch (e) {}
    return null;
  }

  // Register a handler for HTTP requests arriving on MM's Media-Sharing port.
  // onRequest(reqInfo) -> { status, contentType, body } | null
  // reqInfo: { method, path }
  // DOC-BASED ASSUMPTION — verify against sampleScripts/remoteControl on the PC.
  function registerHttpHandler(onRequest) {
    const app = getApp();
    if (!app) throw new Error('MM app object not available');
    // The MM5 remoteControl sample hooks the sharing server's request event.
    // We attempt the documented hook; the exact member is confirmed on the PC.
    const sharing = app.sharing || app.mediaSharing || app.server || null;
    if (sharing && typeof sharing.addRequestHandler === 'function') {
      sharing.addRequestHandler(function (req, resp) {
        const out = onRequest({ method: req.method || 'GET', path: req.path || req.url || '/' });
        if (!out) return false; // not handled -> let MM continue
        resp.statusCode = out.status;
        resp.setHeader && resp.setHeader('Content-Type', out.contentType);
        resp.write && resp.write(out.body);
        resp.end && resp.end();
        return true;
      });
      return { hooked: true, via: 'sharing.addRequestHandler' };
    }
    // Fallback: expose a global MM looks for (per remoteControl sample naming).
    globalThis.MMCustomRequest = function (req) {
      return onRequest({ method: (req && req.method) || 'GET', path: (req && req.path) || '/' });
    };
    return { hooked: true, via: 'MMCustomRequest-global' };
  }

  // Best-effort host/port/IP for display. Falls back to placeholders.
  function getSharingInfo() {
    const app = getApp();
    let port = 0, host = 'this-pc';
    try { port = (app && app.sharing && app.sharing.port) || (app && app.getValue && app.getValue('sharingPort', 0)) || 0; } catch (e) {}
    try { host = (app && app.utils && app.utils.localIP) ? app.utils.localIP() : host; } catch (e) {}
    return { host, port };
  }

  // Persist/read the log file (best-effort; in-memory buffer is the source of truth).
  function appendLogFile(text) {
    const app = getApp();
    try {
      if (app && app.filesystem && app.filesystem.appendString) {
        app.filesystem.appendString(logPath(app), text + '\n');
        return true;
      }
    } catch (e) {}
    return false;
  }
  function readLogFile() {
    const app = getApp();
    try {
      if (app && app.filesystem && app.filesystem.loadTextFromFile) {
        return app.filesystem.loadTextFromFile(logPath(app)) || '';
      }
    } catch (e) {}
    return '';
  }
  function logPath(app) {
    try {
      const base = (app && app.filesystem && app.filesystem.getAppDataPath && app.filesystem.getAppDataPath()) || '.';
      return base + '/MamaMonkey.log';
    } catch (e) { return 'MamaMonkey.log'; }
  }

  // Add a menu item / status entry inside MM. Best-effort.
  function addStatusMenuItem(opts) {
    const app = getApp();
    try {
      if (app && app.menus && app.menus.addItem) {
        app.menus.addItem({ title: opts.label, execute: opts.onClick, location: 'tools' });
        return true;
      }
    } catch (e) {}
    return false;
  }

  MM.bindings = { registerHttpHandler, getSharingInfo, appendLogFile, readLogFile, addStatusMenuItem, getApp };
})();
```

- [ ] **Step 2: Smoke-test that the file is syntactically valid and exposes the API**

Run: `node -e "import('node:vm').then(async vm=>{const {readFileSync}=await import('node:fs');const c={console};vm.createContext(c);vm.runInContext(readFileSync('src/addon/mm-bindings.js','utf8'),c);if(!c.MamaMonkey.bindings.registerHttpHandler)throw new Error('missing api');console.log('mm-bindings OK');})"`
Expected: prints `mm-bindings OK` (no MM app present, but the module must load and expose `bindings`).

- [ ] **Step 3: Commit**

```bash
git add src/addon/mm-bindings.js
git commit -m "feat(addon): MM-API binding surface (HTTP hook, file IO, menu, sharing info)"
```

---

## Task 11: `logger.js` — Logger (glue over log-buffer + bindings)

**Files:**
- Create: `src/addon/logger.js`
- Test: `test/logger.test.mjs`

> The Logger's pure behavior (formatting, in-memory accumulation, file-IO failure tolerance) IS testable by loading `log-buffer.js` then `logger.js` into one vm context and injecting a fake `MamaMonkey.bindings`.

- [ ] **Step 1: Write the failing test** — `test/logger.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function loadLogger(fakeBindings) {
  const sandbox = { console };
  vm.createContext(sandbox);
  for (const f of ['lib/log-buffer.js', 'logger.js']) {
    const code = readFileSync(fileURLToPath(new URL(`../src/addon/${f}`, import.meta.url)), 'utf8');
    if (f === 'logger.js') {
      // inject fake bindings before logger.js runs
      sandbox.MamaMonkey.bindings = fakeBindings;
    }
    vm.runInContext(code, sandbox, { filename: f });
  }
  return sandbox.MamaMonkey;
}

test('log accumulates formatted lines retrievable via getText', () => {
  const ns = loadLogger({ appendLogFile: () => true, readLogFile: () => '' });
  const log = ns.createLogger({ maxBytes: 10000 });
  log.log('info', 'booted', { v: '0.1.0' });
  const text = log.getText();
  assert.match(text, /info/);
  assert.match(text, /booted/);
  assert.match(text, /0\.1\.0/);
});

test('logging survives a throwing file binding (in-memory still works)', () => {
  const ns = loadLogger({ appendLogFile: () => { throw new Error('disk fail'); }, readLogFile: () => '' });
  const log = ns.createLogger({ maxBytes: 10000 });
  assert.doesNotThrow(() => log.log('error', 'still ok'));
  assert.match(log.getText(), /still ok/);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test test/logger.test.mjs`
Expected: FAIL — `createLogger` is undefined.

- [ ] **Step 3: Implement** — `src/addon/logger.js`

```js
(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function createLogger(opts) {
    const buf = MM.createLogBuffer({ maxBytes: (opts && opts.maxBytes) || 64 * 1024 });
    const bindings = MM.bindings || {};
    let seq = 0;

    function fmt(level, msg, data) {
      seq += 1;
      let line = `#${seq} [${level}] ${msg}`;
      if (data !== undefined) {
        try { line += ' ' + JSON.stringify(data); } catch (e) { line += ' [unserializable]'; }
      }
      return line;
    }

    return {
      log(level, msg, data) {
        const line = fmt(level, msg, data);
        buf.append(line);
        try { bindings.appendLogFile && bindings.appendLogFile(line); } catch (e) { /* never crash on logging */ }
      },
      getText() {
        return buf.text();
      },
      clear() {
        buf.clear();
      },
    };
  }

  MM.createLogger = createLogger;
})();
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test test/logger.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/addon/logger.js test/logger.test.mjs
git commit -m "feat(addon): Logger over rolling buffer with crash-safe file persistence"
```

---

## Task 12: `http-controller.js` — wire router + pages + logger to bindings

**Files:**
- Create: `src/addon/http-controller.js`
- Test: `test/http-controller.test.mjs`

> The route wiring (which path returns what) is testable by loading the lib files + this file into a vm context with a fake bindings + logger and capturing the `onRequest` passed to `registerHttpHandler`.

- [ ] **Step 1: Write the failing test** — `test/http-controller.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function load(captured) {
  const sandbox = { console };
  vm.createContext(sandbox);
  const files = ['lib/log-buffer.js', 'lib/router.js', 'lib/pages.js', 'http-controller.js'];
  for (const f of files) {
    if (f === 'http-controller.js') {
      sandbox.MamaMonkey.bindings = {
        registerHttpHandler: (onRequest) => { captured.onRequest = onRequest; return { hooked: true }; },
        readLogFile: () => '',
        getSharingInfo: () => ({ host: '10.0.0.5', port: 56887 }),
      };
      sandbox.MamaMonkey.logger = { log() {}, getText: () => 'LOGTEXT' };
    }
    const code = readFileSync(fileURLToPath(new URL(`../src/addon/${f}`, import.meta.url)), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return sandbox.MamaMonkey;
}

test('GET / returns the status HTML with host/port', () => {
  const captured = {};
  const ns = load(captured);
  ns.startHttp({ name: 'MamaMonkey', version: '0.1.0' });
  const res = captured.onRequest({ method: 'GET', path: '/' });
  assert.equal(res.status, 200);
  assert.match(res.contentType, /text\/html/);
  assert.match(res.body, /56887/);
});

test('GET /health returns JSON ok:true', () => {
  const captured = {};
  const ns = load(captured);
  ns.startHttp({ name: 'MamaMonkey', version: '0.1.0' });
  const res = captured.onRequest({ method: 'GET', path: '/health' });
  assert.match(res.contentType, /application\/json/);
  assert.equal(JSON.parse(res.body).ok, true);
});

test('GET /logs returns the logger text as plain text', () => {
  const captured = {};
  const ns = load(captured);
  ns.startHttp({ name: 'MamaMonkey', version: '0.1.0' });
  const res = captured.onRequest({ method: 'GET', path: '/logs' });
  assert.match(res.contentType, /text\/plain/);
  assert.equal(res.body, 'LOGTEXT');
});

test('unknown path returns null (unhandled)', () => {
  const captured = {};
  const ns = load(captured);
  ns.startHttp({ name: 'MamaMonkey', version: '0.1.0' });
  assert.equal(captured.onRequest({ method: 'GET', path: '/whatever' }), null);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test test/http-controller.test.mjs`
Expected: FAIL — `startHttp` undefined.

- [ ] **Step 3: Implement** — `src/addon/http-controller.js`

```js
(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function nowISO() {
    // Date is available in MM's browser env; tests don't assert on its value.
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

  function startHttp(meta) {
    const bindings = MM.bindings;
    const logger = MM.logger || { log() {}, getText: () => '' };
    const info = bindings.getSharingInfo ? bindings.getSharingInfo() : { host: 'this-pc', port: 0 };

    const router = MM.createRouter();
    router.get('/', () =>
      ({ status: 200, contentType: 'text/html; charset=utf-8',
         body: MM.statusPage({ name: meta.name, version: meta.version, host: info.host, port: info.port }) }));
    router.get('/health', () =>
      ({ status: 200, contentType: 'application/json',
         body: MM.healthBody({ name: meta.name, version: meta.version, port: info.port, time: nowISO() }) }));
    router.get('/logs', () =>
      ({ status: 200, contentType: 'text/plain; charset=utf-8', body: logger.getText() }));

    const onRequest = (req) => router.dispatch(req.method, req.path);
    const result = bindings.registerHttpHandler(onRequest);
    logger.log('info', 'http handler registered', { result, host: info.host, port: info.port });
    return { router, info };
  }

  MM.startHttp = startHttp;
})();
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test test/http-controller.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/addon/http-controller.js test/http-controller.test.mjs
git commit -m "feat(addon): HTTP controller wiring / , /health, /logs to MM sharing port"
```

---

## Task 13: `status-panel.js` — in-MM menu entry (glue)

**Files:**
- Create: `src/addon/status-panel.js`
- Test: `test/status-panel.test.mjs`

- [ ] **Step 1: Write the failing test** — `test/status-panel.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function load(calls) {
  const sandbox = { console };
  vm.createContext(sandbox);
  sandbox.MamaMonkey = {
    bindings: { addStatusMenuItem: (opts) => { calls.push(opts); return true; }, getSharingInfo: () => ({ host: 'h', port: 1 }) },
    logger: { log() {}, getText: () => '' },
  };
  const code = readFileSync(fileURLToPath(new URL('../src/addon/status-panel.js', import.meta.url)), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'status-panel.js' });
  return sandbox.MamaMonkey;
}

test('mountStatusPanel registers a menu item with a label', () => {
  const calls = [];
  const ns = load(calls);
  ns.mountStatusPanel({ name: 'MamaMonkey', version: '0.1.0' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].label, /MamaMonkey/);
  assert.equal(typeof calls[0].onClick, 'function');
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test test/status-panel.test.mjs`
Expected: FAIL — `mountStatusPanel` undefined.

- [ ] **Step 3: Implement** — `src/addon/status-panel.js`

```js
(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function mountStatusPanel(meta) {
    const bindings = MM.bindings;
    const logger = MM.logger || { log() {} };
    const info = bindings.getSharingInfo ? bindings.getSharingInfo() : { host: 'this-pc', port: 0 };
    const label = `MamaMonkey ${meta.version} — http://${info.host}:${info.port}/`;

    const ok = bindings.addStatusMenuItem({
      label: label,
      onClick: function () {
        logger.log('info', 'status menu opened', { host: info.host, port: info.port });
        try {
          // Best-effort: surface the URL however MM allows. Falls back to a log line.
          if (globalThis.alert) globalThis.alert(label);
        } catch (e) {}
      },
    });
    logger.log('info', 'status panel mounted', { ok: !!ok, label });
    return { mounted: !!ok, label };
  }

  MM.mountStatusPanel = mountStatusPanel;
})();
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test test/status-panel.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/addon/status-panel.js test/status-panel.test.mjs
git commit -m "feat(addon): in-MM status menu item showing version and remote URL"
```

---

## Task 14: `init.js` — boot wiring (glue)

**Files:**
- Create: `src/addon/init.js`
- Test: `test/init.test.mjs`

> `init.js` must run in MM as a classic script. It reads its version from `info.json` content embedded at build time is overkill for Phase 0 — instead it hardcodes a `VERSION` constant that the version test (Task 8 pattern) keeps honest. We add a test that `init.js`'s `VERSION` matches `info.json`.

- [ ] **Step 1: Write the failing test** — `test/init.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const info = JSON.parse(readFileSync(new URL('../src/addon/info.json', import.meta.url)));

function loadAll(spy) {
  const sandbox = { console, window: {} };
  // capture whenReady callback
  sandbox.window.whenReady = (cb) => { spy.ready = cb; };
  vm.createContext(sandbox);
  const files = ['lib/log-buffer.js', 'lib/router.js', 'lib/pages.js', 'logger.js', 'http-controller.js', 'status-panel.js', 'init.js'];
  for (const f of files) {
    if (f === 'logger.js') {
      sandbox.MamaMonkey.bindings = {
        registerHttpHandler: () => ({ hooked: true }),
        appendLogFile: () => true, readLogFile: () => '',
        getSharingInfo: () => ({ host: 'h', port: 1 }),
        addStatusMenuItem: () => true,
      };
    }
    const code = readFileSync(fileURLToPath(new URL(`../src/addon/${f}`, import.meta.url)), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return sandbox;
}

test('init exposes VERSION matching info.json', () => {
  const spy = {};
  const sandbox = loadAll(spy);
  assert.equal(sandbox.MamaMonkey.VERSION, info.version);
});

test('init registers a whenReady boot that runs without throwing', () => {
  const spy = {};
  const sandbox = loadAll(spy);
  assert.equal(typeof spy.ready, 'function');
  assert.doesNotThrow(() => spy.ready());
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test test/init.test.mjs`
Expected: FAIL — `MamaMonkey.VERSION` undefined / `whenReady` not called.

- [ ] **Step 3: Implement** — `src/addon/init.js`

```js
(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  // Keep in sync with src/addon/info.json (enforced by test/init.test.mjs).
  MM.VERSION = '0.1.0';
  MM.NAME = 'MamaMonkey';

  function boot() {
    try {
      MM.logger = MM.createLogger({ maxBytes: 128 * 1024 });
      MM.logger.log('info', 'MamaMonkey booting', { version: MM.VERSION });
      MM.startHttp({ name: MM.NAME, version: MM.VERSION });
      MM.mountStatusPanel({ name: MM.NAME, version: MM.VERSION });
      MM.logger.log('info', 'MamaMonkey ready');
    } catch (e) {
      // Last-resort: try to record the failure somewhere visible.
      try { MM.logger && MM.logger.log('error', 'boot failed', { message: String(e) }); } catch (e2) {}
      try { if (globalThis.console) console.error('MamaMonkey boot failed', e); } catch (e3) {}
    }
  }

  // MM exposes window.whenReady; fall back to immediate boot if absent.
  const ready = (typeof window !== 'undefined' && window.whenReady) ||
                (globalThis.window && globalThis.window.whenReady);
  if (typeof ready === 'function') {
    ready(boot);
  } else {
    boot();
  }
})();
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test test/init.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the WHOLE suite + rebuild**

Run: `npm test && npm run build`
Expected: all tests PASS; `.mmip` rebuilt for 0.1.0.

- [ ] **Step 6: Commit**

```bash
git add src/addon/init.js test/init.test.mjs
git commit -m "feat(addon): boot wiring via whenReady (logger -> http -> status panel)"
```

---

## Task 15: `write-update-manifest.mjs` + initial `update.json`

**Files:**
- Create: `scripts/write-update-manifest.mjs`
- Create: `update.json`
- Test: `test/write-update-manifest.test.mjs`

- [ ] **Step 1: Write the failing test** — `test/write-update-manifest.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeManifest } from '../scripts/write-update-manifest.mjs';

test('computeManifest derives fields from info.json + download url', () => {
  const info = { id: 'mamamonkey', version: '0.2.0', minAppVersion: '5.0.0' };
  const m = computeManifest(info, 'https://example.com/mamamonkey-0.2.0.mmip');
  assert.equal(m.id, 'mamamonkey');
  assert.equal(m.version, '0.2.0');
  assert.equal(m.minAppVersion, '5.0.0');
  assert.equal(m.downloadURL, 'https://example.com/mamamonkey-0.2.0.mmip');
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test test/write-update-manifest.test.mjs`
Expected: FAIL — module/export not found.

- [ ] **Step 3: Implement** — `scripts/write-update-manifest.mjs`

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildUpdateManifest } from './lib/manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function computeManifest(info, downloadURL) {
  return buildUpdateManifest({
    id: info.id,
    version: info.version,
    minAppVersion: info.minAppVersion,
    downloadURL,
  });
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// Only run as a CLI (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('write-update-manifest.mjs')) {
  const downloadURL = arg('--download-url');
  if (!downloadURL) {
    console.error('Usage: write-update-manifest.mjs --download-url <url>');
    process.exit(1);
  }
  const info = JSON.parse(readFileSync(join(root, 'src', 'addon', 'info.json'), 'utf8'));
  const manifest = computeManifest(info, downloadURL);
  writeFileSync(join(root, 'update.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Wrote update.json:', manifest);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test test/write-update-manifest.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Generate the initial `update.json` for v0.1.0**

Run: `node scripts/write-update-manifest.mjs --download-url "https://github.com/J7U7G7/MamaMonkey/releases/download/v0.1.0/mamamonkey-0.1.0.mmip"`
Expected: writes `update.json`; prints the object.

- [ ] **Step 6: Commit**

```bash
git add scripts/write-update-manifest.mjs test/write-update-manifest.test.mjs update.json
git commit -m "feat(build): update.json generator + initial v0.1.0 manifest"
```

---

## Task 16: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Implement** — `.github/workflows/release.yml`

```yaml
name: release
on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout main (so we can commit update.json back)
        uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - run: npm ci

      - name: Run tests
        run: npm test

      - name: Build .mmip (asserts info.json version == tag)
        run: node scripts/build.mjs --tag "${GITHUB_REF_NAME}"

      - name: Create GitHub Release with the .mmip
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "${GITHUB_REF_NAME}" dist/*.mmip --title "${GITHUB_REF_NAME}" --notes "Automated release ${GITHUB_REF_NAME}"

      - name: Regenerate update.json pointing at the new asset
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          node scripts/write-update-manifest.mjs --download-url "https://github.com/${GITHUB_REPOSITORY}/releases/download/${GITHUB_REF_NAME}/mamamonkey-${VERSION}.mmip"

      - name: Commit update.json back to main
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add update.json
          if git diff --cached --quiet; then
            echo "update.json unchanged"
          else
            git commit -m "chore: update manifest for ${GITHUB_REF_NAME}"
            git push origin HEAD:main
          fi
```

- [ ] **Step 2: Lint the YAML locally (syntax sanity)**

Run: `node -e "const fs=require('node:fs');const s=fs.readFileSync('.github/workflows/release.yml','utf8');if(!/on:\s/.test(s)||!/jobs:/.test(s))throw new Error('bad yaml');console.log('workflow looks structurally ok')"`
Expected: prints `workflow looks structurally ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: release workflow (tag -> test -> build -> release -> update manifest)"
```

---

## Task 17: Full local verification + first real release

**Files:** none (operational).

- [ ] **Step 1: Full suite + clean build**

Run: `npm test && npm run build`
Expected: all tests PASS; `dist/mamamonkey-0.1.0.mmip` exists with `info.json` at root.

- [ ] **Step 2: Push all commits to main**

Run: `git push origin main`
Expected: GitHub updated; the raw `update.json` URL now resolves (open `https://raw.githubusercontent.com/J7U7G7/MamaMonkey/main/update.json`).

- [ ] **Step 3: Tag and trigger the first automated release**

Run: `git tag v0.1.0 && git push origin v0.1.0`
Expected: the `release` workflow runs; a v0.1.0 Release appears with `mamamonkey-0.1.0.mmip` attached; the workflow re-commits `update.json` (already pointing at v0.1.0, so likely "unchanged").

- [ ] **Step 4: Confirm the release via gh**

Run: `gh release view v0.1.0 --json assets --jq '.assets[].name'` (requires `gh auth login` once; if not authed, verify in the browser instead)
Expected: lists `mamamonkey-0.1.0.mmip`.

- [ ] **Step 5: Sanity-check the published manifest points at a downloadable asset**

Run: `curl -fsSL https://raw.githubusercontent.com/J7U7G7/MamaMonkey/main/update.json` then `curl -fsIL "$(curl -fsSL https://raw.githubusercontent.com/J7U7G7/MamaMonkey/main/update.json | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).downloadURL))')" | head -1`
Expected: manifest prints; the asset URL returns HTTP 200/302.

---

## Task 18: PC verification checklist (manual, user-assisted) — resolves the unknowns

**Files:** none (operational, run by the user on the Windows PC; results recorded back here and used to adjust glue files).

This is the real Phase 0 acceptance gate. The developer cannot run on the PC, so each step produces a log/observation the user pastes back. **Before starting, ask the user (optional but high-value) for the contents of `…\MediaMonkey 5\sampleScripts\remoteControl\`, the MM5 version, and the Media-Sharing port (Tools → Options → Media Sharing).** If provided, reconcile `mm-bindings.js` and `info.json` with the sample first, bump to v0.1.1, and re-release before testing.

- [ ] **Step 1: Install** — download `mamamonkey-0.1.0.mmip` from the v0.1.0 Release on the PC and open it in MediaMonkey 5. Confirm it installs without error. Record any error dialog text.

- [ ] **Step 2: Boot log** — restart MM. Open `Tools` (or wherever the menu landed) and confirm the **MamaMonkey status menu item** appears with a version + URL. Record the exact label (this reveals the detected host/port). If absent, note it (status panel glue needs adjustment).

- [ ] **Step 3: Serve-test from the PC** — in a browser on the PC, open `http://localhost:<MediaSharingPort>/`. **Record exactly what happens:** the MamaMonkey status page, MM's own UI, a 404, or nothing. *This is the Approach A vs B decision.*
  - **Page renders → Approach A confirmed.** Proceed.
  - **Not served / POST-only → Approach A insufficient.** Stop feature work; the next planning cycle specs the Approach B companion (the PWA + API contract are reusable). Record the observed behavior in detail.

- [ ] **Step 4: Serve-test from the iPhone** — on the iPhone (same Wi-Fi), open `http://<PC-LAN-IP>:<port>/`. Confirm the status page loads. Record success/failure. (Find the PC IP via `ipconfig` if the status label didn't show it.)

- [ ] **Step 5: `/health` and `/logs`** — open `http://<PC-IP>:<port>/health` (expect JSON `ok:true`) and `http://<PC-IP>:<port>/logs` (expect the boot log lines). Tap **Copy logs** on the status page and confirm it copies. Paste the logs back to the developer.

- [ ] **Step 6: Auto-update test** — back on the dev machine: bump `version` to `0.1.1` in BOTH `src/addon/info.json` and `package.json`, commit, push, then `git tag v0.1.1 && git push origin v0.1.1`. Wait for the workflow. On the PC, restart MM (or trigger its addon update check) and confirm MM detects v0.1.1 and updates. Record the update prompt/behavior. **This proves the update spine — the core Phase 0 goal.**

- [ ] **Step 7: Record outcomes in the repo** — append a short "Phase 0 verification results" section to `README.md` (or a new `docs/superpowers/notes/phase0-verification.md`) capturing: A-vs-B outcome, the real Media-Sharing port behavior, whether file logging worked, the menu/host/IP reality, and the confirmed `updateURL` manifest schema. Commit. These facts feed Phase 1's spec.

---

## Self-Review Notes (author check against spec)

- **Spec §4 goals → tasks:** install/boot (T8,T14,T18·1–2), auto-update (T15,T16,T17·3,T18·6), autolog (T2,T11,T12·/logs,T18·5), HTTP serve-test (T12,T18·3–4), status panel (T4,T13,T18·2). ✓
- **Spec §5 components → files:** init/Logger/HttpController/StatusPanel all present; logic split into testable `lib/` + thin glue. ✓
- **Spec §6 flows → tasks:** auto-update (T16/T17/T18·6), serve-test (T18·3), logging/remote-debug (T11/T18·5). ✓
- **Spec §7 repo layout:** matches, with the lib/glue split made explicit. ✓
- **Spec §8 CI:** T16 implements tag→build→release→manifest. ✓
- **Spec §9 unknowns:** isolated to `mm-bindings.js`; T18 resolves each and records results. ✓
- **Type/name consistency:** namespace `globalThis.MamaMonkey`; `createLogBuffer`, `createRouter`, `statusPage`/`healthBody`, `createLogger`, `MM.bindings.{registerHttpHandler,getSharingInfo,appendLogFile,readLogFile,addStatusMenuItem}`, `startHttp`, `mountStatusPanel`, `MM.VERSION/NAME` — used consistently across tasks and tests. ✓
- **Placeholder scan:** no TBD/TODO; uncertain MM calls are concrete implementations flagged for PC verification, not placeholders. ✓
