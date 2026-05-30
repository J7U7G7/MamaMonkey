(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});
  const TARGET = 'mamamonkey';

  function createCommandDispatcher(handlers) {
    return {
      TARGET: TARGET,
      // handle(requestBodyString) -> Promise<{handled:boolean, response:object|null}>
      handle: function (requestBodyString) {
        var req;
        try {
          req = JSON.parse(requestBodyString);
        } catch (e) {
          return Promise.resolve({ handled: false, response: { ok: false, error: 'invalid json' } });
        }
        if (!req || req.target !== TARGET) {
          return Promise.resolve({ handled: false, response: null });
        }
        var fn = handlers[req.command];
        if (typeof fn !== 'function') {
          return Promise.resolve({ handled: true, response: { ok: false, command: req.command, error: 'unknown command: ' + req.command } });
        }
        var parse = (typeof _hostJSONParse === 'function') ? _hostJSONParse : JSON.parse;  // jshint ignore:line
        return Promise.resolve()
          .then(function () { return fn(req.args || {}); })
          .then(
            function (result) {
              return parse(JSON.stringify({ handled: true, response: { ok: true, command: req.command, result: result === undefined ? null : result } }));
            },
            function (err) {
              return parse(JSON.stringify({ handled: true, response: { ok: false, command: req.command, error: String((err && err.message) || err) } }));
            }
          );
      },
    };
  }

  MM.createCommandDispatcher = createCommandDispatcher;
})();
