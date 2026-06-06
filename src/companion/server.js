import http from 'node:http';
import dgram from 'node:dgram';
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
 * Proxies to MediaMonkey's media-sharing server. MM usually listens on 127.0.0.1, but on some
 * PCs (esp. with WSL/Hyper-V virtual adapters) it binds to the LAN IP instead — so we try the
 * configured host first, then the detected LAN IPs, and remember the one that works.
 * `lanProvider` is injectable for tests.
 */
export function makeForward(configRef, lanProvider) {
  const getLan = lanProvider || (() => lanUrls(0).map((u) => u.slice('http://'.length).replace(/:0$/, '')));
  let goodHost = null;
  async function tryHost(host, bodyObj) {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const to = ctrl ? setTimeout(() => ctrl.abort(), 3000) : null;
    try {
      const r = await fetch(`http://${host}:${configRef.mmPort}/`, {
        method: 'POST',
        headers: { 'MMCustomRequest': 'true', 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
        signal: ctrl ? ctrl.signal : undefined,
      });
      return { status: r.status, text: await r.text() };
    } finally { if (to) clearTimeout(to); }
  }
  return async function forward(bodyObj) {
    const candidates = [];
    if (goodHost) candidates.push(goodHost);
    const base = configRef.mmHost || '127.0.0.1';
    if (candidates.indexOf(base) < 0) candidates.push(base);
    try { getLan().forEach((ip) => { if (ip && candidates.indexOf(ip) < 0) candidates.push(ip); }); } catch (_) {}
    let lastErr;
    for (const host of candidates) {
      try { const out = await tryHost(host, bodyObj); goodHost = host; return out; }
      catch (e) { lastErr = e; if (goodHost === host) goodHost = null; }
    }
    throw lastErr || new Error('MediaMonkey unreachable on any host');
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
        // Only ports are settable over the network, and they must be valid (1..65535).
        // mmHost is intentionally NOT network-settable: the companion always proxies to its
        // configured host (default 127.0.0.1) — accepting an arbitrary host here would let any
        // LAN client turn the relay into an SSRF pivot. Set mmHost via CLI/config file only.
        const toPort = (v) => { const n = Number(v); return (Number.isInteger(n) && n > 0 && n < 65536) ? n : null; };
        if (patch.mmPort !== undefined) { const p = toPort(patch.mmPort); if (p) config.mmPort = p; }
        if (patch.servePort !== undefined) { const p = toPort(patch.servePort); if (p && p !== config.servePort) { config.servePort = p; restartNeeded = true; } }
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

// Real LAN IPs first; virtual adapters (WSL/Hyper-V/Docker/VPN) and link-local last —
// so the QR code, mamamonkey.local, and the MM-host fallback pick a phone-reachable address.
export function rankIp(name, ip) {
  if (/^169\.254\./.test(ip)) return 90;                                   // link-local (unusable)
  let s = 0;
  if (/(vethernet|wsl|hyper-v|virtual|vmware|virtualbox|vbox|docker|tailscale|zerotier|utun|tun|tap)/i.test(name)) s += 40;
  if (/^192\.168\./.test(ip)) s += 0;
  else if (/^10\./.test(ip)) s += 1;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) s += 5;                  // private but often virtual (WSL/Docker default)
  else s += 3;
  return s;
}
export function lanUrls(port) {
  const found = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal && !/^169\.254\./.test(ni.address)) {
        found.push({ ip: ni.address, score: rankIp(name, ni.address) });
      }
    }
  }
  found.sort((a, b) => a.score - b.score);
  return found.map((f) => `http://${f.ip}:${port}`);
}

// Ping a candidate MediaMonkey media-server host:port with our addon protocol.
// Resolves true only if OUR addon answers (so we know it's MM-with-MamaMonkey).
export function mmPing(host, port) {
  return new Promise((resolve) => {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const to = ctrl ? setTimeout(() => ctrl.abort(), 2500) : null;
    fetch(`http://${host}:${port}/`, {
      method: 'POST',
      headers: { 'MMCustomRequest': 'true', 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'mamamonkey', command: 'ping' }),
      signal: ctrl ? ctrl.signal : undefined,
    }).then((r) => r.text()).then((t) => {
      if (to) clearTimeout(to);
      let ok = false; try { ok = !!JSON.parse(t).result.pong; } catch (_) {}
      resolve(ok);
    }).catch(() => { if (to) clearTimeout(to); resolve(false); });
  });
}

// SSDP/UPnP discovery: MediaMonkey's media server is a DLNA MediaServer that announces itself.
// Returns candidate {host,port} parsed from the LOCATION URLs of MediaServer responses.
export function ssdpDiscover(timeoutMs) {
  return new Promise((resolve) => {
    const cands = [], seen = new Set();
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (_) { resolve(cands); return; }
    const done = () => { try { sock.close(); } catch (_) {} resolve(cands); };
    sock.on('error', done);
    sock.on('message', (m) => {
      const loc = (String(m).match(/LOCATION:\s*(\S+)/i) || [])[1];
      const mm = loc && loc.match(/^http:\/\/([0-9.]+):(\d+)\//i);
      if (mm) { const key = mm[1] + ':' + mm[2]; if (!seen.has(key)) { seen.add(key); cands.push({ host: mm[1], port: Number(mm[2]) }); } }
    });
    try {
      sock.bind(() => {
        const msg = Buffer.from(['M-SEARCH * HTTP/1.1', 'HOST:239.255.255.250:1900', 'MAN:"ssdp:discover"', 'MX:2', 'ST:urn:schemas-upnp-org:device:MediaServer:1', '', ''].join('\r\n'));
        try { sock.send(msg, 1900, '239.255.255.250'); } catch (_) {}
      });
    } catch (_) { resolve(cands); return; }
    setTimeout(done, timeoutMs || 2500);
  });
}

// Make sure the companion can reach MM: ping the configured host/port (+ LAN IPs); if none
// answer, auto-discover MM via UPnP and persist the found host:port. Fallback-only — if the
// configured port already works (e.g. the default 127.0.0.1 setup), discovery never runs.
export async function ensureMmReachable(config, persist, deps) {
  const ping = (deps && deps.ping) || mmPing;
  const discover = (deps && deps.discover) || ssdpDiscover;
  const lan = (deps && deps.lan) || (() => lanUrls(0).map((u) => u.slice('http://'.length).replace(/:0$/, '')));
  const hosts = [config.mmHost || '127.0.0.1'];
  try { lan().forEach((ip) => { if (ip && hosts.indexOf(ip) < 0) hosts.push(ip); }); } catch (_) {}
  for (const h of hosts) {
    if (await ping(h, config.mmPort)) { console.log(`MediaMonkey reachable at ${h}:${config.mmPort}`); return { host: h, port: config.mmPort }; }
  }
  console.log(`MediaMonkey not answering on port ${config.mmPort} — discovering via UPnP…`);
  let cands = []; try { cands = await discover(2500); } catch (_) {}
  for (const c of cands) {
    if (await ping(c.host, c.port)) {
      config.mmHost = c.host; config.mmPort = c.port;
      try { if (persist) persist({ mmHost: config.mmHost, mmPort: config.mmPort, servePort: config.servePort, autoStart: config.autoStart }); } catch (_) {}
      console.log(`MediaMonkey discovered at ${c.host}:${c.port} (saved)`);
      return { host: c.host, port: c.port, discovered: true };
    }
  }
  console.log(`MediaMonkey not found via UPnP; keeping ${config.mmHost}:${config.mmPort}`);
  return null;
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
      mdns.on('error', function (e) { try { console.log('mDNS error:', e && e.message); } catch (_) {} });
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

    // --- Ensure MM is reachable (auto-discover host/port via UPnP if the configured one fails) ---
    try { await ensureMmReachable(config, saveConfig); } catch (_) {}

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

    // Sanity-check the download before we ever execute it: plausible size + Windows PE magic "MZ".
    // (Transport is HTTPS from GitHub. For public distribution, also verify a published SHA-256.)
    if (buf.length < 40_000_000) {
      console.log(`auto-update skipped: downloaded file too small (${buf.length} bytes)`);
      return;
    }
    if (buf.length < 2 || buf[0] !== 0x4d || buf[1] !== 0x5a) {
      console.log('auto-update skipped: download is not a Windows .exe (bad magic)');
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
      // Unblock (strip Mark-of-the-Web) AND relaunch via Start-Process (more reliable than `start`).
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath '%~dp0${exeName}'; Start-Process -FilePath '%~dp0${exeName}' -WorkingDirectory '%~dp0'" >nul 2>&1`,
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
