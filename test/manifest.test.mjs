import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpdateManifest } from '../scripts/lib/manifest.mjs';

test('builds the exact manifest MM reads (version, minAppVersion, updateUrl)', () => {
  const m = buildUpdateManifest({
    version: '0.1.0',
    minAppVersion: '5.0.0',
    updateUrl: 'https://example.com/x.mmip',
  });
  assert.deepEqual(m, {
    version: '0.1.0',
    minAppVersion: '5.0.0',
    updateUrl: 'https://example.com/x.mmip',
  });
});

test('throws if version is not X.Y.Z', () => {
  assert.throws(() =>
    buildUpdateManifest({ version: '1.2', minAppVersion: '5.0.0', updateUrl: 'u' })
  );
});

test('throws if updateUrl is missing', () => {
  assert.throws(() =>
    buildUpdateManifest({ version: '1.2.3', minAppVersion: '5.0.0', updateUrl: '' })
  );
});
