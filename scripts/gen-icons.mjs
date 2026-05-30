import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'src', 'web', 'icon.svg'));
const outDir = join(root, 'src', 'web', 'icons');
mkdirSync(outDir, { recursive: true });
const sizes = [180, 192, 512];
for (const s of sizes) {
  await sharp(svg, { density: 384 }).resize(s, s).png().toFile(join(outDir, `icon-${s}.png`));
  console.log('wrote icon-' + s + '.png');
}
