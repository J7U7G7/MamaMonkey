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
