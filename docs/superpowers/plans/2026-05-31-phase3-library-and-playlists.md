# MamaMonkey Phase 3 — Library & Playlists Implementation Plan

> Executor: commit per task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Node at `/opt/homebrew/bin`. Do NOT push/tag. Spec: `docs/superpowers/specs/2026-05-31-phase3-library-and-playlists-design.md`. Companion UNCHANGED. Confirmed MM APIs: `app.collections.getTracklist/getArtistList/getAlbumList/getGenreList`, `Tracklist.whenLoaded/locked/count/getValue/getRange/filterBySearchPhrase`, `app.player.addTracksAsync(tl,{withClear,startPlayback,afterCurrent,position,focusedTrackIndex})`, `app.playlists.root.getChildren()/getByIDAsync(id)`, `Playlist.id/title/name/childrenCount/getTracklist/newPlaylist/commitAsync/addTracksAsync/removeTrackAsync/moveTrackAsync/deleteAsync`.

**Goal:** Addon v0.4.0 (token-cached browse/search + play/enqueue + playlist read + full CRUD, with an `introspect` helper for the few live-unknown list shapes); PWA becomes a 3-tab app (Now-Playing / Library / Playlists).

---

## Task A: Addon v0.4.0 — cache, browse/search/play, playlists CRUD, introspect

**Files:** `src/addon/init.js`, `src/addon/info.json` + `package.json` (→ 0.4.0), `test/init.test.mjs`.

- [ ] **Step 1:** In `src/addon/init.js`, **above `buildHandlers`** (after `readAndResolve`), add the cache + helpers:

```js
  // ---- Phase 3: token-referenced list/Tracklist cache (avoids SQL/escaping) ----
  var _cache = {};
  var _order = [];
  function cachePut(token, list) {
    if (!Object.prototype.hasOwnProperty.call(_cache, token)) {
      _order.push(token);
      while (_order.length > 10) { delete _cache[_order.shift()]; }
    }
    _cache[token] = list;
    return token;
  }
  function loadedList(list) {
    return Promise.resolve(list && list.whenLoaded ? list.whenLoaded() : list).then(function (l) { return l || list; });
  }
  function readItems(list, offset, limit, map) {
    var items = [], total = (list && list.count) || 0, end = Math.min(total, offset + limit);
    function collect() { for (var i = offset; i < end; i++) { items.push(map(list.getValue(i), i)); } }
    if (list && list.locked) list.locked(collect); else collect();
    return { total: total, items: items, truncated: end < total };
  }
  function trackItem(t, i) { return { index: i, id: t && t.id, title: t && t.title, artist: t && t.artist, album: t && t.album }; }
  function valueAt(list, index) { var v; if (list && list.locked) list.locked(function () { v = list.getValue(index); }); else v = list.getValue(index); return v; }
```

- [ ] **Step 2:** Add these handlers to the object returned by `buildHandlers()` (after `getArt`). Note `a = MM.bindings.getApp()` is already in scope.

```js
      lib: function (args) {
        var view = (args && args.view) || 'all';
        var q = args && args.q;
        var offset = Math.max(0, Number(args && args.offset) || 0);
        var limit = Math.max(1, Math.min(300, Number(args && args.limit) || 100));
        var base, token, map = trackItem, isTracks = true;
        try {
          if (view === 'artists') { base = a.collections.getArtistList(); token = 'lib:artists'; isTracks = false; map = function (it, i) { return { index: i, name: it && (it.name || it.title), drillable: !!(it && it.getTracklist) }; }; }
          else if (view === 'albums') { base = a.collections.getAlbumList(); token = 'lib:albums'; isTracks = false; map = function (it, i) { return { index: i, name: it && (it.title || it.name), artist: it && it.artist, drillable: !!(it && it.getTracklist) }; }; }
          else if (view === 'genres') { base = a.collections.getGenreList(); token = 'lib:genres'; isTracks = false; map = function (it, i) { return { index: i, name: it && (it.name || it.title), drillable: !!(it && it.getTracklist) }; }; }
          else { base = a.collections.getTracklist(); token = 'lib:all'; }
        } catch (e) { return { error: 'list-failed', view: view, message: String(e) }; }
        cachePut(token, base);
        return loadedList(base).then(function (l) {
          if (q && l.filterBySearchPhrase) { l.filterBySearchPhrase(q); token = 'search'; cachePut(token, l); return loadedList(l); }
          return l;
        }).then(function (l) {
          var r = readItems(l, offset, limit, map);
          return { token: token, kind: isTracks ? 'tracks' : view, total: r.total, items: r.items, truncated: r.truncated };
        });
      },
      open: function (args) {
        var token = args && args.token, index = Number(args && args.index) || 0;
        var offset = Math.max(0, Number(args && args.offset) || 0);
        var limit = Math.max(1, Math.min(300, Number(args && args.limit) || 100));
        var src = _cache[token];
        if (!src) return { error: 'unknown-token', token: token };
        return loadedList(src).then(function (l) {
          var node = valueAt(l, index);
          if (!node || !node.getTracklist) return { error: 'not-drillable', token: token, index: index };
          var tl = node.getTracklist();
          var newTok = token + ':' + index;
          cachePut(newTok, tl);
          return loadedList(tl).then(function (tll) {
            var r = readItems(tll, offset, limit, trackItem);
            return { token: newTok, kind: 'tracks', title: node.title || node.name, total: r.total, items: r.items, truncated: r.truncated };
          });
        });
      },
      play: function (args) {
        var token = args && args.token, mode = (args && args.mode) || 'now';
        var index = (args && args.index != null) ? Number(args.index) : undefined;
        var tl = _cache[token];
        if (!tl) return Promise.resolve({ error: 'unknown-token', token: token });
        var params = mode === 'next' ? { afterCurrent: true }
          : mode === 'queue' ? { position: -1 }
          : { withClear: true, startPlayback: true };
        if (index != null && mode === 'now') params.focusedTrackIndex = index;
        return loadedList(tl).then(function (l) { return a.player.addTracksAsync(l, params); }).then(function () {
          return (mode === 'now') ? a.player.playAsync().then(function () { return { ok: true, mode: mode }; }) : { ok: true, mode: mode };
        });
      },
      playlists: function () {
        var root = a.playlists && a.playlists.root;
        if (!root || !root.getChildren) return { items: [], error: 'no-root' };
        var ch = root.getChildren();
        return loadedList(ch).then(function (l) {
          var r = readItems(l, 0, 500, function (p, i) { return { index: i, id: p && p.id, title: p && (p.title || p.name), isFolder: !!(p && p.childrenCount) }; });
          return { items: r.items, total: r.total };
        });
      },
      playlistTracks: function (args) {
        var id = Number(args && args.id);
        var offset = Math.max(0, Number(args && args.offset) || 0);
        var limit = Math.max(1, Math.min(300, Number(args && args.limit) || 100));
        return Promise.resolve(a.playlists.getByIDAsync(id)).then(function (pl) {
          if (!pl || !pl.getTracklist) return { error: 'no-playlist', id: id };
          var tl = pl.getTracklist(); cachePut('pl:' + id, tl);
          return loadedList(tl).then(function (l) { var r = readItems(l, offset, limit, trackItem); return { token: 'pl:' + id, total: r.total, items: r.items, truncated: r.truncated }; });
        });
      },
      playlistCreate: function (args) {
        var name = (args && args.name) || 'New Playlist';
        var p = a.playlists.root.newPlaylist();
        p.name = name;
        return Promise.resolve(p.commitAsync()).then(function () { return { ok: true, id: p.id, name: name }; });
      },
      playlistRename: function (args) {
        return Promise.resolve(a.playlists.getByIDAsync(Number(args.id))).then(function (p) { p.name = args.name; return Promise.resolve(p.commitAsync()); }).then(function () { return { ok: true }; });
      },
      playlistDelete: function (args) {
        return Promise.resolve(a.playlists.getByIDAsync(Number(args.id))).then(function (p) { return Promise.resolve(p.deleteAsync()); }).then(function () { return { ok: true }; });
      },
      playlistAdd: function (args) {
        var tl = _cache[args && args.token];
        if (!tl) return Promise.resolve({ error: 'unknown-token' });
        return Promise.resolve(a.playlists.getByIDAsync(Number(args.id))).then(function (p) {
          return loadedList(tl).then(function (l) { return p.addTracksAsync(l); });
        }).then(function () { return { ok: true }; });
      },
      playlistRemove: function (args) {
        return Promise.resolve(a.playlists.getByIDAsync(Number(args.id))).then(function (p) {
          var tl = p.getTracklist();
          return loadedList(tl).then(function (l) { return p.removeTrackAsync(valueAt(l, Number(args.trackIndex))); });
        }).then(function () { return { ok: true }; });
      },
      playlistReorder: function (args) {
        return Promise.resolve(a.playlists.getByIDAsync(Number(args.id))).then(function (p) {
          var tl = p.getTracklist();
          return loadedList(tl).then(function (l) { return p.moveTrackAsync(valueAt(l, Number(args.from)), valueAt(l, Number(args.to))); });
        }).then(function () { return { ok: true }; });
      },
      introspect: function () {
        var out = { collections: {}, playlists: {} };
        try { out.collections.has = !!a.collections; } catch (e) {}
        try { var al = a.collections.getArtistList(); out.collections.artist = { keys: al ? Object.keys(al).slice(0, 40) : null }; if (al && al.count !== undefined) out.collections.artist.count = al.count; } catch (e) { out.collections.artistErr = String(e); }
        try { var alb = a.collections.getAlbumList(); out.collections.albumKeys = alb ? Object.keys(alb).slice(0, 40) : null; } catch (e) { out.collections.albumErr = String(e); }
        try { var g = a.collections.getGenreList(); out.collections.genreKeys = g ? Object.keys(g).slice(0, 40) : null; } catch (e) { out.collections.genreErr = String(e); }
        try { out.playlists.hasRoot = !!(a.playlists && a.playlists.root); out.playlists.rootKeys = a.playlists ? Object.keys(a.playlists).slice(0, 40) : null; } catch (e) { out.playlists.err = String(e); }
        return out;
      },
```

- [ ] **Step 3:** Bump `MM.VERSION` → `'0.4.0'`; `version` → `0.4.0` in `info.json` + `package.json`.

- [ ] **Step 4:** Extend `test/init.test.mjs`. Add to `fakePlayer`: `addTracksAsync: function(l,p){ this._added={count:l&&l.count,params:p}; return Promise.resolve(); }`. Add a fake `app` augmentation in `loadAll()` where bindings.getApp returns `{ player: fakePlayer, collections: fakeCollections, playlists: fakePlaylists }`, with:

```js
  function tracklist(items) {
    return { count: items.length, whenLoaded: function(){ return Promise.resolve(this); }, locked: function(f){ f(); },
      getValue: function(i){ return items[i]; } };
  }
  var fakeCollections = {
    getTracklist: function(){ return tracklist([{id:1,title:'T1',artist:'A1',album:'Al1'},{id:2,title:'T2',artist:'A2',album:'Al2'}]); },
    getArtistList: function(){ return tracklist([{name:'A1',getTracklist:function(){return tracklist([{id:1,title:'T1',artist:'A1'}]);}}]); },
    getAlbumList: function(){ return tracklist([]); }, getGenreList: function(){ return tracklist([]); },
  };
  var _pl = { id: 7, name: 'P', getTracklist: function(){ return tracklist([{id:1,title:'T1'}]); },
    addTracksAsync: function(){return Promise.resolve();}, commitAsync:function(){return Promise.resolve();},
    deleteAsync:function(){return Promise.resolve();}, removeTrackAsync:function(){return Promise.resolve();}, moveTrackAsync:function(){return Promise.resolve();} };
  var fakePlaylists = { root: { getChildren: function(){ return tracklist([{id:7,title:'P',childrenCount:0}]); }, newPlaylist: function(){ return _pl; } },
    getByIDAsync: function(){ return Promise.resolve(_pl); } };
```

  Then add tests:

```js
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
```

- [ ] **Step 5:** `node --test test/init.test.mjs` → green; `npm test`; `npm run build` → `dist/mamamonkey-0.4.0.mmip`. **Step 6:** Commit: `feat(addon): library browse/search/play + playlist CRUD + introspect (v0.4.0)`

---

## Task B: PWA — 3-tab app (Now-Playing / Library / Playlists)

**Files:** `src/web/index.html`, `src/web/style.css`, `src/web/app.js`. Keep all Phase 2 now-playing logic; wrap it in a tab and add two new views.

- [ ] **Step 1:** `src/web/index.html` — wrap the existing now-playing `<main>` content in a `<section id="view-now">` and add the two new sections + a bottom tab bar. Structure:

```html
  <main id="app">
    <section id="view-now" class="view">
      <!-- EXISTING Phase 2 now-playing markup stays here verbatim (h1, art, title/artist/album, progress, transport, modes, volume, status, queuePanel) -->
    </section>

    <section id="view-lib" class="view" hidden>
      <input id="search" class="search" type="search" placeholder="Search library…">
      <div class="segs">
        <button class="seg on" data-view="all">All</button>
        <button class="seg" data-view="artists">Artists</button>
        <button class="seg" data-view="albums">Albums</button>
        <button class="seg" data-view="genres">Genres</button>
      </div>
      <div id="libList" class="list"></div>
    </section>

    <section id="view-pls" class="view" hidden>
      <div class="plsbar"><button id="newPls" class="seg">＋ New playlist</button></div>
      <div id="plsList" class="list"></div>
    </section>
  </main>
  <nav id="tabs">
    <button class="tab on" data-tab="now">▶<span>Now</span></button>
    <button class="tab" data-tab="lib">🎵<span>Library</span></button>
    <button class="tab" data-tab="pls">☰<span>Playlists</span></button>
  </nav>
  <div id="sheet" class="sheet" hidden></div>
  <script src="/app.js"></script>
```

- [ ] **Step 2:** `src/web/style.css` — append:

```css
#app { padding-bottom: 78px; }
.view { }
#tabs { position: fixed; left: 0; right: 0; bottom: 0; display: flex; background: #1a1a1c; border-top: 1px solid #2c2c2e; padding-bottom: env(safe-area-inset-bottom); }
.tab { flex: 1; background: none; border: none; color: #888; font-size: 20px; padding: 8px 0; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.tab span { font-size: 10px; }
.tab.on { color: #9af; }
.search { width: 100%; padding: 12px; border-radius: 10px; border: none; background: #1c1c1e; color: #eee; font-size: 16px; margin: 8px 0; }
.segs, .plsbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.seg { background: #2c2c2e; color: #ccc; border: none; border-radius: 16px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
.seg.on { background: #9af; color: #111; }
.list { text-align: left; }
.row { padding: 12px 6px; border-bottom: 1px solid #1c1c1e; display: flex; align-items: center; gap: 10px; cursor: pointer; }
.row.cur { color: #9af; }
.row .main { flex: 1; min-width: 0; }
.row .t { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .s { font-size: 12px; color: #888; }
.row .more { color: #888; font-size: 20px; padding: 0 6px; }
.sheet { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: flex-end; z-index: 10; }
.sheet .card { background: #1c1c1e; width: 100%; border-radius: 16px 16px 0 0; padding: 8px 0 calc(8px + env(safe-area-inset-bottom)); }
.sheet button { display: block; width: 100%; background: none; border: none; color: #eee; font-size: 17px; padding: 16px; text-align: center; border-bottom: 1px solid #2c2c2e; }
.sheet button.cancel { color: #f88; }
```

- [ ] **Step 3:** `src/web/app.js` — keep the existing now-playing IIFE logic; add tab + library + playlist logic. Append the following INSIDE the existing IIFE (before the final `poll(); setInterval(...)`), and guard the now-playing poll so it only runs while the Now tab is active (wrap the body of `poll()`'s use or just let it run — it's cheap). Add:

```js
  // ---------- tabs ----------
  var activeTab = 'now';
  function showTab(tab) {
    activeTab = tab;
    ['now','lib','pls'].forEach(function (t) { $('view-' + t).hidden = (t !== tab); });
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    if (tab === 'lib' && !libList.dataset.loaded) loadLib('all', '');
    if (tab === 'pls') loadPlaylists();
  }
  document.querySelectorAll('.tab').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });

  // ---------- action sheet ----------
  function sheet(options) {
    var s = $('sheet'); s.innerHTML = '';
    var card = document.createElement('div'); card.className = 'card';
    options.forEach(function (o) {
      var btn = document.createElement('button'); btn.textContent = o.label; if (o.cancel) btn.className = 'cancel';
      btn.onclick = function () { s.hidden = true; if (o.fn) o.fn(); }; card.appendChild(btn);
    });
    s.appendChild(card); s.hidden = false;
    s.onclick = function (e) { if (e.target === s) s.hidden = true; };
  }
  function playSheet(token, index, extra) {
    var opts = [
      { label: '▶ Play now', fn: function () { cmd('play', { token: token, index: index, mode: 'now' }).then(function () { showTab('now'); poll(); }); } },
      { label: '⏭ Play next', fn: function () { cmd('play', { token: token, index: index, mode: 'next' }); } },
      { label: '➕ Add to queue', fn: function () { cmd('play', { token: token, index: index, mode: 'queue' }); } },
      { label: '＋ Add to playlist', fn: function () { addToPlaylistFlow(token); } },
    ];
    (extra || []).forEach(function (e) { opts.push(e); });
    opts.push({ label: 'Cancel', cancel: true });
    sheet(opts);
  }

  // ---------- library ----------
  var libList = $('libList'), search = $('search');
  var libView = 'all', libToken = null, libKind = 'tracks';
  function rowEl(main, sub, onTap, onMore, isCur) {
    var row = document.createElement('div'); row.className = 'row' + (isCur ? ' cur' : '');
    row.innerHTML = '<div class="main"><div class="t"></div><div class="s"></div></div>';
    row.querySelector('.t').textContent = main || '—'; row.querySelector('.s').textContent = sub || '';
    row.querySelector('.main').onclick = onTap;
    if (onMore) { var m = document.createElement('div'); m.className = 'more'; m.textContent = '⋯'; m.onclick = function (e) { e.stopPropagation(); onMore(); }; row.appendChild(m); }
    return row;
  }
  function renderLib(res) {
    libList.innerHTML = ''; libToken = res.token; libKind = res.kind;
    (res.items || []).forEach(function (it) {
      if (res.kind === 'tracks') {
        libList.appendChild(rowEl(it.title, it.artist + (it.album ? ' · ' + it.album : ''),
          function () { playSheet(res.token, it.index); }, function () { playSheet(res.token, it.index); }));
      } else {
        libList.appendChild(rowEl(it.name, res.kind.slice(0, -1),
          function () { cmd('open', { token: res.token, index: it.index }).then(renderLib); },
          function () { cmd('open', { token: res.token, index: it.index }).then(function (r) { playSheet(r.token); }); }));
      }
    });
    libList.dataset.loaded = '1';
  }
  function loadLib(view, q) { libView = view; cmd('lib', { view: view, q: q || undefined }).then(renderLib); }
  document.querySelectorAll('.seg[data-view]').forEach(function (b) {
    b.onclick = function () { document.querySelectorAll('.seg[data-view]').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); loadLib(b.dataset.view, search.value); };
  });
  var searchT; search.oninput = function () { clearTimeout(searchT); searchT = setTimeout(function () { loadLib(libView, search.value); }, 350); };

  // ---------- playlists ----------
  var plsList = $('plsList');
  function loadPlaylists() {
    cmd('playlists').then(function (res) {
      plsList.innerHTML = '';
      (res.items || []).forEach(function (p) {
        plsList.appendChild(rowEl(p.title, p.isFolder ? 'folder' : 'playlist',
          function () { openPlaylist(p); },
          function () {
            sheet([
              { label: '▶ Play', fn: function () { cmd('playlistTracks', { id: p.id }).then(function (r) { cmd('play', { token: r.token, mode: 'now' }).then(function () { showTab('now'); poll(); }); }); } },
              { label: '✏️ Rename', fn: function () { var n = prompt('New name', p.title); if (n) cmd('playlistRename', { id: p.id, name: n }).then(loadPlaylists); } },
              { label: '🗑 Delete', fn: function () { if (confirm('Delete "' + p.title + '"?')) cmd('playlistDelete', { id: p.id }).then(loadPlaylists); } },
              { label: 'Cancel', cancel: true },
            ]);
          }));
      });
    });
  }
  function openPlaylist(p) {
    cmd('playlistTracks', { id: p.id }).then(function (res) {
      plsList.innerHTML = '';
      var back = rowEl('‹ ' + p.title, 'tap a track to play', loadPlaylists, null); plsList.appendChild(back);
      (res.items || []).forEach(function (it) {
        plsList.appendChild(rowEl(it.title, it.artist,
          function () { cmd('play', { token: res.token, index: it.index, mode: 'now' }).then(function () { showTab('now'); poll(); }); },
          function () {
            sheet([
              { label: '🗑 Remove from playlist', fn: function () { cmd('playlistRemove', { id: p.id, trackIndex: it.index }).then(function () { openPlaylist(p); }); } },
              { label: 'Cancel', cancel: true },
            ]);
          }));
      });
    });
  }
  $('newPls').onclick = function () { var n = prompt('Playlist name'); if (n) cmd('playlistCreate', { name: n }).then(loadPlaylists); };

  // add-to-playlist: pick a playlist then add the cached token
  function addToPlaylistFlow(token) {
    cmd('playlists').then(function (res) {
      var opts = (res.items || []).filter(function (p) { return !p.isFolder; }).map(function (p) {
        return { label: p.title, fn: function () { cmd('playlistAdd', { id: p.id, token: token }); } };
      });
      opts.push({ label: 'Cancel', cancel: true });
      sheet(opts);
    });
  }
```

  Also guard polling so it doesn't fight the other tabs: change the bottom `setInterval(poll, POLL_MS);` to `setInterval(function () { if (activeTab === 'now') poll(); }, POLL_MS);` and keep the initial `poll();`.

- [ ] **Step 4:** `node scripts/bundle-web.mjs` → regenerate assets; `npm test` → green. **Step 5:** Commit: `feat(web): 3-tab app — library browse/search/play + playlist management`

---

## Task C: Build + release addon v0.4.0 (controller)
- [ ] `npm test` + `npm run build`; commit anything pending; push main; tag `v0.4.0`; verify the release + manifest flip to 0.4.0.

## Task D: Live verification (controller, Mac on LAN) + iterate
- [ ] User updates PC addon to v0.4.0. From the Mac, `curl` `introspect` first (learn the real `getArtistList/getAlbumList/getGenreList` item shapes), then `lib{view:'all'}`, `lib{view:'all',q:'bowie'}`, `lib{view:'artists'}` + `open`, `play`, `playlists`, `playlistCreate`/`playlistAdd`/`playlistTracks`/`playlistReorder`/`playlistDelete`. Fix any browse-by-shape mismatches (artist/genre `.name` field, drillability) and re-ship a patch if needed.
- [ ] Refresh the companion-served PWA; user tests the 3 tabs on the iPhone (search, browse, play/enqueue, playlist view + create/rename/delete/add/remove).

## Done criteria
- Addon v0.4.0: search + browse + play/enqueue + playlists read + full CRUD (browse-by edges finalized live via introspect).
- PWA: 3 tabs working on the iPhone; can search/browse the 6438-track library, play/enqueue selections, and manage playlists.
