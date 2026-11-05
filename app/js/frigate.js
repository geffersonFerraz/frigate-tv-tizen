/*
 * Frigate HTTP API (port 5000, the unauthenticated internal port) and go2rtc (port 1984).
 * Live video comes from go2rtc as HLS; recordings and review clips from Frigate's /vod HLS.
 * Both play in the TV's native AVPlay.
 */
var Frigate = (function () {
  var base = '';
  var GO2RTC_PORT = 1984;
  // How live video is fetched from go2rtc: 'mse' (WebSocket, low delay) or 'hls'.
  var liveOpts = { mode: 'mse' };
  var TIMEOUT_MS = 10000;

  /** Translated message when the UI is loaded (I18n); the key itself in tests. */
  function tr(key, params) { return typeof I18n !== 'undefined' ? I18n.t(key, params) : key; }

  function setBase(url) { base = String(url || '').trim().replace(/\/+$/, ''); }
  function getBase() { return base; }

  function hostOf(url) {
    var m = /^https?:\/\/([^/:?#]+)/i.exec(url || '');
    return m ? m[1] : '';
  }

  function go2rtcBase() { return 'http://' + hostOf(base) + ':' + GO2RTC_PORT; }

  function request(method, path, body) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, base + path, true);
      xhr.timeout = TIMEOUT_MS;
      if (body) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(tr('error.http', { status: xhr.status, path: path })));
        try { resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null); } catch (e) { reject(new Error(tr('error.badResponse', { path: path }))); }
      };
      xhr.onerror = function () { reject(new Error(tr('error.offline', { url: base }))); };
      xhr.ontimeout = function () { reject(new Error(tr('error.timeout', { url: base }))); };
      xhr.send(body ? JSON.stringify(body) : null);
    });
  }

  function get(path) { return request('GET', path); }

  /* ---------- Matching cameras to go2rtc streams ---------- */

  /** rtsp://user:pass@host:554/path#opts -> rtsp://host:554/path (lower-case host). */
  function normalizeUrl(u) {
    var s = String(u || '').split('#')[0].trim();
    s = s.replace(/^([a-z0-9+.-]+:\/\/)[^@/]*@/i, '$1');
    var m = /^([a-z0-9+.-]+:\/\/)([^/]+)(.*)$/i.exec(s);
    return m ? m[1].toLowerCase() + m[2].toLowerCase() + m[3] : s;
  }

  /** rtsp://localhost:8554/<name> or 127.0.0.1:8554 -> <name> (a go2rtc restream). */
  function restreamName(u) {
    var m = /^rtsp:\/\/(?:[^@/]*@)?(?:localhost|127\.0\.0\.1):8554\/([^?#/]+)/i.exec(String(u || ''));
    return m ? decodeURIComponent(m[1]) : null;
  }

  /**
   * The go2rtc stream names to use for a camera: { main, sub } (either may be null).
   * Tries, in order: the camera's live.streams that exist in go2rtc; a record/detect input that is
   * a go2rtc restream; a go2rtc stream whose source is the same camera URL; the camera's own name.
   */
  function resolveStreams(name, cam, streams) {
    streams = streams || {};
    var has = function (n) { return !!n && Object.prototype.hasOwnProperty.call(streams, n); };
    var withSub = function (main, sub) {
      if (!sub && has(main + '_sub')) sub = main + '_sub';
      // cam_yard_indoor -> cam_yard_sub
      var stem = main.replace(/_[^_]+$/, '');
      if (!sub && stem !== main && has(stem + '_sub')) sub = stem + '_sub';
      return { main: main, sub: sub && sub !== main ? sub : null };
    };

    var live = (cam.live && cam.live.streams) || {};
    var liveNames = Object.keys(live).map(function (k) { return live[k]; }).filter(has);
    if (liveNames.length) return withSub(liveNames[0], liveNames[1]);

    var inputs = (cam.ffmpeg && cam.ffmpeg.inputs) || [];
    var ordered = inputs.slice().sort(function (a, b) {
      return rolesRank(a.roles) - rolesRank(b.roles);
    });

    var restreams = ordered.map(function (i) { return restreamName(i.path); }).filter(has);
    if (restreams.length) return withSub(restreams[0], restreams[1]);

    for (var i = 0; i < ordered.length; i++) {
      var want = normalizeUrl(ordered[i].path);
      var found = findBySource(want, streams);
      if (found) return withSub(found, null);
    }

    if (has(name)) return withSub(name, null);
    return { main: null, sub: null };
  }

  function rolesRank(roles) {
    roles = roles || [];
    if (roles.indexOf('record') >= 0) return 0;
    if (roles.indexOf('detect') >= 0) return 1;
    return 2;
  }

  function findBySource(url, streams) {
    var names = Object.keys(streams);
    for (var i = 0; i < names.length; i++) {
      var producers = (streams[names[i]] && streams[names[i]].producers) || [];
      for (var j = 0; j < producers.length; j++) {
        if (producers[j] && normalizeUrl(producers[j].url) === url) return names[i];
      }
    }
    return null;
  }

  /* ---------- Model ---------- */

  /**
   * Cameras in the UI's order, enabled only:
   * [{ name, title, live: { main, sub }, width, height }], plus birdseye info.
   */
  function buildModel(config, streams) {
    var cams = config.cameras || {};
    var list = Object.keys(cams).filter(function (n) {
      var c = cams[n];
      return c.enabled !== false && !(c.ui && c.ui.dashboard === false);
    }).map(function (n, idx) {
      var c = cams[n];
      return {
        name: n,
        title: c.friendly_name || n,
        order: (c.ui && c.ui.order) || 0,
        idx: idx,
        live: resolveStreams(n, c, streams),
        record: !!(c.record && c.record.enabled)
      };
    });
    list.sort(function (a, b) { return a.order - b.order || a.idx - b.idx; });
    var bird = config.birdseye || {};
    var birdStream = bird.enabled && bird.restream && streams && streams.birdseye ? 'birdseye' : null;
    return { cameras: list, birdseye: { enabled: !!bird.enabled, stream: birdStream } };
  }

  function load() {
    return Promise.all([get('/api/config'), get('/api/go2rtc/streams').catch(function () { return {}; })])
      .then(function (r) { return buildModel(r[0], r[1]); });
  }

  /* ---------- URLs ---------- */

  function enc(s) { return encodeURIComponent(s); }

  function setLive(opts) {
    liveOpts = { mode: opts && opts.mode === 'hls' ? 'hls' : 'mse' };
  }

  function liveMode() { return liveOpts.mode; }

  /** Frigate's own live messages (review items as they happen). */
  function eventsUrl() { return base.replace(/^http/, 'ws') + '/ws'; }

  /** Live URL for a go2rtc stream: its MSE WebSocket, or its HLS playlist (mode overrides the setting). */
  function liveUrl(stream, mode) {
    if ((mode || liveOpts.mode) === 'mse') return go2rtcBase().replace(/^http/, 'ws') + '/api/ws?src=' + enc(stream);
    return go2rtcBase() + '/api/stream.m3u8?src=' + enc(stream);
  }

  function snapshotUrl(camera, height) {
    return base + '/api/' + enc(camera) + '/latest.jpg?h=' + (height || 270) + '&_=' + Date.now();
  }

  function vodUrl(camera, start, end) {
    return base + '/vod/' + enc(camera) + '/start/' + Math.floor(start) + '/end/' + Math.ceil(end) + '/master.m3u8';
  }

  function thumbUrl(review) {
    var p = String(review.thumb_path || '').replace(/^\/media\/frigate/, '');
    return p ? base + p : '';
  }

  /* ---------- Review / recordings ---------- */

  function reviews(opts) {
    var q = ['limit=' + (opts.limit || 40)];
    if (opts.severity) q.push('severity=' + enc(opts.severity));
    if (opts.cameras) q.push('cameras=' + enc(opts.cameras.join(',')));
    if (opts.before) q.push('before=' + Math.ceil(opts.before));
    if (opts.after) q.push('after=' + Math.floor(opts.after));
    return get('/api/review?' + q.join('&'));
  }

  function markViewed(ids) {
    if (!ids.length) return Promise.resolve();
    return request('POST', '/api/reviews/viewed', { ids: ids }).catch(function () { /* not critical */ });
  }

  /** [{ day: 'YYYY-MM-DD', events, hours: [{ hour: 'HH', events, duration }] }], newest first. */
  function recordingDays(camera, timezone) {
    return get('/api/' + enc(camera) + '/recordings/summary?timezone=' + enc(timezone || 'UTC'));
  }

  return {
    setBase: setBase, getBase: getBase, load: load, setLive: setLive, liveMode: liveMode,
    liveUrl: liveUrl, eventsUrl: eventsUrl, snapshotUrl: snapshotUrl, vodUrl: vodUrl, thumbUrl: thumbUrl,
    reviews: reviews, markViewed: markViewed, recordingDays: recordingDays,
    // exposed for tests
    _normalizeUrl: normalizeUrl, _resolveStreams: resolveStreams, _buildModel: buildModel, _hostOf: hostOf
  };
})();

if (typeof module !== 'undefined') module.exports = Frigate;
