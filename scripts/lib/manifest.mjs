const SEMVER = /^\d+\.\d+\.\d+$/;

// Builds the JSON update manifest MediaMonkey fetches from info.json's updateURL.
// MM reads exactly these keys (per the MM wiki "Getting Started (Addons)"):
//   version       — "X.Y.Z"
//   minAppVersion — recommended
//   updateUrl     — camelCase, lowercase "url"; the .mmip download link.
// NOTE the casing asymmetry: info.json uses `updateURL`, the manifest uses `updateUrl`.
// Extra keys are ignored by MM, so we emit only what it reads.
export function buildUpdateManifest({ version, minAppVersion, updateUrl }) {
  if (!SEMVER.test(String(version))) {
    throw new Error(`Manifest version must be X.Y.Z, got: ${version}`);
  }
  if (!updateUrl) {
    throw new Error('Manifest updateUrl is required');
  }
  return { version, minAppVersion, updateUrl };
}
