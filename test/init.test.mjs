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
    shufflePlaylist: false, repeatPlaylist: false, repeatOne: false, playlistPos: 2,
    getCurrentTrack: () => ({ title: 'T', artist: 'Benoit & Sergio', album: 'Alb', summary: 'A - T' }),
    playAsync: () => Promise.resolve('p'),
    seekMSAsync: function(ms){ this._seek = ms; return Promise.resolve(); },
    setPlaylistPosAsync: function(i){ this._jumped = i; return Promise.resolve(); },
    getTracklist: function(){ return { count: 2, getValue: function(i){ return { title: 'T'+i, artist: 'A'+i }; } }; },
    addTracksAsync: function(l,p){ this._added={count:l&&l.count,params:p}; return Promise.resolve(); },
  };
  function tracklist(items) {
    return { count: items.length, whenLoaded: function(){ return Promise.resolve(this); }, locked: function(f){ f(); },
      getValue: function(i){ return items[i]; } };
  }
  const fakeDb = {
    getTracklist: function(){ return tracklist([{id:1,title:'T1',artist:'A1',album:'Al1'},{id:2,title:'T2',artist:'A2',album:'Al2'}]); },
  };
  const _pl = { id: 7, name: 'P', getTracklist: function(){ return tracklist([{id:1,title:'T1'}]); },
    addTracksAsync: function(){return Promise.resolve();}, commitAsync:function(){return Promise.resolve();},
    deleteAsync:function(){return Promise.resolve();}, removeTrackAsync:function(){return Promise.resolve();}, moveTrackAsync:function(){return Promise.resolve();} };
  const fakePlaylists = { root: { getChildren: function(){ return tracklist([{id:7,title:'P',childrenCount:0}]); }, newPlaylist: function(){ return _pl; } },
    getByIDAsync: function(){ return Promise.resolve(_pl); } };
  const sandbox = { console };
  vm.createContext(sandbox);
  const files = ['lib/log-buffer.js', 'lib/commands.js', 'logger.js', 'init.js'];
  for (const f of files) {
    if (f === 'init.js') {
      sandbox.MamaMonkey.bindings = {
        getApp: () => ({ player: fakePlayer, db: fakeDb, playlists: fakePlaylists }),
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

test('seek clamps to duration and calls seekMSAsync', async () => {
  const { captured } = loadAll();
  const out = await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'seek', args: { ms: 999999 } }));
  assert.equal(out.response.ok, true);
  assert.equal(out.response.result.ms, 200000); // clamped to trackLengthMS
});

test('setRepeat modes set the right booleans', async () => {
  const { captured } = loadAll();
  let out = await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'setRepeat', args: { mode: 'one' } }));
  assert.equal(out.response.result.repeatOne, true);
  assert.equal(out.response.result.repeatAll, false);
  out = await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'setRepeat', args: { mode: 'all' } }));
  assert.equal(out.response.result.repeatAll, true);
  assert.equal(out.response.result.repeatOne, false);
});

test('setShuffle toggles the flag', async () => {
  const { captured } = loadAll();
  const out = await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'setShuffle', args: { on: true } }));
  assert.equal(out.response.result.shuffle, true);
});

test('queue returns index + items from the tracklist', async () => {
  const { captured } = loadAll();
  const out = await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'queue' }));
  assert.equal(out.response.result.index, 2);
  assert.equal(out.response.result.count, 2);
  assert.equal(out.response.result.items[0].title, 'T0');
});

test('status includes shuffle/repeat/queueIndex/trackKey', async () => {
  const { captured } = loadAll();
  const out = await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'status' }));
  assert.equal(typeof out.response.result.shuffle, 'boolean');
  assert.equal(out.response.result.queueIndex, 2);
  assert.ok(out.response.result.trackKey.length > 0);
});

test('lib all returns paged tracks with a token', async () => {
  const { captured } = loadAll();
  const out = await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'lib', args: { view: 'all' } }));
  assert.equal(out.response.result.token, 'lib:all');
  assert.equal(out.response.result.items[0].title, 'T1');
});
test('play now adds tracks with withClear+startPlayback', async () => {
  const { captured } = loadAll();
  await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'lib', args: { view: 'all' } }));
  const out = await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'play', args: { token: 'lib:all', mode: 'now' } }));
  assert.equal(out.response.result.ok, true);
});
test('playlists lists children', async () => {
  const { captured } = loadAll();
  const out = await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'playlists' }));
  assert.equal(out.response.result.items[0].id, 7);
});
test('playlistCreate commits and returns id', async () => {
  const { captured } = loadAll();
  const out = await captured.handler(JSON.stringify({ target: 'mamamonkey', command: 'playlistCreate', args: { name: 'X' } }));
  assert.equal(out.response.result.ok, true);
  assert.equal(out.response.result.id, 7);
});
