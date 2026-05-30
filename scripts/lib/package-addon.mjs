import AdmZip from 'adm-zip';

const REQUIRED = ['id', 'title', 'description', 'version', 'type', 'author', 'updateURL'];
const SEMVER = /^\d+\.\d+\.\d+$/;

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

export function createMmip({ srcDir, outFile }) {
  const zip = new AdmZip();
  // addLocalFolder adds the folder's CONTENTS at the archive root (no wrapper dir),
  // which MediaMonkey requires (info.json must sit at the .mmip root).
  zip.addLocalFolder(srcDir);
  zip.writeZip(outFile);
}
