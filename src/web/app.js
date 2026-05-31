(function () {
  'use strict';
  var POLL_MS = 1000;
  var $ = function (id) { return document.getElementById(id); };
  var dragging = false;
  var artKey = null;      // trackKey whose art is currently shown
  var repeatMode = 'off'; // off | all | one
  var queueOpen = false;
  var lastQueueKey = null;

  function fmt(ms) {
    if (!ms || ms < 0) return '0:00';
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    s = s % 60; return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function cmd(command, args) {
    return fetch('/api/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'mamamonkey', command: command, args: args || {} }),
    }).then(function (r) { return r.json(); });
  }

  function setArt(dataUrl) {
    var img = $('art'), ph = $('artph');
    if (dataUrl) { img.src = dataUrl; img.hidden = false; ph.hidden = true; }
    else { img.hidden = true; ph.hidden = false; }
  }
  function refreshArt(key) {
    cmd('getArt').then(function (st) {
      if (st && st.ok && st.result && st.result.available && st.result.dataUrl) { artKey = key; setArt(st.result.dataUrl); }
      else { artKey = key; setArt(null); }
    }).catch(function () {});
  }

  function renderModes(r) {
    $('shuffle').classList.toggle('on', !!r.shuffle);
    repeatMode = r.repeatOne ? 'one' : (r.repeatAll ? 'all' : 'off');
    var rb = $('repeat');
    rb.textContent = repeatMode === 'one' ? '🔂' : '🔁';
    rb.classList.toggle('on', repeatMode !== 'off');
  }

  function renderQueue(q) {
    var panel = $('queuePanel');
    panel.innerHTML = '';
    (q.items || []).forEach(function (it, i) {
      var row = document.createElement('div');
      row.className = 'qrow' + (i === q.index ? ' cur' : '');
      row.innerHTML = '<span class="qi">' + (i + 1) + '</span><span><div class="qt"></div><div class="qa"></div></span>';
      row.querySelector('.qt').textContent = dec(it.title) || '—';
      row.querySelector('.qa').textContent = dec(it.artist);
      row.onclick = function () { cmd('jump', { index: i }).then(poll); };
      panel.appendChild(row);
    });
  }
  function refreshQueue() { cmd('queue').then(function (st) { if (st && st.ok && st.result) renderQueue(st.result); }).catch(function () {}); }

  function render(st) {
    if (!st || !st.ok || !st.result || !st.result.available) { $('status').textContent = 'MediaMonkey not reachable'; return; }
    var r = st.result;
    $('title').textContent = dec(r.track && r.track.title) || '—';
    $('artist').textContent = dec(r.track && r.track.artist) || '—';
    $('album').textContent = dec(r.track && r.track.album) || '—';
    var playing = r.isPlaying && !r.paused;
    $('playpause').textContent = playing ? '⏸' : '▶';
    if (r.durationMs) {
      $('bar').style.width = Math.min(100, (100 * (r.positionMs || 0) / r.durationMs)) + '%';
      $('pos').textContent = fmt(r.positionMs); $('dur').textContent = fmt(r.durationMs);
    }
    if (!dragging && typeof r.volume === 'number') $('vol').value = r.volume;
    renderModes(r);
    if (r.trackKey !== artKey) refreshArt(r.trackKey);
    if (queueOpen && r.trackKey !== lastQueueKey) { lastQueueKey = r.trackKey; refreshQueue(); }
    $('status').textContent = '';
  }
  function poll() { cmd('status').then(render).catch(function () { $('status').textContent = 'offline'; }); }

  $('prev').onclick = function () { cmd('prev').then(poll); };
  $('next').onclick = function () { cmd('next').then(poll); };
  $('playpause').onclick = function () { cmd('playpause').then(poll); };
  $('shuffle').onclick = function () { cmd('setShuffle', { on: !$('shuffle').classList.contains('on') }).then(poll); };
  $('repeat').onclick = function () {
    var next = repeatMode === 'off' ? 'all' : (repeatMode === 'all' ? 'one' : 'off');
    cmd('setRepeat', { mode: next }).then(poll);
  };
  $('queueBtn').onclick = function () {
    queueOpen = !queueOpen;
    $('queuePanel').hidden = !queueOpen;
    $('queueBtn').classList.toggle('on', queueOpen);
    if (queueOpen) refreshQueue();
  };
  $('progress').onclick = function (e) {
    var rect = this.getBoundingClientRect();
    var frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    cmd('status').then(function (st) {
      var dur = st && st.result && st.result.durationMs;
      if (dur) cmd('seek', { ms: Math.round(frac * dur) }).then(poll);
    });
  };
  var vol = $('vol');
  vol.addEventListener('input', function () { dragging = true; });
  vol.addEventListener('change', function () { cmd('setVolume', { value: Number(vol.value) }).then(function () { dragging = false; poll(); }); });

  // ---------- tabs ----------
  var activeTab = 'now';
  function showTab(tab) {
    activeTab = tab;
    ['now','lib','pls','set'].forEach(function (t) { $('view-' + t).hidden = (t !== tab); });
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    if (tab === 'lib' && !libList.dataset.loaded) loadLib('all', '');
    if (tab === 'pls') loadPlaylists();
    if (tab === 'set') loadSettings();
  }
  document.querySelectorAll('.tab').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });

  // The companion relays the addon's {ok,command,result} envelope; Phase 3 data is under .result.
  function unwrap(env) { return (env && env.result) || {}; }

  // Some MM tag strings come HTML-escaped (e.g. "&amp;"); decode for display.
  var _decEl = document.createElement('textarea');
  function dec(s) { if (s == null) return ''; _decEl.innerHTML = String(s); return _decEl.value; }

  // ---------- action sheet ----------
  function sheet(options) {
    var s = $('sheet'); s.innerHTML = '';
    var card = document.createElement('div'); card.className = 'card';
    options.forEach(function (o) {
      var btn = document.createElement('button'); btn.textContent = o.label; if (o.cancel) btn.className = 'cancel';
      btn.onclick = function () { s.hidden = true; if (o.fn) o.fn(); }; card.appendChild(btn);
    });
    s.appendChild(card); s.hidden = false;
    s.onclick = function (e) { if (e.target === s) s.hidden = true; };
  }
  function playSheet(token, index, extra) {
    var opts = [
      { label: '▶ Play now', fn: function () { cmd('play', { token: token, index: index, mode: 'now' }).then(function () { showTab('now'); poll(); }); } },
      { label: '⏭ Play next', fn: function () { cmd('play', { token: token, index: index, mode: 'next' }); } },
      { label: '➕ Add to queue', fn: function () { cmd('play', { token: token, index: index, mode: 'queue' }); } },
      { label: '＋ Add to playlist', fn: function () { addToPlaylistFlow(token); } },
    ];
    (extra || []).forEach(function (e) { opts.push(e); });
    opts.push({ label: 'Cancel', cancel: true });
    sheet(opts);
  }

  // ---------- library ----------
  var libList = $('libList'), search = $('search');
  var libView = 'all', libToken = null, libKind = 'tracks';
  var libReq = null;     // {command, args} that produced the current list (for "load more")
  var libRendered = 0;   // number of item rows currently shown
  function rowEl(main, sub, onTap, onMore, isCur) {
    var row = document.createElement('div'); row.className = 'row' + (isCur ? ' cur' : '');
    row.innerHTML = '<div class="main"><div class="t"></div><div class="s"></div></div>';
    row.querySelector('.t').textContent = dec(main) || '—'; row.querySelector('.s').textContent = dec(sub);
    row.querySelector('.main').onclick = onTap;
    if (onMore) { var m = document.createElement('div'); m.className = 'more'; m.textContent = '⋯'; m.onclick = function (e) { e.stopPropagation(); onMore(); }; row.appendChild(m); }
    return row;
  }
  function libRow(it, kind, token) {
    if (kind === 'tracks') {
      return rowEl(it.title, it.artist + (it.album ? ' · ' + it.album : ''),
        function () { playSheet(token, it.index); }, function () { playSheet(token, it.index); });
    }
    return rowEl(it.name + (it.artist ? ' · ' + it.artist : ''), kind.slice(0, -1),
      function () { libReq = { command: 'libTracks', args: { by: it.by, value: it.value } }; cmd('libTracks', libReq.args).then(renderLib); },
      function () { cmd('libTracks', { by: it.by, value: it.value }).then(function (r) { playSheet(unwrap(r).token); }); });
  }
  function renderLib(env, append) {
    var res = unwrap(env);
    libToken = res.token; libKind = res.kind;
    var old = document.getElementById('loadMore'); if (old) old.remove();
    if (!append) { libList.innerHTML = ''; libRendered = 0; }
    if (res.error) { libList.appendChild(rowEl('Indisponible', String(res.error), function () {}, null)); return; }
    (res.items || []).forEach(function (it) { libList.appendChild(libRow(it, res.kind, res.token)); });
    libRendered += (res.items || []).length;
    if (res.truncated && libReq) {
      var more = document.createElement('div'); more.id = 'loadMore'; more.className = 'row';
      more.innerHTML = '<div class="main"><div class="t">↓ Charger plus… (' + libRendered + '/' + res.total + ')</div></div>';
      more.onclick = function () {
        var args = Object.assign({}, libReq.args, { offset: libRendered });
        cmd(libReq.command, args).then(function (r) { renderLib(r, true); });
      };
      libList.appendChild(more);
    }
    libList.dataset.loaded = '1';
  }
  function loadLib(view, q) { libView = view; libReq = { command: 'lib', args: { view: view, q: q || undefined } }; cmd('lib', libReq.args).then(renderLib); }
  document.querySelectorAll('.seg[data-view]').forEach(function (b) {
    b.onclick = function () { document.querySelectorAll('.seg[data-view]').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); loadLib(b.dataset.view, search.value); };
  });
  var searchT; search.oninput = function () { clearTimeout(searchT); searchT = setTimeout(function () { loadLib(libView, search.value); }, 350); };

  // Play / shuffle the current result set (tracks). On a browse list, play the whole library.
  function playCurrent(shuffle) {
    function go(token) {
      if (!token) return;
      cmd('play', { token: token, mode: 'now' })
        .then(function () { return shuffle ? cmd('setShuffle', { on: true }) : null; })
        .then(function () { showTab('now'); poll(); });
    }
    if (libToken && libKind === 'tracks') go(libToken);
    else cmd('lib', { view: 'all' }).then(function (env) { go(unwrap(env).token); });
  }
  $('playAll').onclick = function () { playCurrent(false); };
  $('shuffleAll').onclick = function () { playCurrent(true); };

  // ---------- playlists ----------
  var plsList = $('plsList');
  function loadPlaylists() {
    cmd('playlists').then(function (env) {
      var res = unwrap(env);
      plsList.innerHTML = '';
      (res.items || []).forEach(function (p) {
        plsList.appendChild(rowEl(p.title, p.isFolder ? 'folder' : 'playlist',
          function () { openPlaylist(p); },
          function () {
            sheet([
              { label: '▶ Play', fn: function () { cmd('playlistTracks', { id: p.id }).then(function (r) { cmd('play', { token: unwrap(r).token, mode: 'now' }).then(function () { showTab('now'); poll(); }); }); } },
              { label: '✏️ Rename', fn: function () { var n = prompt('New name', p.title); if (n) cmd('playlistRename', { id: p.id, name: n }).then(loadPlaylists); } },
              { label: '🗑 Delete', fn: function () { if (confirm('Delete "' + p.title + '"?')) cmd('playlistDelete', { id: p.id }).then(loadPlaylists); } },
              { label: 'Cancel', cancel: true },
            ]);
          }));
      });
    });
  }
  function openPlaylist(p) {
    cmd('playlistTracks', { id: p.id }).then(function (env) {
      var res = unwrap(env);
      var count = res.total || (res.items || []).length;
      plsList.innerHTML = '';
      var back = rowEl('‹ ' + p.title, 'taper = lire · ⋯ = réordonner / retirer', loadPlaylists, null); plsList.appendChild(back);
      (res.items || []).forEach(function (it) {
        plsList.appendChild(rowEl(it.title, it.artist,
          function () { cmd('play', { token: res.token, index: it.index, mode: 'now' }).then(function () { showTab('now'); poll(); }); },
          function () {
            var opts = [];
            if (it.index > 0) opts.push({ label: '↑ Monter', fn: function () { cmd('playlistReorder', { id: p.id, from: it.index, to: it.index - 1 }).then(function () { openPlaylist(p); }); } });
            if (it.index < count - 1) opts.push({ label: '↓ Descendre', fn: function () { cmd('playlistReorder', { id: p.id, from: it.index + 1, to: it.index }).then(function () { openPlaylist(p); }); } });
            opts.push({ label: '🗑 Retirer de la playlist', fn: function () { cmd('playlistRemove', { id: p.id, trackIndex: it.index }).then(function () { openPlaylist(p); }); } });
            opts.push({ label: 'Annuler', cancel: true });
            sheet(opts);
          }));
      });
    });
  }
  $('newPls').onclick = function () { var n = prompt('Playlist name'); if (n) cmd('playlistCreate', { name: n }).then(loadPlaylists); };

  // add-to-playlist: pick a playlist then add the cached token
  function addToPlaylistFlow(token) {
    cmd('playlists').then(function (env) {
      var res = unwrap(env);
      var opts = (res.items || []).filter(function (p) { return !p.isFolder; }).map(function (p) {
        return { label: p.title, fn: function () { cmd('playlistAdd', { id: p.id, token: token }); } };
      });
      opts.push({ label: 'Cancel', cancel: true });
      sheet(opts);
    });
  }

  // ---------- settings (talks to the companion's /api/config, not the addon) ----------
  function loadSettings() {
    $('setStatus').textContent = '';
    fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
      $('setMmPort').value = c.mmPort != null ? c.mmPort : '';
      $('setMmHost').value = c.mmHost != null ? c.mmHost : '';
      $('setServePort').value = c.servePort != null ? c.servePort : '';
      $('setInfo').textContent = 'Companion ' + (c.version || '') + ' · ouvre http://mamamonkey.local:' + c.servePort;
    }).catch(function () { $('setStatus').textContent = 'Companion injoignable'; });
  }
  $('setSave').onclick = function () {
    var patch = {
      mmHost: $('setMmHost').value.trim(),
      mmPort: Number($('setMmPort').value) || undefined,
      servePort: Number($('setServePort').value) || undefined,
    };
    $('setStatus').textContent = 'Enregistrement…';
    fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      .then(function (r) { return r.json(); })
      .then(function (res) { $('setStatus').textContent = res.restartNeeded ? '✓ Enregistré — redémarre le companion pour le nouveau port.' : '✓ Enregistré.'; })
      .catch(function () { $('setStatus').textContent = 'Échec de l\'enregistrement'; });
  };

  poll();
  setInterval(function(){ if (activeTab==='now') poll(); }, POLL_MS);
})();
