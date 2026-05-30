(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function byteLen(s) {
    // UTF-8 byte length without Buffer (sandbox-safe).
    return unescape(encodeURIComponent(s)).length;
  }

  function createLogBuffer(opts) {
    const maxBytes = (opts && opts.maxBytes) || 64 * 1024;
    let lines = [];

    function bytes() {
      return byteLen(lines.join('\n'));
    }
    function trim() {
      // Drop oldest lines until within cap, but always keep at least one line.
      while (lines.length > 1 && bytes() > maxBytes) {
        lines.shift();
      }
    }
    return {
      append(line) {
        lines.push(String(line));
        trim();
      },
      text() {
        return lines.join('\n');
      },
      bytes,
      clear() {
        lines = [];
      },
    };
  }

  MM.createLogBuffer = createLogBuffer;
})();
