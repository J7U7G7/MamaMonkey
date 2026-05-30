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
