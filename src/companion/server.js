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

// Entry point: true when run as `node server.js` AND in a `bun build --compile` exe,
// false when imported by unit tests. (process.argv[1] is the exe path in a compiled
// binary, so a filename check would wrongly disable the server there.)
if (import.meta.main) {
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
