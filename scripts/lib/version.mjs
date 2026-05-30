const SEMVER = /^\d+\.\d+\.\d+$/;

export function parseTag(tag) {
  if (typeof tag !== 'string' || tag[0] !== 'v') {
    throw new Error(`Tag must look like vX.Y.Z, got: ${tag}`);
  }
  const v = tag.slice(1);
  if (!SEMVER.test(v)) {
    throw new Error(`Tag must look like vX.Y.Z, got: ${tag}`);
  }
  return v;
}

export function assertVersionsMatch(infoVersion, tagVersion) {
  if (infoVersion !== tagVersion) {
    throw new Error(
      `Version mismatch: info.json has ${infoVersion} but tag is v${tagVersion}. ` +
        `Update src/addon/info.json before tagging.`
    );
  }
}
