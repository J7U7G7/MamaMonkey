import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeManifest } from '../scripts/write-update-manifest.mjs';

test('computeManifest derives fields from info.json + download url', () => {
  const info = { id: 'mamamonkey', version: '0.2.0', minAppVersion: '5.0.0' };
  const m = computeManifest(info, 'https://example.com/mamamonkey-0.2.0.mmip');
  assert.equal(m.id, 'mamamonkey');
  assert.equal(m.version, '0.2.0');
  assert.equal(m.minAppVersion, '5.0.0');
  assert.equal(m.downloadURL, 'https://example.com/mamamonkey-0.2.0.mmip');
});
