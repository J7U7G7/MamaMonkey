(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  // Resolve MM's global app object across possible names without throwing.
  function getApp() {
    try { if (typeof app !== 'undefined' && app) return app; } catch (e) {}
    try { if (globalThis.app) return globalThis.app; } catch (e) {}
    return null;
  }

  // Register a handler for HTTP requests arriving on MM's Media-Sharing port.
  // onRequest(reqInfo) -> { status, contentType, body } | null
  // reqInfo: { method, path }
  // DOC-BASED ASSUMPTION — verify against sampleScripts/remoteControl on the PC.
  function registerHttpHandler(onRequest) {
    const app = getApp();
    if (!app) throw new Error('MM app object not available');
    // The MM5 remoteControl sample hooks the sharing server's request event.
    // We attempt the documented hook; the exact member is confirmed on the PC.
    const sharing = app.sharing || app.mediaSharing || app.server || null;
    if (sharing && typeof sharing.addRequestHandler === 'function') {
      sharing.addRequestHandler(function (req, resp) {
        const out = onRequest({ method: req.method || 'GET', path: req.path || req.url || '/' });
        if (!out) return false; // not handled -> let MM continue
        resp.statusCode = out.status;
        resp.setHeader && resp.setHeader('Content-Type', out.contentType);
        resp.write && resp.write(out.body);
        resp.end && resp.end();
        return true;
      });
      return { hooked: true, via: 'sharing.addRequestHandler' };
    }
    // Fallback: expose a global MM looks for (per remoteControl sample naming).
    globalThis.MMCustomRequest = function (req) {
      return onRequest({ method: (req && req.method) || 'GET', path: (req && req.path) || '/' });
    };
    return { hooked: true, via: 'MMCustomRequest-global' };
  }

  // Best-effort host/port/IP for display. Falls back to placeholders.
  function getSharingInfo() {
    const app = getApp();
    let port = 0, host = 'this-pc';
    try { port = (app && app.sharing && app.sharing.port) || (app && app.getValue && app.getValue('sharingPort', 0)) || 0; } catch (e) {}
    try { host = (app && app.utils && app.utils.localIP) ? app.utils.localIP() : host; } catch (e) {}
    return { host, port };
  }

  // Persist/read the log file (best-effort; in-memory buffer is the source of truth).
  function appendLogFile(text) {
    const app = getApp();
    try {
      if (app && app.filesystem && app.filesystem.appendString) {
        app.filesystem.appendString(logPath(app), text + '\n');
        return true;
      }
    } catch (e) {}
    return false;
  }
  function readLogFile() {
    const app = getApp();
    try {
      if (app && app.filesystem && app.filesystem.loadTextFromFile) {
        return app.filesystem.loadTextFromFile(logPath(app)) || '';
      }
    } catch (e) {}
    return '';
  }
  function logPath(app) {
    try {
      const base = (app && app.filesystem && app.filesystem.getAppDataPath && app.filesystem.getAppDataPath()) || '.';
      return base + '/MamaMonkey.log';
    } catch (e) { return 'MamaMonkey.log'; }
  }

  // Add a menu item / status entry inside MM. Best-effort.
  function addStatusMenuItem(opts) {
    const app = getApp();
    try {
      if (app && app.menus && app.menus.addItem) {
        app.menus.addItem({ title: opts.label, execute: opts.onClick, location: 'tools' });
        return true;
      }
    } catch (e) {}
    return false;
  }

  MM.bindings = { registerHttpHandler, getSharingInfo, appendLogFile, readLogFile, addStatusMenuItem, getApp };
})();
