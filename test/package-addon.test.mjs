import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { addonFileName, validateInfoJson, bundleInitJs, packageAddon } from '../scripts/lib/package-addon.mjs';

function makeFakeAddon() {
  const dir = mkdtempSync(join(tmpdir(), 'mm-'));
  const src = join(dir, 'addon');
  mkdirSync(join(src, 'lib'), { recursive: true });
  writeFileSync(join(src, 'info.json'), '{"id":"x"}');
  writeFileSync(join(src, 'lib', 'log-buffer.js'), '/*LOGBUF*/');
  writeFileSync(join(src, 'lib', 'commands.js'), '/*COMMANDS*/');
  writeFileSync(join(src, 'mm-bindings.js'), '/*BINDINGS*/');
  writeFileSync(join(src, 'logger.js'), '/*LOGGER*/');
  writeFileSync(join(src, 'init.js'), '/*INIT*/');
  writeFileSync(join(src, 'actions_add.js'), '/*ACTIONS*/');
  return { dir, src };
}

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

test('bundleInitJs concatenates runtime modules with init.js LAST', () => {
  const { dir, src } = makeFakeAddon();
  const bundle = bundleInitJs(src);
  for (const marker of ['LOGBUF', 'COMMANDS', 'BINDINGS', 'LOGGER', 'INIT']) {
    assert.match(bundle, new RegExp(marker));
  }
  // init must come after its dependencies
  assert.ok(bundle.indexOf('INIT') > bundle.indexOf('LOGBUF'), 'init.js bundled last');
  assert.ok(bundle.indexOf('LOGGER') > bundle.indexOf('LOGBUF'), 'logger after log-buffer');
  rmSync(dir, { recursive: true, force: true });
});

test('packageAddon emits exactly info.json, bundled init.js, actions_add.js at root', () => {
  const { dir, src } = makeFakeAddon();
  const out = join(dir, 'out.mmip');
  packageAddon({ srcDir: src, outFile: out });

  const entries = new AdmZip(out).getEntries();
  const names = entries.map((e) => e.entryName).sort();
  assert.deepEqual(names, ['actions_add.js', 'info.json', 'init.js']);
  // the packaged init.js is the bundle (contains helper markers, not just /*INIT*/)
  const initEntry = entries.find((e) => e.entryName === 'init.js');
  const initText = initEntry.getData().toString('utf8');
  assert.match(initText, /LOGBUF/);
  assert.match(initText, /COMMANDS/);
  rmSync(dir, { recursive: true, force: true });
});
