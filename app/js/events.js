/*
 * Frigate's live messages (ws://<frigate>:5000/ws). The 'reviews' topic carries
 * { type: 'new'|'update'|'end', before, after } for each review item; an item that is or becomes an
 * alert is reported once through onAlert(after).
 */
var FrigateEvents = (function () {
  var ws = null, url = '', onAlert = null, seen = {}, retry = null, delay = 2000;

  function start(wsUrl, callback) {
    stop();
    url = wsUrl;
    onAlert = callback;
    open();
  }

  function open() {
    if (!url) return;
    try { ws = new WebSocket(url); } catch (e) { return schedule(); }
    ws.onopen = function () { delay = 2000; };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || msg.topic !== 'reviews') return;
      var payload = msg.payload;
      if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (e) { return; } }
      handle(payload);
    };
    ws.onclose = function () { ws = null; schedule(); };
  }

  /** Reports an item the first time it is an alert: new as an alert, or a detection promoted to one. */
  function handle(p) {
    var after = p && p.after, before = p && p.before;
    if (!after || after.severity !== 'alert' || seen[after.id]) return false;
    if (p.type === 'new' || (p.type === 'update' && (!before || before.severity !== 'alert'))) {
      seen[after.id] = true;
      if (onAlert) onAlert(after);
      return true;
    }
    return false;
  }

  function schedule() {
    clearTimeout(retry);
    if (!url) return;
    retry = setTimeout(open, delay);
    delay = Math.min(delay * 2, 60000);
  }

  function stop() {
    url = '';
    clearTimeout(retry);
    if (ws) { ws.onclose = null; try { ws.close(); } catch (e) { /* closed */ } ws = null; }
  }

  return { start: start, stop: stop, _handle: handle, _reset: function (cb) { seen = {}; onAlert = cb; } };
})();

if (typeof module !== 'undefined') module.exports = FrigateEvents;
