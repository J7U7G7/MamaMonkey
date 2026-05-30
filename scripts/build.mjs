import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { addonFileName, validateInfoJson, createMmip } from './lib/package-addon.mjs';
import { parseTag, assertVersionsMatch } from './lib/version.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const addonDir = join(root, 'src', 'addon');
const distDir = join(root, 'dist');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const info = JSON.parse(readFileSync(join(addonDir, 'info.json'), 'utf8'));
validateInfoJson(info);

const tag = arg('--tag');
if (tag) {
  assertVersionsMatch(info.version, parseTag(tag));
}

if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
const outFile = join(distDir, addonFileName(info.version));
createMmip({ srcDir: addonDir, outFile });

console.log(`Built ${outFile} (version ${info.version})`);
