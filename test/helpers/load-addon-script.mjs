import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Loads a classic addon script (one that attaches to globalThis.MamaMonkey)
// into a fresh sandbox and returns that namespace object. This evaluates the
// EXACT file MediaMonkey loads, so tests exercise real source.
export function loadAddonScript(relPathFromAddon) {
  const url = new URL(`../../src/addon/${relPathFromAddon}`, import.meta.url);
  const code = readFileSync(fileURLToPath(url), 'utf8');
  // Expose a host-realm JSON.parse so that objects returned from VM code
  // have the correct Object.prototype (required for assert.deepEqual in Node v26).
  const sandbox = { console, _hostJSONParse: JSON.parse.bind(JSON) };
  vm.createContext(sandbox); // sandbox becomes the context's globalThis
  vm.runInContext(code, sandbox, { filename: relPathFromAddon });
  return sandbox.MamaMonkey;
}
