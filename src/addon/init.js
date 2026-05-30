(function () {
  'use strict';
  var MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  // Keep in sync with src/addon/info.json (enforced by test/init.test.mjs).
  MM.VERSION = '0.1.1';
  MM.NAME = 'MamaMonkey';

  function buildHandlers() {
    var a = MM.bindings.getApp();
    return {
      ping: function () { return { pong: true, version: MM.VERSION }; },
      status: function () {
        var p = a && a.player;
        if (!p) return { available: false };
        var track = null;
        try {
          var t = p.getCurrentTrack && p.getCurrentTrack();
          if (t) track = { title: t.title, summary: t.summary };
        } catch (e) {}
        return {
          available: true,
          isPlaying: !!p.isPlaying,
          paused: !!p.paused,
          volume: (typeof p.volume === 'number') ? p.volume : null,
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

  var ready = (typeof window !== 'undefined' && window.whenReady) || (globalThis.window && globalThis.window.whenReady);
  if (typeof ready === 'function') { ready(boot); } else { boot(); }
})();
