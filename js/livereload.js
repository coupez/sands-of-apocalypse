// Live-reload client. Polls /__mtime; reloads the page when any source file
// changes. Over file:// there is no server, so it disables itself. Over http
// it retries forever (with light backoff) so it survives dev-server restarts.
(function () {
  if (location.protocol === 'file:') return; // no dev server possible
  var last = null;
  var fails = 0;
  function poll() {
    fetch('/__mtime', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        fails = 0;
        if (last === null) { last = d.mtime; }
        else if (d.mtime !== last) {
          console.log('[livereload] change detected, reloading…');
          location.reload();
        }
        setTimeout(poll, 900);
      })
      .catch(function () {
        // server momentarily down (e.g. restart) — keep trying with backoff
        fails++;
        setTimeout(poll, Math.min(900 + fails * 400, 3000));
      });
  }
  poll();
})();
