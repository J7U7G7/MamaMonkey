import fs from 'node:fs';
import path from 'node:path';

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}
function toPort(v, dflt) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : dflt;
}

/** Returns the directory where the config file lives:
 *  next to the exe when compiled (process.execPath), else cwd. */
export function configDir() {
  // bun compiled exes have a real execPath; node's execPath is the node binary itself.
  // We detect "running as compiled exe" by checking if execPath is NOT the node/bun binary.
  const ep = process.execPath || '';
  const isCompiled = !ep.endsWith('node') && !ep.endsWith('bun') && !ep.includes('/bin/');
  return isCompiled ? path.dirname(ep) : process.cwd();
}

export function configFilePath(dir) {
  return path.join(dir ?? configDir(), 'mamamonkey-config.json');
}

/** Load config file — returns {} on missing/bad JSON (never throws). */
export function loadConfigFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

/** Persist config fields to file — never throws. */
export function saveConfigFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.log('config save failed:', e.message);
    return false;
  }
}

/**
 * Pure merge: defaults < file < env < CLI.
 * @param {object} defaults
 * @param {object} file     — from mamamonkey-config.json
 * @param {object} envVars  — already extracted from process.env (mmHost, mmPort, servePort)
 * @param {object} cliArgs  — already extracted from argv (mmHost, mmPort, servePort)
 */
export function mergeConfig(defaults, file, envVars, cliArgs) {
  const pick = (key, transform, fallback) => {
    if (cliArgs[key] !== undefined) return transform ? transform(cliArgs[key]) : cliArgs[key];
    if (envVars[key] !== undefined) return transform ? transform(envVars[key]) : envVars[key];
    if (file[key] !== undefined) return transform ? transform(file[key]) : file[key];
    return defaults[key] !== undefined ? defaults[key] : fallback;
  };
  return {
    servePort: pick('servePort', (v) => toPort(v, defaults.servePort), defaults.servePort),
    mmHost: pick('mmHost', null, defaults.mmHost),
    mmPort: pick('mmPort', (v) => toPort(v, defaults.mmPort), defaults.mmPort),
    autoStart: pick('autoStart', (v) => Boolean(v), defaults.autoStart ?? false),
  };
}

export function resolveConfig({ argv = [], env = {} } = {}, fileOverride = null) {
  const filePath = fileOverride ?? configFilePath();
  const fileData = loadConfigFile(filePath);

  const defaults = { servePort: 8088, mmHost: '127.0.0.1', mmPort: 18391, autoStart: false };

  const envVars = {
    servePort: env.MM_SERVE_PORT,
    mmHost: env.MM_HOST,
    mmPort: env.MM_PORT,
  };
  const cliArgs = {
    servePort: flag(argv, '--serve-port'),
    mmHost: flag(argv, '--mm-host'),
    mmPort: flag(argv, '--mm-port'),
  };

  return mergeConfig(defaults, fileData, envVars, cliArgs);
}
