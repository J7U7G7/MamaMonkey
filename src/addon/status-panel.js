(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function mountStatusPanel(meta) {
    const bindings = MM.bindings;
    const logger = MM.logger || { log() {} };
    const info = bindings.getSharingInfo ? bindings.getSharingInfo() : { host: 'this-pc', port: 0 };
    const label = `MamaMonkey ${meta.version} — http://${info.host}:${info.port}/`;

    const ok = bindings.addStatusMenuItem({
      label: label,
      onClick: function () {
        logger.log('info', 'status menu opened', { host: info.host, port: info.port });
        try {
          // Best-effort: surface the URL however MM allows. Falls back to a log line.
          if (globalThis.alert) globalThis.alert(label);
        } catch (e) {}
      },
    });
    logger.log('info', 'status panel mounted', { ok: !!ok, label });
    return { mounted: !!ok, label };
  }

  MM.mountStatusPanel = mountStatusPanel;
})();
