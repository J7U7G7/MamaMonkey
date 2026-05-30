(function () {
  'use strict';
  const MM = (globalThis.MamaMonkey = globalThis.MamaMonkey || {});

  function esc(v) {
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusPage(info) {
    const name = esc(info.name);
    const version = esc(info.version);
    const host = esc(info.host);
    const port = esc(info.port);
    return [
      '<!DOCTYPE html>',
      '<html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + name + '</title>',
      '<style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#111;color:#eee}',
      'h1{font-size:20px}.row{margin:8px 0}.k{color:#9af}button{font-size:16px;padding:10px 16px;margin-top:16px}',
      'a{color:#9af}</style></head><body>',
      '<h1>🐒 ' + name + '</h1>',
      '<div class="row"><span class="k">version</span> ' + version + '</div>',
      '<div class="row"><span class="k">host</span> ' + host + '</div>',
      '<div class="row"><span class="k">port</span> ' + port + '</div>',
      '<div class="row"><a href="/health">/health</a> · <a href="/logs">/logs</a></div>',
      '<button id="copy">Copy logs</button><pre id="out"></pre>',
      '<script>document.getElementById("copy").onclick=async function(){',
      'try{var t=await (await fetch("/logs")).text();await navigator.clipboard.writeText(t);',
      'document.getElementById("out").textContent="Copied "+t.length+" chars.";}',
      'catch(e){document.getElementById("out").textContent="Copy failed: "+e;}};</script>',
      '</body></html>',
    ].join('\n');
  }

  function healthBody(info) {
    return JSON.stringify({
      ok: true,
      name: info.name,
      version: info.version,
      port: info.port,
      time: info.time,
    });
  }

  MM.statusPage = statusPage;
  MM.healthBody = healthBody;
})();
