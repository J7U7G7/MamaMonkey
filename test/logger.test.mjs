import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function loadLogger(fakeBindings) {
  const sandbox = { console };
  vm.createContext(sandbox);
  for (const f of ['lib/log-buffer.js', 'logger.js']) {
    const code = readFileSync(fileURLToPath(new URL(`../src/addon/${f}`, import.meta.url)), 'utf8');
    if (f === 'logger.js') {
      // inject fake bindings before logger.js runs
      sandbox.MamaMonkey.bindings = fakeBindings;
    }
    vm.runInContext(code, sandbox, { filename: f });
  }
  return sandbox.MamaMonkey;
}

test('log accumulates formatted lines retrievable via getText', () => {
  const ns = loadLogger({ appendLogFile: () => true, readLogFile: () => '' });
  const log = ns.createLogger({ maxBytes: 10000 });
  log.log('info', 'booted', { v: '0.1.0' });
  const text = log.getText();
  assert.match(text, /info/);
  assert.match(text, /booted/);
  assert.match(text, /0\.1\.0/);
});

test('logging survives a throwing file binding (in-memory still works)', () => {
  const ns = loadLogger({ appendLogFile: () => { throw new Error('disk fail'); }, readLogFile: () => '' });
  const log = ns.createLogger({ maxBytes: 10000 });
  assert.doesNotThrow(() => log.log('error', 'still ok'));
  assert.match(log.getText(), /still ok/);
});
