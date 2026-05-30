(function () {
  'use strict';
  var POLL_MS = 1000;
  var $ = function (id) { return document.getElementById(id); };
  var dragging = false;

  function fmt(ms) {
    if (!ms || ms < 0) return '0:00';
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function cmd(command, args) {
    return fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'mamamonkey', command: command, args: args || {} }),
    }).then(function (r) { return r.json(); });
  }

  function render(st) {
    if (!st || !st.ok || !st.result || !st.result.available) {
      $('status').textContent = 'MediaMonkey not reachable';
      return;
    }
    var r = st.result;
    $('title').textContent = (r.track && r.track.title) || '—';
    $('artist').textContent = (r.track && r.track.artist) || '—';
    $('album').textContent = (r.track && r.track.album) || '—';
    $('playpause').textContent = r.isPlaying ? '⏸' : '▶';
    if (r.durationMs) {
      $('bar').style.width = Math.min(100, (100 * (r.positionMs || 0) / r.durationMs)) + '%';
      $('pos').textContent = fmt(r.positionMs); $('dur').textContent = fmt(r.durationMs);
    }
    if (!dragging && typeof r.volume === 'number') $('vol').value = r.volume;
    $('status').textContent = '';
  }

  function poll() { cmd('status').then(render).catch(function () { $('status').textContent = 'offline'; }); }

  $('prev').onclick = function () { cmd('prev').then(poll); };
  $('next').onclick = function () { cmd('next').then(poll); };
  $('playpause').onclick = function () { cmd('playpause').then(poll); };
  var vol = $('vol');
  vol.addEventListener('input', function () { dragging = true; });
  vol.addEventListener('change', function () { cmd('setVolume', { value: Number(vol.value) }).then(function () { dragging = false; poll(); }); });

  poll();
  setInterval(poll, POLL_MS);
})();
