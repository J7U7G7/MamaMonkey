import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateInfoJson } from '../scripts/lib/package-addon.mjs';

const info = JSON.parse(readFileSync(new URL('../src/addon/info.json', import.meta.url)));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

test('info.json is a valid addon manifest', () => {
  assert.doesNotThrow(() => validateInfoJson(info));
});

test('info.json version matches package.json version', () => {
  assert.equal(info.version, pkg.version);
});

test('updateURL points at this repo raw manifest', () => {
  assert.equal(info.updateURL, 'https://raw.githubusercontent.com/J7U7G7/MamaMonkey/main/update.json');
});
