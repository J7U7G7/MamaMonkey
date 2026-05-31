(function () {
  'use strict';
  var MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  // Keep in sync with src/addon/info.json (enforced by test/init.test.mjs).
  MM.VERSION = '0.5.1';
  MM.NAME = 'MamaMonkey';

  function trackKeyOf(t) {
    if (!t) return '';
    return t.summary || ((t.artist || '') + ' - ' + (t.title || ''));
  }

  // MM cover paths can be a Windows path (C:\...) or a file:/// URL. fetch needs file:///.
  function toFileUrl(p) {
    var s = String(p || '');
    if (/^file:/i.test(s)) return s;
    return 'file:///' + s.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  // Read a local thumbnail into a data: URL (browser env inside MM).
  function readFileAsDataUrl(path) {
    return fetch(toFileUrl(path))
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

  // Read `path` and resolve the getArt result (data URL on success, diagnostics on failure).
  function readAndResolve(path, via, resolve, key) {
    readFileAsDataUrl(path).then(function (dataUrl) {
      resolve({ available: true, key: key, dataUrl: dataUrl, via: via });
    }).catch(function (e) {
      resolve({ available: false, stage: 'read-fail', path: String(path), via: via, error: String(e), key: key });
    });
  }

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

  function buildHandlers() {
    var a = MM.bindings.getApp();
    return {
      ping: function () { return { pong: true, version: MM.VERSION }; },
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
      play: function () { return a.player.playAsync(); },
      pause: function () { return a.player.pauseAsync(); },
      playpause: function () { return a.player.playPauseAsync(); },
      next: function () { return a.player.nextAsync(); },
      prev: function () { return a.player.prevAsync(); },
      setVolume: function (args) {
        var v = Math.max(0, Math.min(1, Number(args.value)));
        a.player.volume = v;
        return { volume: v };
      },
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
        if (!t) return { available: false, stage: 'no-track', key: key };
        var cl = t.coverList;
        if (!cl) return { available: false, stage: 'no-coverlist', key: key };

        // The current track's coverList is usually NOT populated synchronously — load it first.
        var loadP;
        try {
          if (typeof t.loadCoverListAsync === 'function') loadP = Promise.resolve(t.loadCoverListAsync());
          else if (typeof cl.whenLoaded === 'function') loadP = Promise.resolve(cl.whenLoaded());
          else loadP = Promise.resolve(cl);
        } catch (e) { loadP = Promise.resolve(cl); }

        var work = loadP.then(function (loaded) {
          var list = loaded || cl;
          var count = (list && list.count) || 0;
          if (!count) return { available: false, stage: 'empty-coverlist', count: count, key: key };
          return new Promise(function (resolve) {
            function withCover(cover) {
              if (!cover) { resolve({ available: false, stage: 'no-cover-obj', key: key }); return; }
              try {
                cover.getThumbAsync(300, 300, function (link) {
                  if (link && link !== '-') { readAndResolve(link, 'getThumbAsync', resolve, key); return; }
                  if (cover.picturePath) { readAndResolve(cover.picturePath, 'picturePath', resolve, key); return; }
                  resolve({ available: false, stage: 'empty-thumb', key: key });
                });
              } catch (e) {
                if (cover.picturePath) { readAndResolve(cover.picturePath, 'picturePath', resolve, key); return; }
                resolve({ available: false, stage: 'thumb-throw', error: String(e), key: key });
              }
            }
            try {
              if (list.locked) list.locked(function () { withCover(list.getValue(0)); });
              else withCover(list.getValue(0));
            } catch (e) { resolve({ available: false, stage: 'getValue-throw', error: String(e), key: key }); }
          });
        }).catch(function (e) {
          return { available: false, stage: 'load-fail', error: String(e), key: key };
        });

        // Never let the remoteRequest hang: cap at 6s.
        var timeout = new Promise(function (resolve) {
          setTimeout(function () { resolve({ available: false, stage: 'timeout', key: key }); }, 6000);
        });
        return Promise.race([work, timeout]);
      },
      lib: function (args) {
        var view = (args && args.view) || 'all';
        var q = args && args.q;
        var offset = Math.max(0, Number(args && args.offset) || 0);
        var limit = Math.max(1, Math.min(300, Number(args && args.limit) || 100));

        // All / search → SQL over Songs (filterBySearchPhrase is a no-op on this build).
        if (view === 'all') {
          var sql = 'SELECT * FROM Songs', token = 'lib:all';
          if (q) {
            var like = "'%" + String(q).replace(/'/g, "''") + "%'";
            sql = 'SELECT * FROM Songs WHERE SongTitle LIKE ' + like + ' OR Artist LIKE ' + like + ' OR Album LIKE ' + like;
            token = 'search';
          }
          var base;
          try { base = a.db.getTracklist(sql, -1); }
          catch (e) { return { error: 'db-failed', message: String(e), sql: sql }; }
          cachePut(token, base);
          return loadedList(base).then(function (l) {
            var r = readItems(l, offset, limit, trackItem);
            return { token: token, kind: 'tracks', total: r.total, items: r.items, truncated: r.truncated };
          });
        }

        // Ratings → GROUP BY Rating (numeric), shown as stars (Rating is 0–100; 20 = 1★).
        if (view === 'ratings') {
          var rsql = 'SELECT * FROM Songs WHERE Rating > 0 GROUP BY Rating ORDER BY Rating DESC';
          var rtoken = 'lib:ratings', rbase;
          try { rbase = a.db.getTracklist(rsql, -1); }
          catch (e) { return { error: 'browse-failed', view: view, message: String(e), sql: rsql }; }
          cachePut(rtoken, rbase);
          return loadedList(rbase).then(function (l) {
            var r = readItems(l, offset, limit, function (t, i) {
              var rv = (typeof t.rating === 'number') ? t.rating : 0;
              var full = Math.floor(rv / 20), half = (rv % 20) >= 10 ? 1 : 0;
              var label = rv > 0
                ? '★★★★★'.slice(0, full) + (half ? '½' : '') + '☆☆☆☆☆'.slice(0, 5 - full - half)
                : '—';
              return { index: i, by: 'rating', value: rv, name: label };
            });
            return { token: rtoken, kind: 'ratings', total: r.total, items: r.items, truncated: r.truncated };
          });
        }

        // Browse-by → SQL GROUP BY over Songs (same proven path as 'all'/search).
        var col = view === 'artists' ? 'Artist' : view === 'albums' ? 'Album' : view === 'genres' ? 'Genre' : null;
        var byKey = view === 'artists' ? 'artist' : view === 'albums' ? 'album' : view === 'genres' ? 'genre' : null;
        if (!col) return { error: 'bad-view', view: view };
        var bsql = 'SELECT * FROM Songs WHERE ' + col + " IS NOT NULL AND " + col + " <> '' GROUP BY " + col + ' ORDER BY ' + col + ' COLLATE NOCASE';
        var btoken = 'lib:' + view, bbase;
        try { bbase = a.db.getTracklist(bsql, -1); }
        catch (e) { return { error: 'browse-failed', view: view, message: String(e), sql: bsql }; }
        cachePut(btoken, bbase);
        return loadedList(bbase).then(function (l) {
          var r = readItems(l, offset, limit, function (t, i) {
            var value = view === 'artists' ? t.artist : view === 'albums' ? t.album : t.genre;
            return { index: i, by: byKey, value: value, name: value, artist: view === 'albums' ? t.artist : undefined };
          });
          return { token: btoken, kind: view, total: r.total, items: r.items, truncated: r.truncated };
        });
      },
      // Drill into a browse value (artist/album/genre) → its tracks, via SQL.
      libTracks: function (args) {
        var by = args && args.by, value = String((args && args.value) == null ? '' : args.value);
        var offset = Math.max(0, Number(args && args.offset) || 0);
        var limit = Math.max(1, Math.min(300, Number(args && args.limit) || 100));
        var sql, token;
        if (by === 'rating') {
          var rv = Number(value);
          sql = 'SELECT * FROM Songs WHERE Rating = ' + (isFinite(rv) ? rv : -999) + ' ORDER BY Artist COLLATE NOCASE, Album COLLATE NOCASE';
          token = 'by:rating:' + rv;
        } else {
          var col = by === 'artist' ? 'Artist' : by === 'album' ? 'Album' : by === 'genre' ? 'Genre' : null;
          if (!col) return { error: 'bad-by', by: by };
          var esc = value.replace(/'/g, "''");
          sql = 'SELECT * FROM Songs WHERE ' + col + " = '" + esc + "' ORDER BY Album COLLATE NOCASE";
          token = 'by:' + by + ':' + esc;
        }
        var base;
        try { base = a.db.getTracklist(sql, -1); }
        catch (e) { return { error: 'drill-failed', message: String(e), sql: sql }; }
        cachePut(token, base);
        return loadedList(base).then(function (l) {
          var r = readItems(l, offset, limit, trackItem);
          return { token: token, kind: 'tracks', title: value, total: r.total, items: r.items, truncated: r.truncated };
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
        if (mode === 'now') params.focusedTrackIndex = (index != null ? index : 0);
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
        var out = {};
        function keys(o) { try { return o ? Object.keys(o).slice(0, 80) : null; } catch (e) { return 'err:' + e; } }
        out.appKeys = keys(a);
        out.dbKeys = keys(a && a.db);
        out.collKeys = keys(a && a.collections);
        out.plKeys = keys(a && a.playlists);
        // Confirm the documented library query path + row count.
        try {
          var tl = a.db.getTracklist('SELECT * FROM Songs', -1);
          return Promise.resolve(tl && tl.whenLoaded ? tl.whenLoaded() : tl)
            .then(function (l) { out.dbTracklistCount = (l && l.count) || 0; return out; })
            .catch(function (e) { out.dbTracklistErr = String(e); return out; });
        } catch (e) { out.dbTracklistThrow = String(e); return out; }
      },
    };
  }

  function boot() {
    try {
      MM.logger = MM.createLogger({ maxBytes: 128 * 1024 });
      MM.logger.log('info', 'MamaMonkey booting', { version: MM.VERSION });
      var dispatcher = MM.createCommandDispatcher(buildHandlers());
      var reg = MM.bindings.registerRemoteRequest(function (body) {
        MM.logger.log('info', 'remoteRequest received', { body: body });
        return dispatcher.handle(body);
      });
      MM.logger.log('info', 'remoteRequest registered', reg);
      MM.bindings.showToast('🦸‍♀️ MamaMonkey ' + MM.VERSION + ' loaded');
      MM.logger.log('info', 'MamaMonkey ready');
    } catch (e) {
      try { MM.logger && MM.logger.log('error', 'boot failed', { message: String(e) }); } catch (e2) {}
      try { if (globalThis.console) globalThis.console.error('MamaMonkey boot failed', e); } catch (e3) {}
    }
  }

  // Register at top level, like MM's official remoteControl sample (which calls
  // app.listen directly in init.js without whenReady). app is available here.
  boot();
})();
