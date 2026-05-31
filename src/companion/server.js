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
 * config     — mutable config object (mutated live on POST /api/config); defaults to {}
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
          // no-store so phones never serve a stale PWA after an update.
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
  L.push('     ' + '📱 ' + D + 'Ouvre sur l’iPhone :' + R + '  ' + B + mdnsUrl + R + D + ' (ou via IP ci-dessous)' + R);
  urls.forEach((u) => L.push('     ' + '   ' + D + u + R));
  L.push('     ' + '🎧 ' + D + 'MediaMonkey :' + R + '        ' + config.mmHost + ':' + config.mmPort);
  L.push('  ' + P + '═════════════════════════════════════════' + R);
  L.push('  ' + D + 'Laisse cette fenêtre ouverte tant que tu utilises l’app.' + R);
  L.push('');
  return L.join('\n');
}

// Entry point: true when run as `node server.js` AND in a `bun build --compile` exe,
// false when imported by unit tests. (process.argv[1] is the exe path in a compiled
// binary, so a filename check would wrongly disable the server there.)
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
        try { unlinkSync(batPath); console.log('Auto-start removed.'); } catch (_e) { console.log('Not installed (nothing to remove).'); }
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
    const lanIp = (lanUrls(config.servePort)[0] || '').replace(/^http:\/\//, '').split(':')[0];

    // --- mDNS: answer A queries for mamamonkey.local with this PC's LAN IP ---
    try {
      const mdnsMod = await import('multicast-dns');
      const mdns = (mdnsMod.default || mdnsMod)();
      if (lanIp) {
        const answer = { name: 'mamamonkey.local', type: 'A', ttl: 120, data: lanIp };
        mdns.on('query', (q) => {
          if ((q.questions || []).some((x) => x.name && x.name.toLowerCase() === 'mamamonkey.local' && (x.type === 'A' || x.type === 'ANY'))) {
            try { mdns.respond({ answers: [answer] }); } catch (_) {}
          }
        });
        try { mdns.respond({ answers: [answer] }); } catch (_) {} // proactive announce
      }
    } catch (e) { console.log('mDNS off:', e.message); }

    // --- Banner ---
    let bannerText = banner(config);

    // --- QR code (encode the LAN IP — guaranteed to work; mamamonkey.local is a bonus) ---
    try {
      const QRCode = await import('qrcode');
      const qrUrl = lanIp ? `http://${lanIp}:${config.servePort}` : `http://mamamonkey.local:${config.servePort}`;
      const qr = await QRCode.default.toString(qrUrl, { type: 'terminal', small: true });
      bannerText += '\n  📷 Scanne pour ouvrir l\'app (' + qrUrl + ') :\n' + qr;
    } catch (e) { console.log('QR off:', e.message); }

    console.log(bannerText);

    // --- Auto-start hint (Windows only) ---
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

    // --- Self-update (Windows exe only; skip when version === 'dev') ---
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

    // Fetch releases list from GitHub
    const resp = await fetch('https://api.github.com/repos/J7U7G7/MamaMonkey/releases', {
      headers: { 'User-Agent': 'MamaMonkeyCompanion/' + version },
    });
    if (!resp.ok) { console.log('auto-update skipped: GitHub API', resp.status); return; }
    const releases = await resp.json();

    // Find the newest companion-vX.Y.Z tag
    let newestRelease = null, newestSemver = null;
    for (const rel of releases) {
      const tag = rel.tag_name || '';
      const m = tag.match(/^companion-v(\d+\.\d+\.\d+)$/);
      if (!m) continue;
      if (!newestSemver || isNewer(newestSemver, m[1])) {
        newestSemver = m[1];
        newestRelease = rel;
      }
    }
    if (!newestRelease) { console.log('auto-update skipped: no companion release found'); return; }

    // Compare to current version (strip prefix if present)
    const currentSemver = version.replace(/^companion-v/, '');
    if (!isNewer(currentSemver, newestSemver)) {
      console.log('auto-update: already up to date (' + version + ')');
      return;
    }

    // Find the exe asset
    const asset = (newestRelease.assets || []).find((a) => a.name === 'MamaMonkeyCompanion.exe');
    if (!asset) { console.log('auto-update skipped: exe asset not found in release'); return; }

    console.log(`auto-update: downloading ${asset.name} from ${newestRelease.tag_name}...`);
    const dlResp = await fetch(asset.browser_download_url);
    if (!dlResp.ok) { console.log('auto-update skipped: download failed', dlResp.status); return; }

    const buf = Buffer.from(await dlResp.arrayBuffer());

    // Verify size > 40 MB
    if (buf.length < 40_000_000) {
      console.log(`auto-update skipped: downloaded file too small (${buf.length} bytes)`);
      return;
    }

    const baseName = exeName.replace(/\.exe$/i, '');
    const newExePath = path.default.join(dir, baseName + '.new.exe');
    const bakExePath = path.default.join(dir, baseName + '.bak.exe');
    const batPath = path.default.join(dir, 'mm-update.bat');

    fs.default.writeFileSync(newExePath, buf);

    // Back up current exe
    fs.default.copyFileSync(currentExePath, bakExePath);

    // Write update bat (CRLF line endings for Windows)
    const batLines = [
      '@echo off',
      ':waitloop',
      'ping 127.0.0.1 -n 2 >nul',
      // retry the swap until the old exe is unlocked (process fully exited)
      `move /y "%~dp0${baseName}.new.exe" "%~dp0${exeName}" >nul 2>&1`,
      'if errorlevel 1 goto waitloop',
      // strip Mark-of-the-Web so SmartScreen doesn't block the silent relaunch
      `powershell -NoProfile -Command "Unblock-File -LiteralPath '%~dp0${exeName}'" >nul 2>&1`,
      `start "" "%~dp0${exeName}"`,
      'del "%~f0"',
    ];
    fs.default.writeFileSync(batPath, batLines.join('\r\n') + '\r\n', 'utf8');

    console.log('auto-update: launching updater bat and exiting...');
    cp.default.spawn('cmd', ['/c', batPath], { detached: true, stdio: 'ignore' }).unref();
    process.exit(0);
  } catch (e) {
    console.log('auto-update skipped:', e.message);
  }
}
