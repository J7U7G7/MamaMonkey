(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function createLogger(opts) {
    const buf = MM.createLogBuffer({ maxBytes: (opts && opts.maxBytes) || 64 * 1024 });
    const bindings = MM.bindings || {};
    let seq = 0;

    function fmt(level, msg, data) {
      seq += 1;
      let line = `#${seq} [${level}] ${msg}`;
      if (data !== undefined) {
        try { line += ' ' + JSON.stringify(data); } catch (e) { line += ' [unserializable]'; }
      }
      return line;
    }

    return {
      log(level, msg, data) {
        const line = fmt(level, msg, data);
        buf.append(line);
        try { bindings.appendLogFile && bindings.appendLogFile(line); } catch (e) { /* never crash on logging */ }
      },
      getText() {
        return buf.text();
      },
      clear() {
        buf.clear();
      },
    };
  }

  MM.createLogger = createLogger;
})();
