import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAssetsMap } from '../scripts/bundle-web.mjs';

test('maps files to {contentType, base64} keyed by url path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-'));
  writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
  writeFileSync(join(dir, 'app.js'), 'console.log(1)');
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'a.css'), 'body{}');

  const map = buildAssetsMap(dir);

  assert.equal(map['/index.html'].contentType, 'text/html; charset=utf-8');
  assert.equal(map['/app.js'].contentType, 'text/javascript; charset=utf-8');
  assert.equal(map['/sub/a.css'].contentType, 'text/css; charset=utf-8');
  assert.equal(Buffer.from(map['/index.html'].base64, 'base64').toString(), '<h1>hi</h1>');
  rmSync(dir, { recursive: true, force: true });
});
