import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, banner } from '../src/companion/server.js';

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
