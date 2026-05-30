import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpdateManifest } from '../scripts/lib/manifest.mjs';

test('builds a manifest object from the inputs', () => {
  const m = buildUpdateManifest({
    id: 'mamamonkey',
    version: '0.1.0',
    minAppVersion: '5.0.0',
    downloadURL: 'https://example.com/x.mmip',
  });
  assert.deepEqual(m, {
    id: 'mamamonkey',
    version: '0.1.0',
    minAppVersion: '5.0.0',
    downloadURL: 'https://example.com/x.mmip',
  });
});

test('throws if version is not X.Y.Z', () => {
  assert.throws(() =>
    buildUpdateManifest({ id: 'x', version: '1.2', minAppVersion: '5.0.0', downloadURL: 'u' })
  );
});

test('throws if downloadURL is missing', () => {
  assert.throws(() =>
    buildUpdateManifest({ id: 'x', version: '1.2.3', minAppVersion: '5.0.0', downloadURL: '' })
  );
});
