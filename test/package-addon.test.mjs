import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { addonFileName, validateInfoJson, createMmip } from '../scripts/lib/package-addon.mjs';

test('addonFileName uses the version', () => {
  assert.equal(addonFileName('0.1.0'), 'mamamonkey-0.1.0.mmip');
});

test('validateInfoJson accepts a complete manifest', () => {
  assert.doesNotThrow(() =>
    validateInfoJson({
      id: 'mamamonkey', title: 'MamaMonkey', description: 'd',
      version: '0.1.0', type: 'general', author: 'a', updateURL: 'http://x',
    })
  );
});

test('validateInfoJson rejects missing fields and bad version', () => {
  assert.throws(() => validateInfoJson({ id: 'x' }), /missing/i);
  assert.throws(() =>
    validateInfoJson({ id: 'x', title: 't', description: 'd', version: '1.2', type: 'general', author: 'a', updateURL: 'u' }),
    /version/i
  );
});

test('createMmip zips folder CONTENTS at the archive root (info.json at root)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-'));
  const src = join(dir, 'addon');
  mkdirSync(src);
  writeFileSync(join(src, 'info.json'), '{"id":"x"}');
  mkdirSync(join(src, 'lib'));
  writeFileSync(join(src, 'lib', 'a.js'), '// a');
  const out = join(dir, 'out.mmip');

  createMmip({ srcDir: src, outFile: out });

  const names = new AdmZip(out).getEntries().map((e) => e.entryName);
  assert.ok(names.includes('info.json'), 'info.json must be at root, got: ' + names.join(','));
  assert.ok(names.some((n) => n === 'lib/a.js'), 'nested files preserved');
  rmSync(dir, { recursive: true, force: true });
});
