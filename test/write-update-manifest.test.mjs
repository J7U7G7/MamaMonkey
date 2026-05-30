import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeManifest } from '../scripts/write-update-manifest.mjs';

test('computeManifest derives the MM manifest from info.json + update url', () => {
  const info = { id: 'mamamonkey', version: '0.2.0', minAppVersion: '5.0.0' };
  const m = computeManifest(info, 'https://example.com/mamamonkey-0.2.0.mmip');
  assert.equal(m.version, '0.2.0');
  assert.equal(m.minAppVersion, '5.0.0');
  assert.equal(m.updateUrl, 'https://example.com/mamamonkey-0.2.0.mmip');
  // id is intentionally NOT emitted (MM doesn't read it in the JSON manifest)
  assert.equal('id' in m, false);
});
