import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function loadLogger() {
  const sandbox = { console };
  vm.createContext(sandbox);
  for (const f of ['lib/log-buffer.js', 'logger.js']) {
    const code = readFileSync(fileURLToPath(new URL(`../src/addon/${f}`, import.meta.url)), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return sandbox.MamaMonkey;
}

test('log accumulates formatted lines retrievable via getText', () => {
  const ns = loadLogger();
  const log = ns.createLogger({ maxBytes: 10000 });
  log.log('info', 'booted', { v: '0.1.1' });
  const text = log.getText();
  assert.match(text, /info/);
  assert.match(text, /booted/);
  assert.match(text, /0\.1\.1/);
});

test('clear empties the log', () => {
  const ns = loadLogger();
  const log = ns.createLogger({ maxBytes: 10000 });
  log.log('info', 'x');
  log.clear();
  assert.equal(log.getText(), '');
});
