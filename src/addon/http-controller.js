(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function nowISO() {
    // Date is available in MM's browser env; tests don't assert on its value.
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

  function startHttp(meta) {
    const bindings = MM.bindings;
    const logger = MM.logger || { log() {}, getText: () => '' };
    const info = bindings.getSharingInfo ? bindings.getSharingInfo() : { host: 'this-pc', port: 0 };

    const router = MM.createRouter();
    router.get('/', () =>
      ({ status: 200, contentType: 'text/html; charset=utf-8',
         body: MM.statusPage({ name: meta.name, version: meta.version, host: info.host, port: info.port }) }));
    router.get('/health', () =>
      ({ status: 200, contentType: 'application/json',
         body: MM.healthBody({ name: meta.name, version: meta.version, port: info.port, time: nowISO() }) }));
    router.get('/logs', () =>
      ({ status: 200, contentType: 'text/plain; charset=utf-8', body: logger.getText() }));

    const onRequest = (req) => router.dispatch(req.method, req.path);
    const result = bindings.registerHttpHandler(onRequest);
    logger.log('info', 'http handler registered', { result, host: info.host, port: info.port });
    return { router, info };
  }

  MM.startHttp = startHttp;
})();
