(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function createLogger(opts) {
    var buf = MM.createLogBuffer({ maxBytes: (opts && opts.maxBytes) || 64 * 1024 });
    var seq = 0;
    function fmt(level, msg, data) {
      seq += 1;
      var line = '#' + seq + ' [' + level + '] ' + msg;
      if (data !== undefined) {
        try { line += ' ' + JSON.stringify(data); } catch (e) { line += ' [unserializable]'; }
      }
      return line;
    }
    return {
      log: function (level, msg, data) { buf.append(fmt(level, msg, data)); },
      getText: function () { return buf.text(); },
      clear: function () { buf.clear(); },
    };
  }

  MM.createLogger = createLogger;
})();
