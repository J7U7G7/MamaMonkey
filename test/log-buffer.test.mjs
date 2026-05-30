import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAddonScript } from './helpers/load-addon-script.mjs';

const { createLogBuffer } = loadAddonScript('lib/log-buffer.js');

test('appends lines and returns them as text', () => {
  const buf = createLogBuffer({ maxBytes: 1000 });
  buf.append('first');
  buf.append('second');
  assert.equal(buf.text(), 'first\nsecond');
});

test('trims oldest lines when over maxBytes', () => {
  const buf = createLogBuffer({ maxBytes: 12 }); // tiny cap
  buf.append('aaaa'); // 4
  buf.append('bbbb'); // "aaaa\nbbbb" = 9
  buf.append('cccc'); // would be 14 -> drop "aaaa"
  assert.equal(buf.text(), 'bbbb\ncccc');
  assert.ok(buf.bytes() <= 12);
});

test('clear empties the buffer', () => {
  const buf = createLogBuffer({ maxBytes: 1000 });
  buf.append('x');
  buf.clear();
  assert.equal(buf.text(), '');
  assert.equal(buf.bytes(), 0);
});

test('a single line longer than maxBytes is kept (never produces empty on append)', () => {
  const buf = createLogBuffer({ maxBytes: 4 });
  buf.append('toolongline');
  assert.equal(buf.text(), 'toolongline');
});
