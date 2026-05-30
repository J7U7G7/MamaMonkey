(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function getApp() {
    try { if (typeof app !== 'undefined' && app) return app; } catch (e) {}
    try { return globalThis.app || null; } catch (e) { return null; }
  }

  // Hook MM's media-server request event. onRequest(requestBodyString) -> Promise<{handled, response}>
  function registerRemoteRequest(onRequest) {
    var a = getApp();
    if (!a || typeof a.listen !== 'function') return { ok: false, error: 'app.listen unavailable' };
    a.listen(a, 'remoteRequest', function (r) {
      try {
        r.asyncResult = true;
        Promise.resolve(onRequest(r.requestBody)).then(function (out) {
          try {
            if (out && out.handled) {
              r.responseBody = JSON.stringify(out.response);
            }
          } catch (e) {
            try { r.responseBody = JSON.stringify({ ok: false, error: 'serialize failed' }); } catch (e2) {}
          }
          try { if (typeof r.sendResponse === 'function') r.sendResponse(); } catch (e3) {}
        });
      } catch (e) {
        try { r.responseBody = JSON.stringify({ ok: false, error: String(e) }); } catch (e2) {}
      }
    });
    return { ok: true };
  }

  function showToast(msg) {
    try {
      if (globalThis.uitools && globalThis.uitools.toastMessage && globalThis.uitools.toastMessage.show) {
        globalThis.uitools.toastMessage.show(msg, { disableUndo: true, disableClose: true, delay: 5000 });
        return true;
      }
    } catch (e) {}
    return showDialog(msg);
  }

  function showDialog(msg) {
    try {
      if (globalThis.messageDlg) {
        globalThis.messageDlg(msg, 'information', ['btnOK'], { defaultButton: 'btnOK' }, undefined);
        return true;
      }
    } catch (e) {}
    try { if (globalThis.console) globalThis.console.log('[MamaMonkey]', msg); } catch (e) {}
    return false;
  }

  MM.bindings = { getApp: getApp, registerRemoteRequest: registerRemoteRequest, showToast: showToast, showDialog: showDialog };
})();
