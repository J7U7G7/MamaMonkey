import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const info = JSON.parse(readFileSync(new URL('../src/addon/info.json', import.meta.url)));

// init.js boots immediately on load (top-level, like MM's remoteControl sample),
// so we inject MM.bindings before loading init.js and read what boot() captured.
function loadAll() {
  const captured = { handler: null, toasts: [] };
  const fakePlayer = {
    isPlaying: true, paused: false, volume: 0.4,
    trackPositionMS: 5000, trackLengthMS: 200000,
    getCurrentTrack: () => ({ title: 'T', artist: 'Benoit & Sergio', album: 'Alb', summary: 'A - T' }),
    playAsync: () => Promise.resolve('p'),
  };
  const sandbox = { console };
  vm.createContext(sandbox);
  const files = ['lib/log-buffer.js', 'lib/commands.js', 'logger.js', 'init.js'];
  for (const f of files) {
    if (f === 'init.js') {
      sandbox.MamaMonkey.bindings = {
        getApp: () => ({ player: fakePlayer }),
        registerRemoteRequest: (h) => { captured.handler = h; return { ok: true }; },
        showToast: (m) => { captured.toasts.push(m); return true; },
        showDialog: () => true,
      };
    }
    const code = readFileSync(fileURLToPath(new URL(`../src/addon/${f}`, import.meta.url)), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return { ns: sandbox.MamaMonkey, captured };
}

test('VERSION matches info.json', () => {
  const { ns } = loadAll();
  assert.equal(ns.VERSION, info.version);
});

test('boot runs on load: registers a handler and toasts', () => {
  const { captured } = loadAll();
  assert.equal(typeof captured.handler, 'function');
  assert.ok(captured.toasts.some((m) => /MamaMonkey/.test(m)));
});

test('registered handler answers a ping', async () => {
  const { captured } = loadAll();
  const out = await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'ping' }));
  assert.equal(out.handled, true);
  assert.equal(out.response.ok, true);
  assert.equal(out.response.result.pong, true);
});

test('status command reports player state', async () => {
  const { captured } = loadAll();
  const out = await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'status' }));
  assert.equal(out.response.result.available, true);
  assert.equal(out.response.result.volume, 0.4);
  assert.equal(out.response.result.track.title, 'T');
  assert.equal(out.response.result.track.artist, 'Benoit & Sergio');
  assert.equal(out.response.result.durationMs, 200000);
});
