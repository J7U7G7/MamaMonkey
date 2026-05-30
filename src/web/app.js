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
      row.querySelector('.qt').textContent = it.title || '—';
      row.querySelector('.qa').textContent = it.artist || '';
      row.onclick = function () { cmd('jump', { index: i }).then(poll); };
      panel.appendChild(row);
    });
  }
  function refreshQueue() { cmd('queue').then(function (st) { if (st && st.ok && st.result) renderQueue(st.result); }).catch(function () {}); }

  function render(st) {
    if (!st || !st.ok || !st.result || !st.result.available) { $('status').textContent = 'MediaMonkey not reachable'; return; }
    var r = st.result;
    $('title').textContent = (r.track && r.track.title) || '—';
    $('artist').textContent = (r.track && r.track.artist) || '—';
    $('album').textContent = (r.track && r.track.album) || '—';
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
    ['now','lib','pls'].forEach(function (t) { $('view-' + t).hidden = (t !== tab); });
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    if (tab === 'lib' && !libList.dataset.loaded) loadLib('all', '');
    if (tab === 'pls') loadPlaylists();
  }
  document.querySelectorAll('.tab').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });

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
  function rowEl(main, sub, onTap, onMore, isCur) {
    var row = document.createElement('div'); row.className = 'row' + (isCur ? ' cur' : '');
    row.innerHTML = '<div class="main"><div class="t"></div><div class="s"></div></div>';
    row.querySelector('.t').textContent = main || '—'; row.querySelector('.s').textContent = sub || '';
    row.querySelector('.main').onclick = onTap;
    if (onMore) { var m = document.createElement('div'); m.className = 'more'; m.textContent = '⋯'; m.onclick = function (e) { e.stopPropagation(); onMore(); }; row.appendChild(m); }
    return row;
  }
  function renderLib(res) {
    libList.innerHTML = ''; libToken = res.token; libKind = res.kind;
    (res.items || []).forEach(function (it) {
      if (res.kind === 'tracks') {
        libList.appendChild(rowEl(it.title, it.artist + (it.album ? ' · ' + it.album : ''),
          function () { playSheet(res.token, it.index); }, function () { playSheet(res.token, it.index); }));
      } else {
        libList.appendChild(rowEl(it.name, res.kind.slice(0, -1),
          function () { cmd('open', { token: res.token, index: it.index }).then(renderLib); },
          function () { cmd('open', { token: res.token, index: it.index }).then(function (r) { playSheet(r.token); }); }));
      }
    });
    libList.dataset.loaded = '1';
  }
  function loadLib(view, q) { libView = view; cmd('lib', { view: view, q: q || undefined }).then(renderLib); }
  document.querySelectorAll('.seg[data-view]').forEach(function (b) {
    b.onclick = function () { document.querySelectorAll('.seg[data-view]').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); loadLib(b.dataset.view, search.value); };
  });
  var searchT; search.oninput = function () { clearTimeout(searchT); searchT = setTimeout(function () { loadLib(libView, search.value); }, 350); };

  // ---------- playlists ----------
  var plsList = $('plsList');
  function loadPlaylists() {
    cmd('playlists').then(function (res) {
      plsList.innerHTML = '';
      (res.items || []).forEach(function (p) {
        plsList.appendChild(rowEl(p.title, p.isFolder ? 'folder' : 'playlist',
          function () { openPlaylist(p); },
          function () {
            sheet([
              { label: '▶ Play', fn: function () { cmd('playlistTracks', { id: p.id }).then(function (r) { cmd('play', { token: r.token, mode: 'now' }).then(function () { showTab('now'); poll(); }); }); } },
              { label: '✏️ Rename', fn: function () { var n = prompt('New name', p.title); if (n) cmd('playlistRename', { id: p.id, name: n }).then(loadPlaylists); } },
              { label: '🗑 Delete', fn: function () { if (confirm('Delete "' + p.title + '"?')) cmd('playlistDelete', { id: p.id }).then(loadPlaylists); } },
              { label: 'Cancel', cancel: true },
            ]);
          }));
      });
    });
  }
  function openPlaylist(p) {
    cmd('playlistTracks', { id: p.id }).then(function (res) {
      plsList.innerHTML = '';
      var back = rowEl('‹ ' + p.title, 'tap a track to play', loadPlaylists, null); plsList.appendChild(back);
      (res.items || []).forEach(function (it) {
        plsList.appendChild(rowEl(it.title, it.artist,
          function () { cmd('play', { token: res.token, index: it.index, mode: 'now' }).then(function () { showTab('now'); poll(); }); },
          function () {
            sheet([
              { label: '🗑 Remove from playlist', fn: function () { cmd('playlistRemove', { id: p.id, trackIndex: it.index }).then(function () { openPlaylist(p); }); } },
              { label: 'Cancel', cancel: true },
            ]);
          }));
      });
    });
  }
  $('newPls').onclick = function () { var n = prompt('Playlist name'); if (n) cmd('playlistCreate', { name: n }).then(loadPlaylists); };

  // add-to-playlist: pick a playlist then add the cached token
  function addToPlaylistFlow(token) {
    cmd('playlists').then(function (res) {
      var opts = (res.items || []).filter(function (p) { return !p.isFolder; }).map(function (p) {
        return { label: p.title, fn: function () { cmd('playlistAdd', { id: p.id, token: token }); } };
      });
      opts.push({ label: 'Cancel', cancel: true });
      sheet(opts);
    });
  }

  poll();
  setInterval(function(){ if (activeTab==='now') poll(); }, POLL_MS);
})();
