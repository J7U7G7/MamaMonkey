(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  // Keep in sync with src/addon/info.json (enforced by test/init.test.mjs).
  MM.VERSION = '0.1.0';
  MM.NAME = 'MamaMonkey';

  function boot() {
    try {
      MM.logger = MM.createLogger({ maxBytes: 128 * 1024 });
      MM.logger.log('info', 'MamaMonkey booting', { version: MM.VERSION });
      MM.startHttp({ name: MM.NAME, version: MM.VERSION });
      MM.mountStatusPanel({ name: MM.NAME, version: MM.VERSION });
      MM.logger.log('info', 'MamaMonkey ready');
    } catch (e) {
      // Last-resort: try to record the failure somewhere visible.
      try { MM.logger && MM.logger.log('error', 'boot failed', { message: String(e) }); } catch (e2) {}
      try { if (globalThis.console) console.error('MamaMonkey boot failed', e); } catch (e3) {}
    }
  }

  // MM exposes window.whenReady; fall back to immediate boot if absent.
  const ready = (typeof window !== 'undefined' && window.whenReady) ||
                (globalThis.window && globalThis.window.whenReady);
  if (typeof ready === 'function') {
    ready(boot);
  } else {
    boot();
  }
})();
