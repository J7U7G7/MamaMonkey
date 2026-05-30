# MamaMonkey Phase 2 — Playback Depth Implementation Plan

> Executor: TDD where tests exist; commit per task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Node at `/opt/homebrew/bin`. Do NOT push/tag. Spec: `docs/superpowers/specs/2026-05-30-phase2-playback-depth-design.md`. Companion is UNCHANGED this phase.

**Goal:** Addon v0.3.0 gains seek / shuffle / repeat / album-art / queue commands + status fields; the PWA gains album art, a seekable bar, shuffle/repeat buttons, and a queue panel.

---

## Task A: Addon v0.3.0 — new commands, status fields, helpers (TDD on the deterministic ones)

**Files:** Modify `src/addon/init.js`, `src/addon/info.json` + `package.json` (→ 0.3.0), `test/init.test.mjs`

- [ ] **Step 1:** In `src/addon/init.js`, **inside the IIFE but above `buildHandlers`**, add two helpers:

```js
  function trackKeyOf(t) {
    if (!t) return '';
    return t.summary || ((t.artist || '') + ' - ' + (t.title || ''));
  }

  // Read a file:/// thumbnail into a data: URL (browser env inside MM).
  function readFileAsDataUrl(fileUrl) {
    return fetch(fileUrl)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          var fr = new FileReader();
          fr.onload = function () { resolve(fr.result); };
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
      });
  }
```

- [ ] **Step 2:** Replace the `status` handler in `buildHandlers()` so it computes the track once and adds the new fields:

```js
      status: function () {
        var p = a && a.player;
        if (!p) return { available: false };
        var t = null;
        try { t = p.getCurrentTrack && p.getCurrentTrack(); } catch (e) {}
        var track = t ? { title: t.title, artist: t.artist, album: t.album, summary: t.summary } : null;
        return {
          available: true,
          isPlaying: !!p.isPlaying,
          paused: !!p.paused,
          volume: (typeof p.volume === 'number') ? p.volume : null,
          positionMs: (typeof p.trackPositionMS === 'number') ? p.trackPositionMS : null,
          durationMs: (typeof p.trackLengthMS === 'number') ? p.trackLengthMS : null,
          shuffle: !!p.shufflePlaylist,
          repeatAll: !!p.repeatPlaylist,
          repeatOne: !!p.repeatOne,
          queueIndex: (typeof p.playlistPos === 'number') ? p.playlistPos : -1,
          trackKey: trackKeyOf(t),
          track: track,
        };
      },
```

- [ ] **Step 3:** Add these handlers to the object returned by `buildHandlers()` (after `setVolume`):

```js
      seek: function (args) {
        var ms = Math.max(0, Number(args && args.ms) || 0);
        var len = a.player.trackLengthMS;
        if (typeof len === 'number' && len > 0) ms = Math.min(ms, len);
        return a.player.seekMSAsync(ms).then(function () { return { ms: ms }; });
      },
      setShuffle: function (args) {
        a.player.shufflePlaylist = !!(args && args.on);
        return { shuffle: !!a.player.shufflePlaylist };
      },
      setRepeat: function (args) {
        var mode = (args && args.mode) || 'off';
        a.player.repeatPlaylist = (mode === 'all');
        a.player.repeatOne = (mode === 'one');
        return { repeatAll: !!a.player.repeatPlaylist, repeatOne: !!a.player.repeatOne };
      },
      queue: function (args) {
        var limit = Math.max(1, Math.min(500, Number(args && args.limit) || 200));
        var tl = a.player.getTracklist();
        return Promise.resolve(tl && tl.whenLoaded ? tl.whenLoaded() : tl).then(function (loaded) {
          var list = loaded || tl;
          var items = [];
          var total = 0;
          function collect() {
            total = (list && list.count) || 0;
            var max = Math.min(total, limit);
            for (var i = 0; i < max; i++) {
              var t = list.getValue(i);
              items.push({ title: t && t.title, artist: t && t.artist });
            }
          }
          if (list && list.locked) list.locked(collect); else collect();
          return {
            index: (typeof a.player.playlistPos === 'number') ? a.player.playlistPos : -1,
            count: total,
            items: items,
            truncated: total > items.length,
          };
        });
      },
      jump: function (args) {
        var i = Math.max(0, Number(args && args.index) || 0);
        return a.player.setPlaylistPosAsync(i)
          .then(function () { return a.player.playAsync(); })
          .then(function () { return { index: i }; });
      },
      getArt: function () {
        var t = null;
        try { t = a.player.getCurrentTrack && a.player.getCurrentTrack(); } catch (e) {}
        var key = trackKeyOf(t);
        if (!t || !t.coverList) return { available: false, key: key };
        var cl = t.coverList;
        return Promise.resolve(cl.whenLoaded ? cl.whenLoaded() : cl).then(function (loaded) {
          var list = loaded || cl;
          if (!list || !list.count) return { available: false, key: key };
          return new Promise(function (resolve) {
            try {
              list.getValue(0).getThumbAsync(300, 300, function (link) {
                if (!link || link === '-') { resolve({ available: false, key: key }); return; }
                readFileAsDataUrl(link).then(function (dataUrl) {
                  resolve({ available: true, key: key, dataUrl: dataUrl });
                }).catch(function () { resolve({ available: false, key: key, link: link }); });
              });
            } catch (e) { resolve({ available: false, key: key, error: String(e) }); }
          });
        });
      },
```

- [ ] **Step 4:** Bump `MM.VERSION` in `init.js` to `'0.3.0'`; `version` to `0.3.0` in `src/addon/info.json` and `package.json`.

- [ ] **Step 5:** Extend `test/init.test.mjs`:
  - In `fakePlayer` add: `shufflePlaylist: false, repeatPlaylist: false, repeatOne: false, playlistPos: 2, trackLengthMS: 200000,` and methods `seekMSAsync: function(ms){ this._seek = ms; return Promise.resolve(); }, setPlaylistPosAsync: function(i){ this._jumped = i; return Promise.resolve(); }, getTracklist: function(){ return { count: 2, getValue: function(i){ return { title: 'T'+i, artist: 'A'+i }; } }; },` (keep existing `playAsync`, `getCurrentTrack`, `volume`, `isPlaying`, `paused`).
  - Add tests:

```js
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
```

- [ ] **Step 6:** `node --test test/init.test.mjs` → all pass; `npm test` → green; `npm run build` → `dist/mamamonkey-0.3.0.mmip`. **Step 7:** Commit: `feat(addon): seek/shuffle/repeat/queue/art commands + status fields (v0.3.0)`

---

## Task B: PWA — art, seek, shuffle/repeat, queue

**Files:** Modify `src/web/index.html`, `src/web/style.css`, `src/web/app.js`

- [ ] **Step 1:** `src/web/index.html` — replace the `<div id="art">…</div>` line with an image, add shuffle/repeat row + a queue panel. Replace the body `<main>` content from `#art` through the `volume` div with:

```html
    <img id="art" class="art" alt="" hidden>
    <div id="artph" class="art">♪</div>
    <div id="title" class="title">—</div>
    <div id="artist" class="artist">—</div>
    <div id="album" class="album">—</div>
    <div class="progress" id="progress"><div id="bar" class="bar"></div></div>
    <div class="times"><span id="pos">0:00</span><span id="dur">0:00</span></div>
    <div class="transport">
      <button id="prev" aria-label="Previous">⏮</button>
      <button id="playpause" aria-label="Play/Pause">⏯</button>
      <button id="next" aria-label="Next">⏭</button>
    </div>
    <div class="modes">
      <button id="shuffle" class="mode" aria-label="Shuffle">🔀</button>
      <button id="repeat" class="mode" aria-label="Repeat">🔁</button>
      <button id="queueBtn" class="mode" aria-label="Queue">☰</button>
    </div>
    <div class="volume">🔊 <input id="vol" type="range" min="0" max="1" step="0.01" value="0.5"></div>
    <div id="status" class="status">connecting…</div>
    <div id="queuePanel" class="queue" hidden></div>
```

- [ ] **Step 2:** `src/web/style.css` — append:

```css
img.art { object-fit: cover; }
.modes { display: flex; justify-content: center; gap: 16px; margin: 4px 0 14px; }
.mode { width: 48px; height: 48px; border-radius: 50%; border: none; background: #2c2c2e; color: #aaa; font-size: 18px; cursor: pointer; }
.mode.on { background: #9af; color: #111; }
.queue { text-align: left; margin-top: 16px; border-top: 1px solid #2c2c2e; }
.qrow { padding: 12px 8px; border-bottom: 1px solid #1c1c1e; cursor: pointer; display: flex; gap: 10px; }
.qrow.cur { color: #9af; }
.qrow .qi { color: #555; min-width: 24px; }
.qrow .qt { font-size: 15px; }
.qrow .qa { font-size: 13px; color: #888; }
```

- [ ] **Step 3:** Replace `src/web/app.js` entirely with:

```js
(function () {
  'use strict';
  var POLL_MS = 1000;
  var $ = function (id) { return document.getElementById(id); };
  var dragging = false;
  var artKey = null;      // trackKey whose art is currently shown
  var repeatMode = 'off'; // off | all | one
  var queueOpen = false;
  var lastQueueKey = null;

  function fmt(ms) {
    if (!ms || ms < 0) return '0:00';
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    s = s % 60; return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function cmd(command, args) {
    return fetch('/api/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'mamamonkey', command: command, args: args || {} }),
    }).then(function (r) { return r.json(); });
  }

  function setArt(dataUrl) {
    var img = $('art'), ph = $('artph');
    if (dataUrl) { img.src = dataUrl; img.hidden = false; ph.hidden = true; }
    else { img.hidden = true; ph.hidden = false; }
  }
  function refreshArt(key) {
    cmd('getArt').then(function (st) {
      if (st && st.ok && st.result && st.result.available && st.result.dataUrl) { artKey = key; setArt(st.result.dataUrl); }
      else { artKey = key; setArt(null); }
    }).catch(function () {});
  }

  function renderModes(r) {
    $('shuffle').classList.toggle('on', !!r.shuffle);
    repeatMode = r.repeatOne ? 'one' : (r.repeatAll ? 'all' : 'off');
    var rb = $('repeat');
    rb.textContent = repeatMode === 'one' ? '🔂' : '🔁';
    rb.classList.toggle('on', repeatMode !== 'off');
  }

  function renderQueue(q) {
    var panel = $('queuePanel');
    panel.innerHTML = '';
    (q.items || []).forEach(function (it, i) {
      var row = document.createElement('div');
      row.className = 'qrow' + (i === q.index ? ' cur' : '');
      row.innerHTML = '<span class="qi">' + (i + 1) + '</span><span><div class="qt"></div><div class="qa"></div></span>';
      row.querySelector('.qt').textContent = it.title || '—';
      row.querySelector('.qa').textContent = it.artist || '';
      row.onclick = function () { cmd('jump', { index: i }).then(poll); };
      panel.appendChild(row);
    });
  }
  function refreshQueue() { cmd('queue').then(function (st) { if (st && st.ok && st.result) renderQueue(st.result); }).catch(function () {}); }

  function render(st) {
    if (!st || !st.ok || !st.result || !st.result.available) { $('status').textContent = 'MediaMonkey not reachable'; return; }
    var r = st.result;
    $('title').textContent = (r.track && r.track.title) || '—';
    $('artist').textContent = (r.track && r.track.artist) || '—';
    $('album').textContent = (r.track && r.track.album) || '—';
    var playing = r.isPlaying && !r.paused;
    $('playpause').textContent = playing ? '⏸' : '▶';
    if (r.durationMs) {
      $('bar').style.width = Math.min(100, (100 * (r.positionMs || 0) / r.durationMs)) + '%';
      $('pos').textContent = fmt(r.positionMs); $('dur').textContent = fmt(r.durationMs);
    }
    if (!dragging && typeof r.volume === 'number') $('vol').value = r.volume;
    renderModes(r);
    if (r.trackKey !== artKey) refreshArt(r.trackKey);
    if (queueOpen && r.trackKey !== lastQueueKey) { lastQueueKey = r.trackKey; refreshQueue(); }
    $('status').textContent = '';
  }
  function poll() { cmd('status').then(render).catch(function () { $('status').textContent = 'offline'; }); }

  $('prev').onclick = function () { cmd('prev').then(poll); };
  $('next').onclick = function () { cmd('next').then(poll); };
  $('playpause').onclick = function () { cmd('playpause').then(poll); };
  $('shuffle').onclick = function () { cmd('setShuffle', { on: !$('shuffle').classList.contains('on') }).then(poll); };
  $('repeat').onclick = function () {
    var next = repeatMode === 'off' ? 'all' : (repeatMode === 'all' ? 'one' : 'off');
    cmd('setRepeat', { mode: next }).then(poll);
  };
  $('queueBtn').onclick = function () {
    queueOpen = !queueOpen;
    $('queuePanel').hidden = !queueOpen;
    $('queueBtn').classList.toggle('on', queueOpen);
    if (queueOpen) refreshQueue();
  };
  $('progress').onclick = function (e) {
    var rect = this.getBoundingClientRect();
    var frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    cmd('status').then(function (st) {
      var dur = st && st.result && st.result.durationMs;
      if (dur) cmd('seek', { ms: Math.round(frac * dur) }).then(poll);
    });
  };
  var vol = $('vol');
  vol.addEventListener('input', function () { dragging = true; });
  vol.addEventListener('change', function () { cmd('setVolume', { value: Number(vol.value) }).then(function () { dragging = false; poll(); }); });

  poll();
  setInterval(poll, POLL_MS);
})();
```

- [ ] **Step 4:** `node scripts/bundle-web.mjs` (regenerate assets), then `npm test` → green. **Step 5:** Commit: `feat(web): album art, seekable bar, shuffle/repeat, queue panel`

---

## Task C: Build + release addon v0.3.0 (controller)

- [ ] **Step 1:** `npm test` + `npm run build` → `dist/mamamonkey-0.3.0.mmip`. **Step 2:** Commit any remaining changes; push main. **Step 3:** Tag `v0.3.0` and push → addon release pipeline publishes it. (Companion unchanged — no companion tag.)

---

## Task D: Live verification (controller, Mac on LAN) + iterate getArt

- [ ] **Step 1:** User updates the PC addon to v0.3.0 (auto-update). Then from the Mac, `curl` each new command against `192.168.1.98:18391`: `setShuffle{on:true}`, `setRepeat{mode:'all'|'one'|'off'}`, `seek{ms}`, `queue`, and `getArt`.
- [ ] **Step 2:** Confirm `getArt` returns `available:true` + a `dataUrl`. If it returns `available:false` with a `link`, the `fetch(file://)` read is blocked — iterate the addon's `readFileAsDataUrl` (try MM's filesystem API or an alternative read) and re-ship a patch version.
- [ ] **Step 3:** User opens the PWA on the iPhone (via the companion) and confirms art, seek, shuffle/repeat, and the queue panel (tap to jump) all work.

## Done criteria
- Addon v0.3.0 exposes seek/shuffle/repeat/queue/getArt + extended status; unit tests green.
- PWA shows art, seekable progress, working shuffle/repeat, and a tap-to-jump queue.
- Live-verified on the iPhone (art may need one getArt iteration).
