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
