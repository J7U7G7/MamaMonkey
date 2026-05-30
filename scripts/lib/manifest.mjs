const SEMVER = /^\d+\.\d+\.\d+$/;

export function buildUpdateManifest({ id, version, minAppVersion, downloadURL }) {
  if (!SEMVER.test(String(version))) {
    throw new Error(`Manifest version must be X.Y.Z, got: ${version}`);
  }
  if (!downloadURL) {
    throw new Error('Manifest downloadURL is required');
  }
  return { id, version, minAppVersion, downloadURL };
}
