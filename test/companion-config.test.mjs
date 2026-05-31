import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, mergeConfig } from '../src/companion/config.js';

test('defaults', () => {
  const c = resolveConfig({ argv: [], env: {} });
  assert.deepEqual(c, { servePort: 8088, mmHost: '127.0.0.1', mmPort: 18391, autoStart: false });
});

test('env overrides', () => {
  const c = resolveConfig({ argv: [], env: { MM_SERVE_PORT: '9000', MM_HOST: '10.0.0.5', MM_PORT: '18391' } });
  assert.equal(c.servePort, 9000);
  assert.equal(c.mmHost, '10.0.0.5');
});

test('CLI flags beat env', () => {
  const c = resolveConfig({ argv: ['--serve-port', '7777', '--mm-port', '20000'], env: { MM_SERVE_PORT: '9000' } });
  assert.equal(c.servePort, 7777);
  assert.equal(c.mmPort, 20000);
});

test('invalid port falls back to default', () => {
  const c = resolveConfig({ argv: ['--serve-port', 'abc'], env: {} });
  assert.equal(c.servePort, 8088);
});

test('mergeConfig: file < env < CLI precedence', () => {
  const defaults = { servePort: 8088, mmHost: '127.0.0.1', mmPort: 18391, autoStart: false };
  const c = mergeConfig(
    defaults,
    { mmHost: '192.168.1.5', mmPort: 20000 }, // file
    {},                                         // env
    {}                                          // CLI
  );
  assert.equal(c.mmHost, '192.168.1.5');
  assert.equal(c.mmPort, 20000);
  assert.equal(c.servePort, 8088);
});

test('mergeConfig: CLI beats file', () => {
  const defaults = { servePort: 8088, mmHost: '127.0.0.1', mmPort: 18391, autoStart: false };
  const c = mergeConfig(
    defaults,
    { mmHost: '192.168.1.5' },
    {},
    { mmHost: '10.0.0.1' }
  );
  assert.equal(c.mmHost, '10.0.0.1');
});

test('mergeConfig: env beats file', () => {
  const defaults = { servePort: 8088, mmHost: '127.0.0.1', mmPort: 18391, autoStart: false };
  const c = mergeConfig(
    defaults,
    { mmHost: '192.168.1.5' },
    { mmHost: '172.16.0.1' },
    {}
  );
  assert.equal(c.mmHost, '172.16.0.1');
});
