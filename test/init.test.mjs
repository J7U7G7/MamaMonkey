import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const info = JSON.parse(readFileSync(new URL('../src/addon/info.json', import.meta.url)));

function loadAll(spy) {
  const sandbox = { console, window: {} };
  // capture whenReady callback
  sandbox.window.whenReady = (cb) => { spy.ready = cb; };
  vm.createContext(sandbox);
  const files = ['lib/log-buffer.js', 'lib/router.js', 'lib/pages.js', 'logger.js', 'http-controller.js', 'status-panel.js', 'init.js'];
  for (const f of files) {
    if (f === 'logger.js') {
      sandbox.MamaMonkey.bindings = {
        registerHttpHandler: () => ({ hooked: true }),
        appendLogFile: () => true, readLogFile: () => '',
        getSharingInfo: () => ({ host: 'h', port: 1 }),
        addStatusMenuItem: () => true,
      };
    }
    const code = readFileSync(fileURLToPath(new URL(`../src/addon/${f}`, import.meta.url)), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return sandbox;
}

test('init exposes VERSION matching info.json', () => {
  const spy = {};
  const sandbox = loadAll(spy);
  assert.equal(sandbox.MamaMonkey.VERSION, info.version);
});

test('init registers a whenReady boot that runs without throwing', () => {
  const spy = {};
  const sandbox = loadAll(spy);
  assert.equal(typeof spy.ready, 'function');
  assert.doesNotThrow(() => spy.ready());
});
