(function () {
  'use strict';
  var MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});
  try {
    if (typeof actions !== 'undefined' && actions) {
      actions.mamamonkeyStatus = {
        title: function () { return 'MamaMonkey: Status'; },
        hotkeyAble: true,
        execute: function () {
          var v = MM.VERSION || '?';
          var logText = (MM.logger && MM.logger.getText && MM.logger.getText()) || '(log not available in this context)';
          var msg = 'MamaMonkey ' + v + '\n\nRemote control API is active (remoteRequest).\nServer address: Tools > Options > Media Sharing.\n\nRecent log:\n' + logText;
          if (MM.bindings && MM.bindings.showDialog) {
            MM.bindings.showDialog(msg);
          } else if (globalThis.messageDlg) {
            globalThis.messageDlg(msg, 'information', ['btnOK'], { defaultButton: 'btnOK' }, undefined);
          }
        },
      };
    }
  } catch (e) {
    try { if (globalThis.console) globalThis.console.error('MamaMonkey actions_add failed', e); } catch (e2) {}
  }
})();
