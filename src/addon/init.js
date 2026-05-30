(function () {
  'use strict';
  var MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  // Keep in sync with src/addon/info.json (enforced by test/init.test.mjs).
  MM.VERSION = '0.3.2';
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
      MM.bindings.showToast('🐒 MamaMonkey ' + MM.VERSION + ' loaded');
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
