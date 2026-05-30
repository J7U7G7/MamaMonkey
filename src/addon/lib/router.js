(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function createRouter() {
    const routes = {}; // path -> handler

    return {
      get(path, handler) {
        routes[path] = handler;
        return this;
      },
      dispatch(method, rawPath) {
        if (method !== 'GET') return null;
        const path = String(rawPath).split('?')[0];
        const handler = routes[path];
        if (!handler) return null;
        return handler();
      },
    };
  }

  MM.createRouter = createRouter;
})();
