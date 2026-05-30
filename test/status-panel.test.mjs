import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function load(calls) {
  const sandbox = { console };
  vm.createContext(sandbox);
  sandbox.MamaMonkey = {
    bindings: { addStatusMenuItem: (opts) => { calls.push(opts); return true; }, getSharingInfo: () => ({ host: 'h', port: 1 }) },
    logger: { log() {}, getText: () => '' },
  };
  const code = readFileSync(fileURLToPath(new URL('../src/addon/status-panel.js', import.meta.url)), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'status-panel.js' });
  return sandbox.MamaMonkey;
}

test('mountStatusPanel registers a menu item with a label', () => {
  const calls = [];
  const ns = load(calls);
  ns.mountStatusPanel({ name: 'MamaMonkey', version: '0.1.0' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].label, /MamaMonkey/);
  assert.equal(typeof calls[0].onClick, 'function');
});
