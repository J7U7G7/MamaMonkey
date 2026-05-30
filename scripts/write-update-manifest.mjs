import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildUpdateManifest } from './lib/manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function computeManifest(info, downloadURL) {
  return buildUpdateManifest({
    id: info.id,
    version: info.version,
    minAppVersion: info.minAppVersion,
    downloadURL,
  });
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// Only run as a CLI (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('write-update-manifest.mjs')) {
  const downloadURL = arg('--download-url');
  if (!downloadURL) {
    console.error('Usage: write-update-manifest.mjs --download-url <url>');
    process.exit(1);
  }
  const info = JSON.parse(readFileSync(join(root, 'src', 'addon', 'info.json'), 'utf8'));
  const manifest = computeManifest(info, downloadURL);
  writeFileSync(join(root, 'update.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Wrote update.json:', manifest);
}
