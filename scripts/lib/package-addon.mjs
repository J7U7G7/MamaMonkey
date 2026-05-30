import AdmZip from 'adm-zip';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED = ['id', 'title', 'description', 'version', 'type', 'author', 'updateURL'];
const SEMVER = /^\d+\.\d+\.\d+$/;

// MediaMonkey only auto-loads `init.js` (at startup) and `*_add.js` (appended to
// built-in scripts). It does NOT load arbitrary helper files. So we concatenate all
// runtime modules into a single init.js, in dependency order. Each module is a
// self-contained IIFE attaching to globalThis.MamaMonkey, so concatenation is safe.
const RUNTIME_MODULES = [
  'lib/log-buffer.js',
  'lib/commands.js',
  'mm-bindings.js',
  'logger.js',
  'init.js', // must be last — it consumes the others
];

export function addonFileName(version) {
  return `mamamonkey-${version}.mmip`;
}

export function validateInfoJson(info) {
  const missing = REQUIRED.filter((k) => !info || !info[k]);
  if (missing.length) {
    throw new Error(`info.json missing required field(s): ${missing.join(', ')}`);
  }
  if (!SEMVER.test(info.version)) {
    throw new Error(`info.json version must be X.Y.Z, got: ${info.version}`);
  }
}

// Concatenate the runtime modules into one init.js string.
export function bundleInitJs(srcDir) {
  return RUNTIME_MODULES.map((rel) => {
    const code = readFileSync(join(srcDir, rel), 'utf8');
    return `/* ===== ${rel} ===== */\n${code}`;
  }).join('\n;\n');
}

// Build the .mmip with exactly the files MM loads: info.json, the bundled init.js,
// and actions_add.js — all at the archive root.
export function packageAddon({ srcDir, outFile }) {
  const zip = new AdmZip();
  zip.addFile('info.json', Buffer.from(readFileSync(join(srcDir, 'info.json'))));
  zip.addFile('init.js', Buffer.from(bundleInitJs(srcDir), 'utf8'));
  zip.addFile('actions_add.js', Buffer.from(readFileSync(join(srcDir, 'actions_add.js'))));
  zip.writeZip(outFile);
}
