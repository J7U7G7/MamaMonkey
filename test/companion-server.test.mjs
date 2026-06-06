import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, banner, makeForward, rankIp } from '../src/companion/server.js';

test('rankIp prefers real 192.168 LAN over a virtual 172.x (WSL) adapter', () => {
  assert.ok(rankIp('Ethernet', '192.168.1.54') < rankIp('vEthernet (WSL)', '172.21.112.1'));
  assert.ok(rankIp('Wi-Fi', '192.168.1.54') < rankIp('Wi-Fi', '169.254.1.2'));
});

test('forward falls back to a LAN IP when the configured host refuses', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(url);
    if (url.indexOf('127.0.0.1') >= 0) throw new Error('connection refused');
    return { status: 200, text: async () => '{"ok":true}' };
  };
  try {
    const fwd = makeForward({ mmHost: '127.0.0.1', mmPort: 18391 }, () => ['192.168.1.54']);
    const out = await fwd({ target: 'mamamonkey', command: 'ping' });
    assert.equal(out.status, 200);
    assert.ok(seen.some((u) => u.indexOf('192.168.1.54:18391') >= 0), 'tried the LAN IP');
  } finally { globalThis.fetch = realFetch; }
});

test('banner includes the SuperMama message and the serve URL', () => {
  const b = banner({ servePort: 8088, mmHost: '127.0.0.1', mmPort: 18391 });
  assert.match(b, /SuperMama/);
  assert.match(b, /8088/);
  assert.match(b, /18391/);
});

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

test('POST /api/config updates mmPort but IGNORES mmHost (anti-SSRF) and persists', async () => {
  const config = makeConfig();
  let saved = null;
  const saveConfig = (data) => { saved = data; };
  const h = createHandler({ assets, forward: async () => ({}), config, saveConfig });
  const res = mockRes();
  await h(mockReq('POST', '/api/config', { mmHost: '10.0.0.2', mmPort: 20000 }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(config.mmHost, '127.0.0.1');   // mmHost is NOT network-settable
  assert.equal(config.mmPort, 20000);
  assert.deepEqual(saved, { mmHost: '127.0.0.1', mmPort: 20000, servePort: 8088, autoStart: false });
});

test('POST /api/config rejects an invalid port', async () => {
  const config = makeConfig();
  const h = createHandler({ assets, forward: async () => ({}), config, saveConfig: noop });
  const res = mockRes();
  await h(mockReq('POST', '/api/config', { mmPort: 'abc', servePort: 99999 }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(config.mmPort, 18391);   // unchanged (invalid)
  assert.equal(config.servePort, 8088); // unchanged (out of range)
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
  const req = { method: 'POST', url: '/api/config', _chunks: [Buffer.from('{bad json')],
    on(ev, cb) { if (ev === 'data') this._chunks.forEach(c => cb(c)); if (ev === 'end') cb(); return this; } };
  await h(req, res);
  assert.equal(res.statusCode, 400);
});
