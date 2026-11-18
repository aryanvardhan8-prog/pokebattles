// DailyBattles: unpacks saved data handed over from the old address (pokebattles1 → dailybattles), before the game starts.
// The old site sends people to the same page here with #move=<data>. Keys already saved here are never overwritten.
(function () {
  var h = location.hash;
  if (h.indexOf('#move=') !== 0) return;
  window.__moving = true;
  var raw = h.slice(6), kind = raw[0], b64 = raw.slice(1).replace(/-/g, '+').replace(/_/g, '/');
  var bytes = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
  var text = kind === 'z' && window.DecompressionStream
    ? new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
    : Promise.resolve(new TextDecoder().decode(bytes));
  text.then(function (t) {
    var data = JSON.parse(t);
    for (var k in data) { try { if (localStorage.getItem(k) === null) localStorage.setItem(k, data[k]); } catch (e) { /* full / blocked */ } }
  }).catch(function () {}).then(function () {
    location.replace(location.pathname + location.search);
  });
})();
