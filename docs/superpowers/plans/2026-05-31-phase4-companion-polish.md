# Phase 4 Companion Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add version embedding, persistent config file + settings endpoints, mDNS advertising, QR code banner, self-updating exe, and Windows auto-start to the MamaMonkey companion server.

**Architecture:** Each feature is added defensively to `src/companion/` — any failure logs and never crashes the server. Config becomes a mutable shared object. The entry block (`import.meta.main`) handles startup and Windows-specific side-effects so they are never triggered during unit tests.

**Tech Stack:** Node/Bun (ESM), `bonjour-service`, `qrcode`, `node:fs`, `node:path`, `node:child_process`, `node:test` for tests.

**Shell prefix:** Always run shell commands with `export PATH="/opt/homebrew/bin:$PATH" &&` prepended.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/companion/version.js` | Create | Single export `COMPANION_VERSION = 'dev'` |
| `src/companion/config.js` | Modify | Add `loadConfigFile`, `saveConfigFile`, `mergeConfig` (pure helper); update `resolveConfig` to load from file; add config file path helper |
| `src/companion/server.js` | Modify | Import `COMPANION_VERSION`; add `GET/POST /api/config` routes; make `makeForward` read from shared mutable config; make listen callback async with mDNS + QR; add `maybeSelfUpdate`; add `--install-startup`/`--uninstall-startup` handlers |
| `.github/workflows/companion-release.yml` | Modify | Add step to write `version.js` before bun compile |
| `package.json` | Modify | Add `bonjour-service` and `qrcode` to `dependencies` |
| `test/companion-server.test.mjs` | Modify | Update tests for new `createHandler` signature (now needs `config` object); add `GET /api/config` and `POST /api/config` tests; add `banner` still returns string test |
| `test/companion-config.test.mjs` | Modify | Add `mergeConfig` precedence tests; add config file load/save tests |

---

## Task 1: Version embedding

**Files:**
- Create: `src/companion/version.js`
- Modify: `.github/workflows/companion-release.yml` (add version-write step before bun compile)

- [ ] **Step 1.1: Create version.js**

```js
// src/companion/version.js
// Overwritten at build time by companion-release.yml with the actual tag.
export const COMPANION_VERSION = 'dev';
```

- [ ] **Step 1.2: Add version-write step to companion-release.yml**

In `.github/workflows/companion-release.yml`, insert a new step BEFORE "Compile Windows exe":

```yaml
      - name: Embed version
        run: echo "export const COMPANION_VERSION = '${GITHUB_REF_NAME}';" > src/companion/version.js
```

The full "Compile Windows exe" step remains unchanged after it.

- [ ] **Step 1.3: Verify node --check**

```bash
export PATH="/opt/homebrew/bin:$PATH" && node --check src/companion/version.js
```
Expected: no output (clean).

- [ ] **Step 1.4: Run tests (should still pass — no tests touch version.js yet)**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1 | tail -10
```
Expected: 52 pass, 0 fail.

- [ ] **Step 1.5: Commit**

```bash
git -c user.name="J7U7G7" -c user.email="tripleseptconsulting@gmail.com" add src/companion/version.js .github/workflows/companion-release.yml && git -c user.name="J7U7G7" -c user.email="tripleseptconsulting@gmail.com" commit -m "$(cat <<'EOF'
feat(companion): embed COMPANION_VERSION at build time

version.js exports 'dev' locally; companion-release.yml overwrites it
with the git tag before bun compile so the exe always knows its version.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Config file + settings endpoints

**Files:**
- Modify: `src/companion/config.js`
- Modify: `src/companion/server.js`
- Modify: `test/companion-config.test.mjs`
- Modify: `test/companion-server.test.mjs`

### 2a: Extend config.js with file load/save and mergeConfig

- [ ] **Step 2a.1: Write failing tests for mergeConfig**

In `test/companion-config.test.mjs`, add BELOW the existing tests:

```js
import { mergeConfig, resolveConfig } from '../src/companion/config.js';

test('mergeConfig: file < env < CLI precedence', () => {
  const c = mergeConfig(
    { servePort: 8088, mmHost: '127.0.0.1', mmPort: 18391, autoStart: false },  // defaults
    { mmHost: '192.168.1.5', mmPort: 20000 },  // file
    {},                                          // env
    {}                                           // CLI
  );
  assert.equal(c.mmHost, '192.168.1.5');
  assert.equal(c.mmPort, 20000);
  assert.equal(c.servePort, 8088);
});

test('mergeConfig: CLI beats file', () => {
  const c = mergeConfig(
    { servePort: 8088, mmHost: '127.0.0.1', mmPort: 18391, autoStart: false },
    { mmHost: '192.168.1.5' },
    {},
    { mmHost: '10.0.0.1' }
  );
  assert.equal(c.mmHost, '10.0.0.1');
});

test('mergeConfig: env beats file', () => {
  const c = mergeConfig(
    { servePort: 8088, mmHost: '127.0.0.1', mmPort: 18391, autoStart: false },
    { mmHost: '192.168.1.5' },
    { mmHost: '172.16.0.1' },
    {}
  );
  assert.equal(c.mmHost, '172.16.0.1');
});
```

- [ ] **Step 2a.2: Run tests to confirm they fail**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1 | grep -E "(fail|mergeConfig|not defined)"
```
Expected: `mergeConfig is not a function` or import error.

- [ ] **Step 2a.3: Rewrite config.js with mergeConfig, loadConfigFile, saveConfigFile**

Replace the entire content of `src/companion/config.js` with:

```js
import fs from 'node:fs';
import path from 'node:path';

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}
function toPort(v, dflt) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : dflt;
}

/** Returns the directory where the config file lives:
 *  next to the exe when compiled (process.execPath), else cwd. */
export function configDir() {
  // bun compiled exes have a real execPath; node's execPath is the node binary itself.
  // We detect "running as compiled exe" by checking if execPath is NOT the node/bun binary.
  const ep = process.execPath || '';
  const isCompiled = !ep.endsWith('node') && !ep.endsWith('bun') && !ep.includes('/bin/');
  return isCompiled ? path.dirname(ep) : process.cwd();
}

export function configFilePath(dir) {
  return path.join(dir ?? configDir(), 'mamamonkey-config.json');
}

/** Load config file — returns {} on missing/bad JSON (never throws). */
export function loadConfigFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

/** Persist config fields to file — never throws. */
export function saveConfigFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.log('config save failed:', e.message);
    return false;
  }
}

/**
 * Pure merge: defaults < file < env < CLI.
 * @param {object} defaults
 * @param {object} file     — from mamamonkey-config.json
 * @param {object} envVars  — already extracted from process.env (mmHost, mmPort, servePort)
 * @param {object} cliArgs  — already extracted from argv (mmHost, mmPort, servePort)
 */
export function mergeConfig(defaults, file, envVars, cliArgs) {
  const pick = (key, transform, fallback) => {
    if (cliArgs[key] !== undefined) return transform ? transform(cliArgs[key]) : cliArgs[key];
    if (envVars[key] !== undefined) return transform ? transform(envVars[key]) : envVars[key];
    if (file[key] !== undefined) return transform ? transform(file[key]) : file[key];
    return defaults[key] !== undefined ? defaults[key] : fallback;
  };
  return {
    servePort: pick('servePort', (v) => toPort(v, defaults.servePort), defaults.servePort),
    mmHost: pick('mmHost', null, defaults.mmHost),
    mmPort: pick('mmPort', (v) => toPort(v, defaults.mmPort), defaults.mmPort),
    autoStart: pick('autoStart', (v) => Boolean(v), defaults.autoStart ?? false),
  };
}

export function resolveConfig({ argv = [], env = {} } = {}, fileOverride = null) {
  const filePath = fileOverride ?? configFilePath();
  const fileData = loadConfigFile(filePath);

  const defaults = { servePort: 8088, mmHost: '127.0.0.1', mmPort: 18391, autoStart: false };

  const envVars = {
    servePort: env.MM_SERVE_PORT,
    mmHost: env.MM_HOST,
    mmPort: env.MM_PORT,
  };
  const cliArgs = {
    servePort: flag(argv, '--serve-port'),
    mmHost: flag(argv, '--mm-host'),
    mmPort: flag(argv, '--mm-port'),
  };

  return mergeConfig(defaults, fileData, envVars, cliArgs);
}
```

- [ ] **Step 2a.4: Run tests — mergeConfig tests should pass; existing config tests still pass**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1 | grep -E "(pass|fail|config)"
```
Expected: all pass, 0 fail.

### 2b: Add GET /api/config and POST /api/config to server.js

- [ ] **Step 2b.1: Write failing tests for the new routes**

In `test/companion-server.test.mjs`, add BELOW the existing tests:

```js
// helper: create a shared mutable config for tests
function makeConfig(overrides = {}) {
  return Object.assign({ servePort: 8088, mmHost: '127.0.0.1', mmPort: 18391, autoStart: false }, overrides);
}
function noop() {}

test('GET /api/config returns current config and version', async () => {
  const config = makeConfig();
  const h = createHandler({ assets, forward: async () => ({}), config, saveConfig: noop });
  const res = mockRes();
  await h(mockReq('GET', '/api/config'), res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.servePort, 8088);
  assert.ok('version' in body);
});

test('POST /api/config merges fields and persists', async () => {
  const config = makeConfig();
  let saved = null;
  const saveConfig = (data) => { saved = data; };
  const h = createHandler({ assets, forward: async () => ({}), config, saveConfig });
  const res = mockRes();
  await h(mockReq('POST', '/api/config', { mmHost: '10.0.0.2', mmPort: 20000 }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(config.mmHost, '10.0.0.2');
  assert.equal(config.mmPort, 20000);
  assert.deepEqual(saved, { mmHost: '10.0.0.2', mmPort: 20000, servePort: 8088, autoStart: false });
});

test('POST /api/config with servePort returns restartNeeded', async () => {
  const config = makeConfig();
  const h = createHandler({ assets, forward: async () => ({}), config, saveConfig: noop });
  const res = mockRes();
  await h(mockReq('POST', '/api/config', { servePort: 9999 }), res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.restartNeeded, true);
  assert.equal(config.servePort, 9999);
});

test('POST /api/config bad JSON -> 400', async () => {
  const config = makeConfig();
  const h = createHandler({ assets, forward: async () => ({}), config, saveConfig: noop });
  const res = mockRes();
  // create a manually malformed request
  const req = { method: 'POST', url: '/api/config', _chunks: [Buffer.from('{bad json')],
    on(ev, cb) { if (ev === 'data') this._chunks.forEach(c => cb(c)); if (ev === 'end') cb(); return this; } };
  await h(req, res);
  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2b.2: Run tests to confirm new tests fail**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1 | grep -E "(fail|/api/config)"
```
Expected: 4 failures about `/api/config`.

- [ ] **Step 2b.3: Update server.js — add config/saveConfig params + routes**

Replace the entire `src/companion/server.js` with the version that:
1. Accepts `{ assets, forward, config, saveConfig }` in `createHandler`
2. Adds `GET /api/config` and `POST /api/config` routes
3. Makes `makeForward` read from the `config` object at call time (not a snapshot)

Full new content for `src/companion/server.js`:

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

/**
 * makeForward(configRef) — configRef is the live mutable config object.
 * Each call reads mmHost/mmPort at invocation time so live config changes apply immediately.
 */
export function makeForward(configRef) {
  return async function forward(bodyObj) {
    const r = await fetch(`http://${configRef.mmHost}:${configRef.mmPort}/`, {
      method: 'POST',
      headers: { 'MMCustomRequest': 'true', 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
    });
    return { status: r.status, text: await r.text() };
  };
}

/**
 * createHandler({ assets, forward, config, saveConfig })
 * config  — mutable config object (mutated live on POST /api/config)
 * saveConfig — fn(data) that persists config to disk (optional, defaults to noop)
 */
export function createHandler({ assets, forward, config = {}, saveConfig = () => {} }) {
  return async function handler(req, res) {
    try {
      const urlPath = (req.url || '/').split('?')[0];

      // --- GET /api/config ---
      if (req.method === 'GET' && urlPath === '/api/config') {
        let version = 'dev';
        try { ({ COMPANION_VERSION: version } = await import('./version.js')); } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          servePort: config.servePort,
          mmHost: config.mmHost,
          mmPort: config.mmPort,
          autoStart: config.autoStart,
          version,
        }));
      }

      // --- POST /api/config ---
      if (req.method === 'POST' && urlPath === '/api/config') {
        const raw = await readBody(req);
        let patch;
        try { patch = JSON.parse(raw); } catch (_) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
        }
        let restartNeeded = false;
        const allowed = ['mmHost', 'mmPort', 'servePort', 'autoStart'];
        for (const key of allowed) {
          if (patch[key] !== undefined) {
            if (key === 'servePort' && patch[key] !== config.servePort) restartNeeded = true;
            config[key] = patch[key];
          }
        }
        try {
          saveConfig({ mmHost: config.mmHost, mmPort: config.mmPort, servePort: config.servePort, autoStart: config.autoStart });
        } catch (e) {
          console.log('config persist failed:', e.message);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, restartNeeded }));
      }

      // --- POST /api/command ---
      if (req.method === 'POST' && urlPath === '/api/command') {
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

      // --- Static assets ---
      if (req.method === 'GET') {
        const key = urlPath === '/' ? '/index.html' : urlPath;
        const asset = assets[key];
        if (asset) {
          res.writeHead(200, { 'Content-Type': asset.contentType, 'Cache-Control': 'no-store' });
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

// A little console art for SuperMama 💕 (returned as a string so it's testable).
export function banner(config) {
  const P = '\x1b[38;5;205m', G = '\x1b[1m\x1b[38;5;222m', B = '\x1b[1m', D = '\x1b[2m', R = '\x1b[0m';
  let urls = lanUrls(config.servePort);
  if (!urls.length) urls = [`http://localhost:${config.servePort}`];
  const mdnsUrl = `http://mamamonkey.local:${config.servePort}`;
  const L = [];
  L.push('');
  L.push(P + '            ,d88b.  .d88b,' + R);
  L.push(P + '            88888888888888      ' + G + 'Bonne fête, SuperMama  !' + R);
  L.push(P + "            `Y888888888Y'       " + R + '🦸‍♀️  ❦  💕');
  L.push(P + "              `Y88888Y'" + R);
  L.push(P + "                `Y8Y'" + R);
  L.push(P + "                  `'" + R);
  L.push('');
  L.push('  ' + B + '🎵 MamaMonkey companion' + R + D + ' — en ligne' + R);
  L.push('  ' + P + '═════════════════════════════════════════' + R);
  L.push('     ' + '📱 ' + D + 'Ouvre sur l'iPhone :' + R + '  ' + B + mdnsUrl + R + D + ' (ou via IP ci-dessous)' + R);
  urls.forEach((u) => L.push('     ' + '   ' + D + u + R));
  L.push('     ' + '🎧 ' + D + 'MediaMonkey :' + R + '        ' + config.mmHost + ':' + config.mmPort);
  L.push('  ' + P + '═════════════════════════════════════════' + R);
  L.push('  ' + D + 'Laisse cette fenêtre ouverte tant que tu utilises l'app.' + R);
  L.push('');
  return L.join('\n');
}

if (import.meta.main) {
  const { resolveConfig, configFilePath, saveConfigFile } = await import('./config.js');
  const { COMPANION_VERSION } = await import('./version.js');
  const { ASSETS } = await import('./assets.js');

  // --- CLI flags: --install-startup / --uninstall-startup ---
  const argv = process.argv.slice(2);
  if (argv.includes('--install-startup') || argv.includes('--uninstall-startup')) {
    try {
      const appdata = process.env.APPDATA;
      if (!appdata) throw new Error('APPDATA not set (Windows only)');
      const startupDir = `${appdata}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup`;
      const batPath = `${startupDir}\\MamaMonkey.bat`;
      if (argv.includes('--install-startup')) {
        const exePath = process.execPath;
        const batContent = `@echo off\nstart "" "${exePath}"\n`;
        const { writeFileSync } = await import('node:fs');
        writeFileSync(batPath, batContent, 'utf8');
        console.log(`Auto-start installed: ${batPath}`);
      } else {
        const { unlinkSync } = await import('node:fs');
        try { unlinkSync(batPath); console.log('Auto-start removed.'); } catch (e) { console.log('Not installed (nothing to remove).'); }
      }
    } catch (e) {
      console.log('startup flag error:', e.message);
    }
    process.exit(0);
  }

  const configPath = configFilePath();
  const config = resolveConfig({ argv, env: process.env });
  const saveConfig = (data) => saveConfigFile(configPath, data);
  const forward = makeForward(config);
  const handler = createHandler({ assets: ASSETS, forward, config, saveConfig });

  http.createServer(handler).listen(config.servePort, '0.0.0.0', async () => {
    // --- mDNS ---
    try {
      const { Bonjour } = await import('bonjour-service');
      new Bonjour().publish({ name: 'MamaMonkey', type: 'http', port: config.servePort, host: 'mamamonkey' });
    } catch (e) { console.log('mDNS off:', e.message); }

    // --- Banner ---
    let bannerText = banner(config);

    // --- QR code ---
    try {
      const QRCode = await import('qrcode');
      const urls = lanUrls(config.servePort);
      const primaryUrl = `http://mamamonkey.local:${config.servePort}`;
      const qrUrl = primaryUrl; // prefer mDNS name; IP is shown in banner already
      const qr = await QRCode.default.toString(qrUrl, { type: 'terminal', small: true });
      bannerText += '\n  📷 Scanne pour ouvrir l\'app :\n' + qr;
    } catch (e) { console.log('QR off:', e.message); }

    console.log(bannerText);

    // --- Auto-start hint ---
    try {
      const appdata = process.env.APPDATA;
      if (appdata) {
        const batPath = `${appdata}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\MamaMonkey.bat`;
        const { existsSync } = await import('node:fs');
        if (!existsSync(batPath)) {
          console.log('(astuce: lance avec --install-startup pour démarrer avec Windows)');
        }
      }
    } catch (_) {}

    // --- Self-update (Windows, skip dev) ---
    if (COMPANION_VERSION !== 'dev') {
      maybeSelfUpdate(process.execPath, COMPANION_VERSION).catch(() => {});
    }
  });
}

/** Compare two semver strings "X.Y.Z". Returns true if b > a. */
function isNewer(a, b) {
  try {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (pb[i] > pa[i]) return true;
      if (pb[i] < pa[i]) return false;
    }
    return false;
  } catch (_) { return false; }
}

async function maybeSelfUpdate(currentExePath, version) {
  try {
    const path = await import('node:path');
    const fs = await import('node:fs');
    const cp = await import('node:child_process');
    const dir = path.default.dirname(currentExePath);
    const exeName = path.default.basename(currentExePath);

    // Fetch releases
    const resp = await fetch('https://api.github.com/repos/J7U7G7/MamaMonkey/releases', {
      headers: { 'User-Agent': 'MamaMonkeyCompanion/' + version },
    });
    if (!resp.ok) { console.log('auto-update skipped: GitHub API', resp.status); return; }
    const releases = await resp.json();

    // Find newest companion-vX.Y.Z tag
    let newestTag = null, newestSemver = null;
    for (const rel of releases) {
      const tag = rel.tag_name || '';
      const m = tag.match(/^companion-v(\d+\.\d+\.\d+)$/);
      if (!m) continue;
      if (!newestSemver || isNewer(newestSemver, m[1])) {
        newestSemver = m[1];
        newestTag = rel;
      }
    }
    if (!newestTag) { console.log('auto-update skipped: no companion release found'); return; }
    if (!isNewer(version.replace(/^companion-v/, ''), newestSemver)) {
      console.log('auto-update: already up to date (' + version + ')');
      return;
    }

    // Find the exe asset
    const asset = (newestTag.assets || []).find((a) => a.name === 'MamaMonkeyCompanion.exe');
    if (!asset) { console.log('auto-update skipped: exe asset not found in release'); return; }

    console.log(`auto-update: downloading ${asset.name} from ${newestTag.tag_name}...`);
    const dlResp = await fetch(asset.browser_download_url);
    if (!dlResp.ok) { console.log('auto-update skipped: download failed', dlResp.status); return; }
    const newExePath = path.default.join(dir, exeName.replace('.exe', '') + '.new.exe');
    const bakExePath = path.default.join(dir, exeName.replace('.exe', '') + '.bak.exe');
    const batPath = path.default.join(dir, 'mm-update.bat');

    const buf = Buffer.from(await dlResp.arrayBuffer());
    if (buf.length < 40_000_000) {
      console.log(`auto-update skipped: downloaded file too small (${buf.length} bytes)`);
      try { fs.default.unlinkSync(newExePath); } catch (_) {}
      return;
    }
    fs.default.writeFileSync(newExePath, buf);

    // Back up current exe
    fs.default.copyFileSync(currentExePath, bakExePath);

    // Write update bat
    const batContent = [
      '@echo off',
      'ping 127.0.0.1 -n 3 >nul',
      `move /y "%~dp0${exeName.replace('.exe', '')}.new.exe" "%~dp0${exeName}" >nul`,
      `start "" "%~dp0${exeName}"`,
      'del "%~f0"',
    ].join('\r\n') + '\r\n';
    fs.default.writeFileSync(batPath, batContent, 'utf8');

    console.log('auto-update: launching updater bat and exiting...');
    cp.default.spawn('cmd', ['/c', batPath], { detached: true, stdio: 'ignore' }).unref();
    process.exit(0);
  } catch (e) {
    console.log('auto-update skipped:', e.message);
  }
}
```

- [ ] **Step 2b.4: Update existing tests that pass `forward` without `config`**

The existing tests call `createHandler({ assets, forward })`. Since `config` and `saveConfig` now have defaults (`{}` and `() => {}`), these tests should still work. However we need to verify them.

- [ ] **Step 2b.5: Run all tests**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1 | tail -15
```
Expected: all 52+ tests pass, 0 fail.

- [ ] **Step 2b.6: node --check**

```bash
export PATH="/opt/homebrew/bin:$PATH" && node --check src/companion/server.js && node --check src/companion/config.js && echo "clean"
```
Expected: `clean`

- [ ] **Step 2b.7: Commit**

```bash
git -c user.name="J7U7G7" -c user.email="tripleseptconsulting@gmail.com" add src/companion/server.js src/companion/config.js test/companion-server.test.mjs test/companion-config.test.mjs && git -c user.name="J7U7G7" -c user.email="tripleseptconsulting@gmail.com" commit -m "$(cat <<'EOF'
feat(companion): config file + GET/POST /api/config endpoints

Adds mamamonkey-config.json persistence (defaults < file < env < CLI),
live mmHost/mmPort updates, and a restartNeeded flag for servePort changes.
mergeConfig is a pure helper for clean unit testing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: mDNS + QR code + banner update

**Files:**
- Modify: `package.json` (add `bonjour-service` and `qrcode` to dependencies)
- Modify: `src/companion/server.js` (already done in Task 2 — verify the listen callback has mDNS + QR)

Note: The mDNS and QR code code was already written into server.js during Task 2. This task just installs the packages.

- [ ] **Step 3.1: Add dependencies to package.json**

Edit `package.json` to add a `"dependencies"` block:

```json
{
  "name": "mamamonkey",
  "version": "0.5.0",
  "private": true,
  "type": "module",
  "description": "Web-based MediaMonkey 5 remote control for iPhone (Phase 0: the update spine).",
  "scripts": {
    "test": "node --test",
    "build": "node scripts/build.mjs",
    "bundle-web": "node scripts/bundle-web.mjs",
    "companion:dev": "node scripts/bundle-web.mjs && node src/companion/server.js",
    "gen-icons": "node scripts/gen-icons.mjs"
  },
  "dependencies": {
    "bonjour-service": "^1.2.1",
    "qrcode": "^1.5.4"
  },
  "devDependencies": {
    "adm-zip": "^0.5.16",
    "sharp": "^0.34.5"
  }
}
```

- [ ] **Step 3.2: Install new packages**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm install
```
Expected: `bonjour-service` and `qrcode` installed under `node_modules/`.

- [ ] **Step 3.3: Run tests**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1 | tail -10
```
Expected: all tests pass, 0 fail.

- [ ] **Step 3.4: Quick smoke test — start server briefly, check for banner and QR output**

```bash
export PATH="/opt/homebrew/bin:$PATH" && node src/companion/server.js --serve-port 8099 --mm-host 127.0.0.1 &
sleep 3 && kill %1 2>/dev/null; true
```
Expected: banner prints with mamamonkey.local URL and ASCII QR code blocks in terminal output. mDNS error may print if OS doesn't allow (that's OK — it logs `mDNS off: ...`).

- [ ] **Step 3.5: Commit**

```bash
git -c user.name="J7U7G7" -c user.email="tripleseptconsulting@gmail.com" add package.json package-lock.json && git -c user.name="J7U7G7" -c user.email="tripleseptconsulting@gmail.com" commit -m "$(cat <<'EOF'
feat(companion): mDNS advertising + QR code banner + bonjour/qrcode deps

Advertises mamamonkey.local via bonjour-service on startup; renders
the connect URL as an ASCII QR code in the console. Both fail gracefully.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Self-update mechanism

Note: The `maybeSelfUpdate` function was written into server.js in Task 2 step 2b.3. This task verifies the logic is correct and adds comments.

- [ ] **Step 4.1: Verify `isNewer` semver logic is correct**

Check the function handles edge cases:
- `isNewer('0.2.3', '0.2.4')` → true
- `isNewer('0.2.3', '0.2.3')` → false
- `isNewer('0.3.0', '0.2.9')` → false

These are pure functions easily validated by reading, no test file changes needed (Windows-only behavior can't run on Mac).

- [ ] **Step 4.2: Verify dev skip is in place**

In server.js entry block, confirm the guard reads:
```js
if (COMPANION_VERSION !== 'dev') {
  maybeSelfUpdate(process.execPath, COMPANION_VERSION).catch(() => {});
}
```
This means local runs (version.js = 'dev') never trigger self-update. Good.

- [ ] **Step 4.3: node --check src/companion/server.js**

```bash
export PATH="/opt/homebrew/bin:$PATH" && node --check src/companion/server.js && echo "clean"
```
Expected: `clean`

No new commit needed — already included in Task 2 commit.

---

## Task 5: Auto-start (Windows)

Note: `--install-startup`, `--uninstall-startup`, and the hint were written in server.js in Task 2 step 2b.3. This task verifies them.

- [ ] **Step 5.1: Review the startup flag handling in server.js**

Confirm in the entry block:
1. `argv.includes('--install-startup')` — writes bat to APPDATA startup folder
2. `argv.includes('--uninstall-startup')` — deletes the bat
3. Both wrapped in try/catch, call `process.exit(0)` after
4. Hint line printed if `APPDATA` is set and bat doesn't exist

- [ ] **Step 5.2: Verify APPDATA guard (non-Windows)**

On Mac/Linux `process.env.APPDATA` is undefined, so the hint code's outer `if (appdata)` means it silently skips. The startup flag path throws `APPDATA not set` and logs it gracefully — no crash.

- [ ] **Step 5.3: node --check**

```bash
export PATH="/opt/homebrew/bin:$PATH" && node --check src/companion/server.js && echo "clean"
```
Expected: `clean`

No new commit needed — already included in Task 2 commit.

---

## Task 6: Final verification + full test run

- [ ] **Step 6.1: Run full test suite**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1
```
Expected: all tests pass (≥52 + new ones added), 0 fail.

- [ ] **Step 6.2: node --check on all companion files**

```bash
export PATH="/opt/homebrew/bin:$PATH" && node --check src/companion/server.js && node --check src/companion/config.js && node --check src/companion/version.js && echo "all clean"
```
Expected: `all clean`

- [ ] **Step 6.3: Smoke test — start the server**

```bash
export PATH="/opt/homebrew/bin:$PATH" && timeout 5 node src/companion/server.js --serve-port 8099 --mm-host 127.0.0.1 2>&1 || true
```
Expected: banner prints, mDNS logs (may show "mDNS off:" on Mac), QR appears, no crash.

- [ ] **Step 6.4: Verify git log shows feature commits**

```bash
git log --oneline -6
```
Expected: 3+ commits for version embedding, config/endpoints, mDNS+QR.

---

## Self-Review: Spec Coverage Check

| Spec Requirement | Task |
|-----------------|------|
| version.js with COMPANION_VERSION = 'dev' | Task 1 |
| Release workflow overwrites version.js with tag | Task 1 |
| server.js imports COMPANION_VERSION | Task 2b |
| mamamonkey-config.json next to exe | Task 2a |
| Precedence: defaults < file < env < CLI | Task 2a |
| GET /api/config returns config + version | Task 2b |
| POST /api/config merges + persists + live update | Task 2b |
| servePort change returns restartNeeded | Task 2b |
| makeForward reads from mutable config object | Task 2b |
| bonjour-service in dependencies | Task 3 |
| mDNS publish on listen | Task 2b (entry block) |
| mamamonkey.local in banner | Task 2b (banner function) |
| qrcode in dependencies | Task 3 |
| QR code in listen callback | Task 2b (entry block) |
| Self-update: skip if version === 'dev' | Task 4 |
| Self-update: fetch GitHub API, find newest companion-v* | Task 4 |
| Self-update: download exe, verify size > 40MB | Task 4 |
| Self-update: backup exe, write bat, spawn + exit | Task 4 |
| Self-update: any error → log and continue | Task 4 |
| --install-startup writes to APPDATA startup | Task 5 |
| --uninstall-startup deletes it | Task 5 |
| Hint printed if not installed | Task 5 |
| npm test green | Task 6 |
| node --check clean | Task 6 |
| Tests for mergeConfig precedence | Task 2a |
| Tests for GET/POST /api/config | Task 2b |
