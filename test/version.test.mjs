import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTag, assertVersionsMatch } from '../scripts/lib/version.mjs';

test('parseTag strips the leading v', () => {
  assert.equal(parseTag('v0.1.0'), '0.1.0');
  assert.equal(parseTag('v12.3.45'), '12.3.45');
});

test('parseTag rejects malformed tags', () => {
  assert.throws(() => parseTag('0.1.0'));
  assert.throws(() => parseTag('v1.2'));
  assert.throws(() => parseTag('vfoo'));
});

test('assertVersionsMatch passes when equal, throws when not', () => {
  assert.doesNotThrow(() => assertVersionsMatch('0.1.0', '0.1.0'));
  assert.throws(() => assertVersionsMatch('0.1.0', '0.2.0'), /mismatch/i);
});
