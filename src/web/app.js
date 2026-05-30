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

  poll();
  setInterval(poll, POLL_MS);
})();
