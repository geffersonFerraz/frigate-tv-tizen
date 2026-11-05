/* Screens, remote control and the flow between live video, review clips and recordings. */
(function () {
  var K = Keys.codes;
  var URL_KEY = 'frigatetv.url';
  var LIVE_KEY = 'frigatetv.live';
  var PREFS_KEY = 'frigatetv.prefs';    // per-camera choices: { sub: {id: bool}, videoOnly: {stream: time}, last: id }
  var MODEL_KEY = 'frigatetv.model';    // the last camera list, to show the menu at once on start
  var VIDEO_ONLY_DAYS = 7;              // forget "this camera has no audio" after a week (mic may be enabled)
  var HLS_HOURS = 12;                   // cameras whose MSE gave no video play over HLS for this long
  var IME_DONE = 65376, IME_CANCEL = 65385;

  function $(id) { return document.getElementById(id); }

  var model = null;         // { cameras, birdseye } from Frigate.load()
  var state = 'start';      // start | home | live | vod | recordings | settings
  var grid = null;          // Focus.Grid of the visible screen
  var actions = {};         // tile key -> function run on OK
  var homeKey = null;       // key of the home tile to focus again on return
  var recKey = null;
  var snapTimer = null;

  var t = I18n.t;

  /* ---------- Remembered choices ---------- */

  var prefs = loadPrefs();

  function loadPrefs() {
    var p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { /* defaults */ }
    p.sub = p.sub || {};
    p.videoOnly = p.videoOnly || {};
    p.hls = p.hls || {};
    return p;
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* storage unavailable */ }
  }

  function useSub(source) { return !!(source.sub && prefs.sub[source.id]); }

  /** How this camera's live video is fetched: the setting, or HLS while its MSE is known not to work. */
  function liveModeFor(source) {
    var at = prefs.hls[source.id];
    return at && Date.now() - at < HLS_HOURS * 3600000 ? 'hls' : Frigate.liveMode();
  }

  function isVideoOnly(stream) {
    var at = prefs.videoOnly[stream];
    return !!at && Date.now() - at < VIDEO_ONLY_DAYS * 86400000;
  }

  /* ---------- Formatting ---------- */

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function hhmmss(d) { return hhmm(d) + ':' + pad(d.getSeconds()); }
  function sameDay(a, b) { return a.toDateString() === b.toDateString(); }

  function dayLabel(d) {
    var today = new Date(), yest = new Date(Date.now() - 86400000);
    if (sameDay(d, today)) return t('day.today');
    if (sameDay(d, yest)) return t('day.yesterday');
    return I18n.date(d);
  }

  function whenLabel(ts) {
    var d = new Date(ts * 1000), mins = Math.floor((Date.now() / 1000 - ts) / 60);
    if (mins < 1) return t('when.now');
    if (mins < 60) return t('when.minAgo', { n: mins });
    if (sameDay(d, new Date())) return t('when.today', { time: hhmm(d) });
    return t('when.other', { day: dayLabel(d), time: hhmm(d) });
  }

  function objectsLabel(review) {
    var data = review.data || {};
    var names = (data.sub_labels && data.sub_labels.length ? data.sub_labels : data.objects) || [];
    var seen = {};
    return names.map(function (o) { return I18n.label(o); })
      .filter(function (o) { return seen[o] ? false : (seen[o] = true); }).join(', ') || t('review.motion');
  }

  function cameraTitle(name) {
    var c = model && model.cameras.filter(function (x) { return x.name === name; })[0];
    return c ? c.title : name;
  }

  function timezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
  }

  /* ---------- Screens, toast, clock ---------- */

  function show(id) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.toggle('hidden', screens[i].id !== id);
  }

  var toastTimer = null;
  function toast(msg) {
    var box = $('toast');
    box.textContent = msg;
    box.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.add('hidden'); }, 4000);
  }

  function tickClock() {
    var s = hhmm(new Date()), els = document.querySelectorAll('.clock');
    for (var i = 0; i < els.length; i++) els[i].textContent = s;
  }

  /* ---------- Tiles and focus ---------- */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /** opts: { key, cls, img, cam, tag, tagCls, name, info, unseen, onSelect } */
  function tile(opts) {
    var card = el('div', 'tile ' + (opts.cls || ''));
    card.setAttribute('data-key', opts.key);
    var thumb = el('div', 'thumb', opts.glyph || null);
    if (opts.img) {
      var img = el('img');
      img.src = opts.img;
      if (opts.cam) img.setAttribute('data-cam', opts.cam);
      img.onerror = function () { img.style.visibility = 'hidden'; };
      thumb.appendChild(img);
    }
    if (opts.tag) thumb.appendChild(el('span', 'tag ' + (opts.tagCls || ''), opts.tag));
    if (opts.unseen) thumb.appendChild(el('span', 'unseen'));
    card.appendChild(thumb);
    var meta = el('div', 'meta');
    meta.appendChild(el('div', 'name', opts.name));
    if (opts.info) meta.appendChild(el('div', 'info', opts.info));
    card.appendChild(meta);
    actions[opts.key] = opts.onSelect;
    return card;
  }

  function row(container, title, count) {
    var r = el('div', 'row');
    var h = el('div', 'row-title', title);
    if (count != null) h.appendChild(el('span', 'count', String(count)));
    r.appendChild(h);
    var track = el('div', 'track');
    r.appendChild(track);
    container.appendChild(r);
    return track;
  }

  /** Scrolls the focused tile's row into view, and the tile within its row. */
  function reveal(target) {
    var track = target.parentNode;
    if (track && track.classList.contains('track')) {
      var tr = track.getBoundingClientRect(), er = target.getBoundingClientRect();
      if (er.right > tr.right - 80) track.scrollLeft += er.right - (tr.right - 80);
      else if (er.left < tr.left + 80) track.scrollLeft -= (tr.left + 80) - er.left;
      if (target === track.firstChild) track.scrollLeft = 0;
    }
    var rowEl = track && track.parentNode, rows = rowEl && rowEl.parentNode;
    if (!rows || !rows.classList || !rows.classList.contains('rows')) return;
    var rr = rows.getBoundingClientRect(), rw = rowEl.getBoundingClientRect();
    if (rowEl === rows.firstChild) rows.scrollTop = 0;
    else if (rw.bottom > rr.bottom - 40) rows.scrollTop += rw.bottom - (rr.bottom - 40);
    else if (rw.top < rr.top) rows.scrollTop -= rr.top - rw.top;
  }

  /** A grid over rows of elements, focusing the element with key `focusKey` if present. */
  function makeGrid(rows, focusKey, onMove) {
    rows = rows.filter(function (r) { return r.length; });
    var g = new Focus.Grid(rows, {
      // Rows tagged with the same .group are drawn as one block (the two live rows).
      linked: function (a, b) { return !!rows[a].group && rows[a].group === rows[b].group; },
      onMove: function (r, c, target) { reveal(target); if (onMove) onMove(target); },
      onSelect: function (target) {
        var fn = actions[target.getAttribute('data-key')];
        if (fn) fn();
      }
    });
    var found = false;
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        if (focusKey && rows[r][c].getAttribute('data-key') === focusKey) { g.r = r; g.c[r] = c; found = true; }
      }
    }
    if (!found && rows.length > 1 && rows[0].length === 1 && rows[0][0].id === 'btn-settings') g.r = 1;   // skip the top bar
    g.apply();
    return g;
  }

  /* ---------- Home ---------- */

  var focusAlerts = false;   // RED: focus the alerts row once it is built

  function goHome(focusKey) {
    state = 'home';
    closeStrip();
    stopLiveRetry();
    Player.stop();
    hideOsd();
    show('screen-home');
    if (focusKey) homeKey = focusKey;
    $('home-status').textContent = t('home.updating');
    var after = Date.now() / 1000 - 3 * 86400;
    Promise.all([
      Frigate.reviews({ limit: 40, severity: 'alert' }).catch(function () { return null; }),
      Frigate.reviews({ limit: 30, severity: 'detection' }).catch(function () { return null; })
    ]).then(function (r) {
      if (state !== 'home') return;
      $('home-status').textContent = r[0] === null ? t('home.alertsUnavailable') : '';
      buildHome((r[0] || []).filter(function (x) { return x.start_time > after; }), r[1] || []);
      focusAlerts = false;
    });
    if (!$('home-rows').firstChild) buildHome([], []);
    startSnapshots();
  }

  function buildHome(alerts, detections) {
    var container = $('home-rows');
    container.innerHTML = '';
    actions = {};
    var settingsBtn = $('btn-settings');
    settingsBtn.setAttribute('data-key', 'settings');
    actions.settings = function () { openSettings(); };

    var rows = [[settingsBtn]];

    // Live: Birdseye first, then each camera, in two rows that scroll together. The first half of
    // the list fills the top row, so it still reads left to right.
    var liveTrack = row(container, t('row.live'), live.sources.length);
    liveTrack.classList.add('two-rows');
    var perRow = Math.ceil(live.sources.length / 2);
    var top = [], bottom = [];
    top.group = bottom.group = 'live';
    live.sources.forEach(function (s, i) {
      var card = liveTrack.appendChild(tile({
        key: 'live:' + s.id, cls: 'small',
        img: Frigate.snapshotUrl(s.id, 270), cam: s.id,
        tag: t('tag.live'), tagCls: 'live', name: s.title,
        info: s.id === 'birdseye' ? t('tile.birdseye') : (s.sub ? t('tile.mainSub') : ''),
        onSelect: function () { startLive(i); }
      }));
      var bottomRow = i >= perRow;
      card.style.gridRow = bottomRow ? '2' : '1';
      card.style.gridColumn = String((bottomRow ? i - perRow : i) + 1);
      (bottomRow ? bottom : top).push(card);
    });
    rows.push(top, bottom);

    rows.push(reviewRow(container, t('row.alerts'), alerts));
    rows.push(reviewRow(container, t('row.detections'), detections));

    var recTrack = row(container, t('row.recordings'));
    rows.push(model.cameras.filter(function (c) { return c.record; }).map(function (c) {
      return recTrack.appendChild(tile({
        key: 'rec:' + c.name, cls: 'small', img: Frigate.snapshotUrl(c.name, 270), cam: c.name,
        name: c.title, info: t('tile.timeline'),
        onSelect: function () { homeKey = 'rec:' + c.name; openRecordings(c); }
      }));
    }));

    var focus = homeKey;
    if (focusAlerts) {
      // RED: the first alert (skipping "mark all"); kept until the alerts have loaded.
      var alertRow = rows.filter(function (r) { return r.kind === 'alert' && r.length; })[0];
      var firstAlert = alertRow && alertRow.filter(function (c) { return /^review:/.test(c.getAttribute('data-key')); })[0];
      if (firstAlert) { focus = homeKey = firstAlert.getAttribute('data-key'); focusAlerts = false; }
    }
    renderKeyLegend();
    grid = makeGrid(rows, focus, function (target) {
      homeKey = target.getAttribute('data-key');
      schedulePreview(target);
    });
    schedulePreview(grid.current());
  }

  function renderKeyLegend() {
    var box = $('home-keys');
    box.innerHTML = '';
    ['red', 'green', 'yellow', 'blue'].forEach(function (c) { box.appendChild(el('span', 'k ' + c, t('keys.' + c))); });
  }

  function reviewRow(container, title, list) {
    var track = row(container, title, list.length);
    var cards = [];
    cards.kind = list.length ? list[0].severity : '';
    if (!list.length) { track.parentNode.appendChild(el('div', 'row-empty', t('row.empty'))); return cards; }
    var unseen = list.filter(function (rv) { return !rv.has_been_reviewed; });
    if (unseen.length) {
      var key = 'markall:' + cards.kind;
      cards.push(track.appendChild(tile({
        key: key, cls: 'small action', glyph: '✓', name: t('home.markAll'), info: String(unseen.length),
        onSelect: function () {
          homeKey = null;
          Frigate.markViewed(unseen.map(function (rv) { return rv.id; })).then(function () { if (state === 'home') goHome(); });
        }
      })));
    }
    var all = cards.concat(list.map(function (rv, i) {
      return track.appendChild(tile({
        key: 'review:' + rv.id, cls: 'small', img: Frigate.thumbUrl(rv),
        tag: rv.severity === 'alert' ? t('tag.alert') : t('tag.detection'), tagCls: rv.severity,
        unseen: !rv.has_been_reviewed,
        name: cameraTitle(rv.camera), info: objectsLabel(rv) + ' · ' + whenLabel(rv.start_time),
        onSelect: function () { homeKey = 'review:' + rv.id; playReviews(list, i); }
      }));
    }));
    all.kind = cards.kind;
    return all;
  }

  /* ---------- Live preview in the focused camera tile ---------- */

  var preview = { timer: null, stream: null, video: null };

  /** After a second on a live tile, its snapshot turns into live video (sub stream, no audio). */
  function schedulePreview(target) {
    stopPreview();
    if (!target || state !== 'home' || Frigate.liveMode() !== 'mse' || !Mse.supported()) return;
    var key = target.getAttribute('data-key') || '';
    var source = live.sources.filter(function (x) { return 'live:' + x.id === key; })[0];
    if (!source || liveModeFor(source) !== 'mse') return;
    preview.timer = setTimeout(function () {
      if (state !== 'home') return;
      var video = el('video', 'preview');
      video.muted = true;
      target.querySelector('.thumb').appendChild(video);
      preview.video = video;
      preview.stream = new Mse.Stream(video, Frigate.liveUrl(source.sub || source.main), { videoOnly: true }, {
        shown: function () { video.classList.add('on'); },
        error: stopPreview,
        stall: stopPreview,
        audioHeld: stopPreview,
        noMedia: stopPreview
      });
    }, 1000);
  }

  function stopPreview() {
    clearTimeout(preview.timer);
    if (preview.stream) preview.stream.close();
    if (preview.video && preview.video.parentNode) preview.video.parentNode.removeChild(preview.video);
    preview.stream = preview.video = null;
  }

  /** Refreshes camera snapshots every 10 s while a tile screen is visible. */
  function startSnapshots() {
    clearInterval(snapTimer);
    snapTimer = setInterval(function () {
      if (state !== 'home') return;
      var imgs = document.querySelectorAll('#home-rows img[data-cam]');
      for (var i = 0; i < imgs.length; i++) refreshImg(imgs[i]);
    }, 10000);
  }

  function refreshImg(img) {
    var cam = img.getAttribute('data-cam');
    var url = Frigate.snapshotUrl(cam, 270);
    var pre = new Image();
    pre.onload = function () { img.src = url; img.style.visibility = ''; };
    pre.src = url;
  }

  function homeKeys(key) {
    if (key === K.BACK) { exitApp(); return true; }
    return grid.handle(key);
  }

  /* ---------- Live ---------- */

  var live = { sources: [], index: 0, retries: 0, retryTimer: null, idleTimer: null, token: 0, gotFrames: false };

  function liveSources() {
    var list = [];
    if (model.birdseye.stream) list.push({ id: 'birdseye', title: 'Birdseye', main: model.birdseye.stream, sub: null });
    model.cameras.forEach(function (c) {
      if (c.live.main) list.push({ id: c.name, title: c.title, main: c.live.main, sub: c.live.sub });
    });
    return list;
  }

  function startLive(index) {
    var n = live.sources.length;
    if (!n) return toast(t('live.none'));
    state = 'live';
    clearInterval(snapTimer);
    stopPreview();
    live.index = ((index % n) + n) % n;
    live.retries = 0;
    homeKey = 'live:' + live.sources[live.index].id;
    playLive();
  }

  function stopLiveRetry() { clearTimeout(live.retryTimer); clearTimeout(live.idleTimer); live.token++; }

  function playLive() {
    stopLiveRetry();
    var s = live.sources[live.index], token = live.token;
    var stream = useSub(s) ? s.sub : s.main;
    homeKey = 'live:' + s.id;
    if (prefs.last !== s.id) { prefs.last = s.id; savePrefs(); }
    renderLiveOsd();
    showOsd();
    setOsdState(t('live.connecting'));
    live.gotFrames = false;
    // Birdseye in "objects" mode sends no frames while nothing moves (idle_heartbeat_fps: 0).
    clearTimeout(live.idleTimer);
    live.idleTimer = setTimeout(function () {
      if (token !== live.token || state !== 'live' || live.gotFrames) return;
      var diag = Player.diagnostics();
      setOsdState((s.id === 'birdseye' ? t('live.birdseyeIdle') : t('live.waiting', { name: s.title })) + (diag ? '\n' + diag : ''));
    }, 12000);
    watchAudio();
    live.stream = stream;
    var mode = liveModeFor(s);
    Player.play(Frigate.liveUrl(stream, mode), { live: true, mse: mode === 'mse', videoOnly: isVideoOnly(stream) }).catch(function (e) {
      if (token === live.token && e.message !== 'cancelled') liveFailed(e.message);
    });
  }

  function liveFailed(msg) {
    if (state !== 'live') return;
    var s = live.sources[live.index], token = ++live.token;
    // The main stream never showed a picture: some cameras' settings (frame rate, bitrate) are more
    // than the TV's decoder takes. Fall back to the sub stream and remember it for this camera.
    if (!live.gotFrames && s.sub && !useSub(s) && liveModeFor(s) === 'mse') {
      prefs.sub[s.id] = true;
      savePrefs();
      toast(t('live.subFallback', { name: s.title }));
      playLive();
      return;
    }
    // The TV may announce an audio codec over MSE that it then fails to decode, which breaks the
    // whole <video>: from then on ask go2rtc for video only.
    live.retries++;
    setOsdState((s.id === 'birdseye' ? t('live.birdseyeRetry') : t('live.noSignal', { name: s.title })) + (msg ? '\n' + msg : ''));
    live.retryTimer = setTimeout(function () { if (token === live.token && state === 'live') playLive(); },
      live.retries <= 3 ? 2000 : 10000);
  }

  function renderLiveOsd() {
    var s = live.sources[live.index];
    $('osd-badge').textContent = t('tag.live');
    $('osd-title').textContent = s.title;
    var quality = s.sub ? (useSub(s) ? t('live.sub') : t('live.main')) : '';
    $('osd-sub').textContent = t('common.position', { n: live.index + 1, total: live.sources.length }) + (quality ? ' · ' + quality : '') +
      ' · ' + liveModeFor(s).toUpperCase();
    $('osd-progress').classList.add('hidden');
    $('osd-time').textContent = '';
    $('osd-dur').textContent = '';
    $('osd-hint').textContent = t('live.hint');
  }

  function switchLive(index) {
    var n = live.sources.length;
    live.retries = 0;
    live.index = ((index % n) + n) % n;
    playLive();
  }

  function liveKeys(key) {
    if (strip.open) return stripKeys(key);
    if (key === K.LEFT || key === K.CH_DOWN || key === K.PREV) { switchLive(live.index - 1); return true; }
    if (key === K.RIGHT || key === K.CH_UP || key === K.NEXT) { switchLive(live.index + 1); return true; }
    if (key === K.UP || key === K.DOWN) {
      var src = live.sources[live.index];
      if (!src.sub) { showOsd(); toast(t('live.oneStream')); return true; }
      prefs.sub[src.id] = !useSub(src);   // remembered for this camera
      savePrefs();
      playLive();
      return true;
    }
    if (key >= 48 && key <= 57) {
      if (key - 48 < live.sources.length) switchLive(key - 48);
      return true;
    }
    if (key === K.ENTER) { renderLiveOsd(); showOsd(); openStrip(); return true; }
    if (key === K.PLAY_PAUSE) { renderLiveOsd(); showOsd(); return true; }
    if (key === K.BACK || key === K.STOP) { goHome(); return true; }
    return false;
  }

  /* ---------- Camera strip over live video ---------- */

  var strip = { open: false, index: 0, timer: null };

  function openStrip() {
    var track = $('strip-track');
    track.classList.add('track');
    track.innerHTML = '';
    live.sources.forEach(function (s, i) {
      var card = el('div', 'tile' + (i === live.index ? ' current' : ''));
      var thumb = el('div', 'thumb');
      var img = el('img');
      img.src = Frigate.snapshotUrl(s.id, 180);
      img.onerror = function () { img.style.visibility = 'hidden'; };
      thumb.appendChild(img);
      card.appendChild(thumb);
      var meta = el('div', 'meta');
      meta.appendChild(el('div', 'name', (i < 10 ? i + ' · ' : '') + s.title));
      card.appendChild(meta);
      track.appendChild(card);
    });
    strip.open = true;
    strip.index = live.index;
    $('strip').classList.remove('hidden');
    document.body.classList.add('strip-open');
    moveStrip(0);
  }

  function moveStrip(delta) {
    var cards = $('strip-track').children, n = cards.length;
    strip.index = ((strip.index + delta) % n + n) % n;
    for (var i = 0; i < n; i++) cards[i].classList.toggle('focused', i === strip.index);
    reveal(cards[strip.index]);
    clearTimeout(strip.timer);
    strip.timer = setTimeout(closeStrip, 8000);
  }

  function closeStrip() {
    clearTimeout(strip.timer);
    strip.open = false;
    $('strip').classList.add('hidden');
    document.body.classList.remove('strip-open');
  }

  function stripKeys(key) {
    if (key === K.LEFT) { moveStrip(-1); return true; }
    if (key === K.RIGHT) { moveStrip(1); return true; }
    if (key === K.ENTER) {
      var i = strip.index;
      closeStrip();
      if (i !== live.index) switchLive(i);
      return true;
    }
    if (key === K.BACK || key === K.UP || key === K.DOWN) { closeStrip(); return true; }
    return true;
  }

  /* ---------- Recorded video (review clips and recording hours) ---------- */

  var vod = { items: [], index: 0, back: null, lastSeek: 0, step: 0 };

  /** Review items play from 5 s before to 5 s after the activity (Frigate's pre/post capture). */
  function playReviews(list, index) {
    var now = Date.now() / 1000;
    var items = list.map(function (rv) {
      var end = rv.end_time || now;
      return {
        camera: rv.camera, start: rv.start_time - 5, end: Math.min(end + 5, now - 1),
        badge: rv.severity === 'alert' ? t('tag.alert') : t('tag.detection'),
        title: cameraTitle(rv.camera), sub: objectsLabel(rv) + ' · ' + dayLabel(new Date(rv.start_time * 1000)) + ' ' + hhmm(new Date(rv.start_time * 1000)),
        review: rv
      };
    });
    startVod(items, index, function () { goHome(); });
  }

  function startVod(items, index, back, offsetMs) {
    state = 'vod';
    clearInterval(snapTimer);
    stopPreview();
    closeStrip();
    vod.items = items;
    vod.back = back;
    playVodItem(index, offsetMs || 0);
  }

  function playVodItem(index, offsetMs) {
    var item = vod.items[index];
    if (!item) return;
    vod.index = index;
    renderVodOsd();
    showOsd();
    setOsdState(t('vod.loading'));
    if (item.review && !item.review.has_been_reviewed) {
      item.review.has_been_reviewed = true;
      Frigate.markViewed([item.review.id]);
    }
    watchAudio();
    if (!item.review) loadMarkers(item);
    Player.play(Frigate.vodUrl(item.camera, item.start, item.end), { startMs: offsetMs || 0 }).catch(function (e) {
      if (state === 'vod' && e.message !== 'cancelled') { setOsdState(''); toast(e.message); }
    });
  }

  function renderVodOsd() {
    var item = vod.items[vod.index];
    $('osd-badge').textContent = item.badge;
    $('osd-title').textContent = item.title;
    $('osd-sub').textContent = item.sub + '   (' + t('common.position', { n: vod.index + 1, total: vod.items.length }) + ')';
    $('osd-progress').classList.remove('hidden');
    $('osd-hint').textContent = item.review ? t('vod.hintReview') : t('vod.hintRec');
    drawMarkers(item);
    updateVodTime(Player.position());
  }

  /* Review items of a recording hour, drawn on the progress bar and reachable with ▲ ▼. */

  function loadMarkers(item) {
    if (item.events) return drawMarkers(item);
    Frigate.reviews({ cameras: [item.camera], after: item.start, before: item.end, limit: 200 }).then(function (list) {
      item.events = (list || []).map(function (rv) { return { start: rv.start_time, severity: rv.severity }; })
        .sort(function (a, b) { return a.start - b.start; });
      if (state === 'vod' && vod.items[vod.index] === item) drawMarkers(item);
    }).catch(function () { item.events = []; });
  }

  function drawMarkers(item) {
    var bar = $('osd-progress');
    var old = bar.querySelectorAll('.marker');
    for (var i = 0; i < old.length; i++) bar.removeChild(old[i]);
    (item.events || []).forEach(function (ev) {
      var at = (ev.start - item.start) / (item.end - item.start);
      if (at < 0 || at > 1) return;
      var m = el('div', 'marker ' + ev.severity);
      m.style.left = (at * 100) + '%';
      bar.appendChild(m);
    });
  }

  /** Jumps to the next (dir 1) or previous (dir -1) event of the recording, 3 s before it starts. */
  function jumpEvent(dir) {
    var item = vod.items[vod.index], now = item.start + Player.position() / 1000;
    var evs = item.events || [], target = null;
    if (dir > 0) target = evs.filter(function (ev) { return ev.start - 3 > now + 1; })[0];
    else target = evs.filter(function (ev) { return ev.start - 3 < now - 5; }).pop();
    if (!target) { toast(t('vod.noEvents')); return; }
    Player.seekTo(Math.max(0, (target.start - 3 - item.start) * 1000));
    showOsd();
  }

  /** From a review clip: the camera's full recording from the moment being watched. */
  function openFullRecording() {
    var item = vod.items[vod.index];
    if (!item || !item.review) return;
    var at = item.start + Player.position() / 1000;
    var cam = model.cameras.filter(function (c) { return c.name === item.camera; })[0];
    if (!cam) return;
    Frigate.recordingDays(cam.name, timezone()).then(function (days) {
      rec.camera = cam;
      rec.hours = hourList(days || []);
      var index = -1;
      rec.hours.forEach(function (h, i) { if (h.start <= at && at < h.start + 3600) index = i; });
      if (index < 0) { toast(t('rec.empty')); return; }
      recKey = 'hour:' + rec.hours[index].start;
      playHours(cam, index, (at - rec.hours[index].start) * 1000);
    }).catch(function (e) { toast(t('rec.loadError', { msg: e.message })); });
  }

  function updateVodTime(ms) {
    if (state !== 'vod') return;
    var item = vod.items[vod.index];
    var total = Player.duration() || (item.end - item.start) * 1000;
    $('osd-bar').style.width = Math.min(100, (ms / total) * 100) + '%';
    $('osd-time').textContent = hhmmss(new Date(item.start * 1000 + ms));
    $('osd-dur').textContent = hhmmss(new Date(item.start * 1000 + total));
  }

  /** Repeated presses speed up: 10 s, 10 s, 30 s, 60 s, 120 s... */
  function seekStep(dir) {
    var now = Date.now();
    vod.step = now - vod.lastSeek < 700 ? Math.min(vod.step + 1, 5) : 0;
    vod.lastSeek = now;
    var steps = [10, 10, 30, 60, 120, 300];
    Player.seekBy(dir * steps[vod.step] * 1000);
    showOsd();
  }

  function vodKeys(key) {
    var item = vod.items[vod.index];
    var recording = item && !item.review;
    if (recording && key === K.UP) { jumpEvent(-1); return true; }
    if (recording && key === K.DOWN) { jumpEvent(1); return true; }
    if (key === K.YELLOW && item && item.review) { openFullRecording(); return true; }
    if (key === K.LEFT) { seekStep(-1); return true; }
    if (key === K.RIGHT) { seekStep(1); return true; }
    if (key === K.RW) { Player.seekBy(-60000); showOsd(); return true; }
    if (key === K.FF) { Player.seekBy(60000); showOsd(); return true; }
    if (key === K.UP || key === K.CH_UP || key === K.PREV) {
      if (vod.index > 0) playVodItem(vod.index - 1, 0); else toast(t('vod.first'));
      return true;
    }
    if (key === K.DOWN || key === K.CH_DOWN || key === K.NEXT) {
      if (vod.index < vod.items.length - 1) playVodItem(vod.index + 1, 0); else toast(t('vod.last'));
      return true;
    }
    if (key === K.ENTER || key === K.PLAY_PAUSE || key === K.PLAY || key === K.PAUSE) {
      if (key === K.PLAY && !Player.isPaused()) { showOsd(); return true; }
      if (key === K.PAUSE && Player.isPaused()) { showOsd(); return true; }
      Player.togglePause();
      return true;
    }
    if (key === K.BACK || key === K.STOP) { Player.stop(); hideOsd(); vod.back(); return true; }
    return false;
  }

  /* ---------- Recordings screen ---------- */

  var rec = { camera: null, hours: [] };

  function openRecordings(cam) {
    state = 'recordings';
    clearInterval(snapTimer);
    stopPreview();
    Player.stop();
    hideOsd();
    show('screen-recordings');
    $('rec-title').textContent = t('rec.title', { name: cam.title });
    var container = $('rec-rows');
    if (rec.camera !== cam) { container.innerHTML = ''; recKey = null; }
    rec.camera = cam;
    Frigate.recordingDays(cam.name, timezone()).then(function (days) {
      if (state !== 'recordings' || rec.camera !== cam) return;
      buildRecordings(cam, days || []);
    }).catch(function (e) {
      if (state === 'recordings') toast(t('rec.loadError', { msg: e.message }));
    });
  }

  function buildRecordings(cam, days) {
    var container = $('rec-rows');
    container.innerHTML = '';
    actions = {};
    var hours = rec.hours = hourList(days);

    var rows = [];
    days.slice().sort(function (a, b) { return a.day < b.day ? 1 : -1; }).forEach(function (d) {
      var p = String(d.day).split('-');
      var date = new Date(+p[0], +p[1] - 1, +p[2]);
      var dayHours = hours.filter(function (h) { return h.day === d.day; }).reverse();
      var track = row(container, dayLabel(date), t('rec.events', { n: d.events || 0 }));
      rows.push(dayHours.map(function (h) {
        var cell = el('div', 'tile hour' + (h.events ? ' has-events' : ''));
        var key = 'hour:' + h.start;
        cell.setAttribute('data-key', key);
        cell.appendChild(el('div', 'h', pad(h.hour) + 'h'));
        cell.appendChild(el('div', 'info', h.events ? (h.events === 1 ? t('rec.event') : t('rec.events', { n: h.events })) : t('rec.noEvents')));
        var fill = el('div', 'fill');
        fill.style.width = Math.min(100, h.duration / 36) + '%';
        cell.appendChild(fill);
        actions[key] = function () { recKey = key; playHours(cam, hours.indexOf(h)); };
        return track.appendChild(cell);
      }));
    });
    if (!rows.length) container.appendChild(el('div', 'row-empty', t('rec.empty')));
    grid = makeGrid(rows, recKey, function (target) { recKey = target.getAttribute('data-key'); });
  }

  /** Every recorded hour of a recordings summary, in time order (for next/previous in playback). */
  function hourList(days) {
    var hours = [];
    days.forEach(function (d) {
      var p = String(d.day).split('-');
      (d.hours || []).forEach(function (h) {
        var start = new Date(+p[0], +p[1] - 1, +p[2], +h.hour).getTime() / 1000;
        hours.push({ day: d.day, hour: +h.hour, start: start, events: h.events || 0, duration: h.duration || 0 });
      });
    });
    return hours.sort(function (a, b) { return a.start - b.start; });
  }

  function playHours(cam, index, offsetMs) {
    var now = Date.now() / 1000;
    var items = rec.hours.map(function (h) {
      var d = new Date(h.start * 1000);
      return {
        camera: cam.name, start: h.start, end: Math.min(h.start + 3600, now - 5),
        badge: t('tag.recording'), title: cam.title,
        sub: t('vod.hourRange', { day: dayLabel(d), from: pad(h.hour) + ':00', to: pad((h.hour + 1) % 24) + ':00' })
      };
    });
    startVod(items, index, function () { openRecordings(cam); }, offsetMs);
  }

  function recordingsKeys(key) {
    if (key === K.BACK) { goHome(); return true; }
    return grid ? grid.handle(key) : false;
  }

  /* ---------- Settings ---------- */

  var settingsBack = null;

  function openSettings(error) {
    var prev = state;
    state = 'settings';
    clearInterval(snapTimer);
    stopPreview();
    closeStrip();
    stopLiveRetry();
    Player.stop();
    hideOsd();
    show('screen-settings');
    settingsBack = model && prev !== 'start' ? function () { goHome(); } : null;
    $('set-cancel').classList.toggle('hidden', !settingsBack);
    $('set-url').value = Frigate.getBase();
    settingsError = error || '';
    $('set-error').textContent = settingsError;
    actions = {};
    var input = $('set-url'), save = $('set-save'), cancel = $('set-cancel');
    var mseBtn = $('set-mse'), hls = $('set-hls');
    input.setAttribute('data-key', 'url'); save.setAttribute('data-key', 'save'); cancel.setAttribute('data-key', 'cancel');
    mseBtn.setAttribute('data-key', 'mode:mse'); hls.setAttribute('data-key', 'mode:hls');
    actions.url = function () { input.focus(); };
    var langs = languageButtons();
    var mode = Frigate.liveMode();

    function layout(focusKey) {
      mseBtn.classList.toggle('selected', mode === 'mse');
      hls.classList.toggle('selected', mode === 'hls');
      var rows = [[input], langs, [mseBtn, hls]];
      rows.push(settingsBack ? [save, cancel] : [save]);
      grid = makeGrid(rows, focusKey);
    }
    actions['mode:hls'] = function () { mode = 'hls'; layout('mode:hls'); };
    actions['mode:mse'] = function () { mode = 'mse'; layout('mode:mse'); };

    actions.save = function () {
      var url = input.value.trim();
      if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
      if (url === 'http://') { input.focus(); return; }
      store(URL_KEY, url);
      store(LIVE_KEY, mode);
      if (url !== Frigate.getBase()) model = null;
      Frigate.setBase(url);
      applyLiveSettings();
      connect();
    };
    actions.cancel = function () { if (settingsBack) settingsBack(); };
    layout(error && Frigate.getBase() ? 'save' : 'url');
  }

  function stored(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }

  /** MSE unless HLS was chosen, or the browser has no MediaSource. */
  function applyLiveSettings() {
    Frigate.setLive({ mode: Player.supportsMse() ? stored(LIVE_KEY) : 'hls' });
  }

  var settingsError = '';

  /** One pill per language; choosing one applies it at once and keeps it. */
  function languageButtons() {
    var box = $('set-langs');
    box.innerHTML = '';
    return I18n.LANGS.map(function (l) {
      var b = el('div', 'pill' + (l.code === I18n.lang() ? ' selected' : ''), l.name);
      var key = 'lang:' + l.code;
      b.setAttribute('data-key', key);
      actions[key] = function () {
        I18n.set(l.code);
        var pills = box.querySelectorAll('.pill');
        for (var i = 0; i < pills.length; i++) pills[i].classList.toggle('selected', pills[i] === b);
        // Messages already on screen were written in the previous language.
        if (settingsError) $('set-error').textContent = '';
        $('home-rows').innerHTML = '';
      };
      return box.appendChild(b);
    });
  }

  function settingsKeys(key) {
    if (key === K.BACK) { if (settingsBack) settingsBack(); else exitApp(); return true; }
    return grid.handle(key);
  }

  /* ---------- OSD ---------- */

  var osdTimer = null;

  function showOsd() {
    $('osd').classList.remove('hidden');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () {
      if (state === 'vod' && Player.isPaused()) return;
      $('osd').classList.add('hidden');
    }, 5000);
  }

  function hideOsd() {
    clearTimeout(osdTimer);
    $('osd').classList.add('hidden');
    setOsdState('');
  }

  var stateTimer = null;
  /** Centre message over the video; empty hides it. */
  function setOsdState(msg) {
    clearTimeout(stateTimer);
    $('osd-state').textContent = msg;
    $('osd-state').classList.toggle('hidden', !msg);
  }

  Player.on('buffering', function (on) {
    if (state !== 'live' && state !== 'vod') return;
    clearTimeout(stateTimer);
    // Short blips between segments are normal: only say so after a moment.
    if (on) stateTimer = setTimeout(function () { $('osd-state').textContent = t('vod.loading'); $('osd-state').classList.remove('hidden'); }, 800);
    else setOsdState('');
  });

  /** Shows the audio the player received, once known (checked a few times after the start). */
  var audioTimer = null;
  function watchAudio() {
    clearTimeout(audioTimer);
    $('osd-audio').textContent = '';
    var tries = 0;
    function check() {
      if (state !== 'live' && state !== 'vod') return;
      var a = Player.audioInfo();
      if (a) {
        $('osd-audio').textContent = a.none ? '🔇 ' + t('audio.none') :
          '🔊 ' + [a.codec ? a.codec.toUpperCase() : 'audio', a.rate ? (a.rate / 1000) + ' kHz' : '', a.channels ? a.channels + ' ch' : '']
            .filter(Boolean).join(' · ');
        if (!a.none || ++tries > 3) return;   // tracks can appear a moment after the start
      }
      if (++tries <= 10) audioTimer = setTimeout(check, 1500);
    }
    // The first look waits for the new stream: right away the old one may still be open.
    audioTimer = setTimeout(check, 1500);
  }

  Player.on('time', function (ms) {
    // (MSE says when a frame is really on screen: 'shown'. Its clock can move without a picture.)
    if (state === 'live' && ms > 0 && liveModeFor(live.sources[live.index]) !== 'mse') liveShown();
    if (state === 'vod') { if ($('osd-state').textContent === t('vod.loading')) setOsdState(''); updateVodTime(ms); }
  });

  function liveShown() {
    live.retries = 0;
    live.gotFrames = true;
    if ($('osd-state').textContent !== '') setOsdState('');
  }

  Player.on('shown', function () { if (state === 'live') liveShown(); });

  // go2rtc sent no video over MSE for this camera: play it over HLS (remembered for a while).
  Player.on('noMedia', function () {
    if (state !== 'live') return;
    var s = live.sources[live.index];
    prefs.hls[s.id] = Date.now();
    savePrefs();
    toast(t('live.hlsFallback', { name: s.title }));
    playLive();
  });

  Player.on('paused', function (p) {
    setOsdState(p ? t('vod.paused') : '');
    showOsd();
  });

  Player.on('ended', function () {
    if (state === 'live') return liveFailed();
    if (state !== 'vod') return;
    if (vod.index < vod.items.length - 1) playVodItem(vod.index + 1, 0);
    else { Player.stop(); hideOsd(); vod.back(); }
  });

  Player.on('stall', function () { if (state === 'live') liveFailed(); });

  // MSE: announced audio that never arrives (no working microphone) means video only for that camera.
  // The TV could not decode the audio format: reopen; the player no longer asks for that format.
  Player.on('audioHeld', function (info) {
    if (state !== 'live') return;
    if (info && info.retry) toast(t('live.otherAudio'));
    else { prefs.videoOnly[live.stream] = Date.now(); savePrefs(); }   // remembered for a week
    playLive();
  });

  Player.on('error', function (msg) {
    if (state === 'live') return liveFailed(msg);
    if (state === 'vod') { setOsdState(''); toast(msg); }
  });

  /* ---------- Alert notifications ---------- */

  var notice = { camera: null, timer: null };

  /** A new Frigate alert: a card on any screen; OK (while watching) or PLAY opens that camera live. */
  function onAlert(review) {
    if (!model) return;
    if (state === 'live' && live.sources[live.index] && live.sources[live.index].id === review.camera) return;
    notice.camera = review.camera;
    $('notify-img').src = Frigate.snapshotUrl(review.camera, 270);
    $('notify-title').textContent = cameraTitle(review.camera);
    $('notify-sub').textContent = objectsLabel(review) + ' · ' + hhmm(new Date(review.start_time * 1000));
    $('notify-hint').textContent = state === 'live' || state === 'vod' ? t('notify.hintOk') : t('notify.hintPlay');
    $('notify').classList.remove('hidden');
    clearTimeout(notice.timer);
    notice.timer = setTimeout(hideNotice, 12000);
    if (state === 'home') goHome();   // the new alert shows up in its row
  }

  function hideNotice() {
    clearTimeout(notice.timer);
    notice.camera = null;
    $('notify').classList.add('hidden');
  }

  function openNotice() {
    var cam = notice.camera;
    hideNotice();
    var index = -1;
    live.sources.forEach(function (x, i) { if (x.id === cam) index = i; });
    if (index >= 0) startLive(index);
  }

  /** Keys that work everywhere: the alert card and the colour shortcuts. True when handled. */
  function globalKeys(key) {
    // The SolarCell remote has one ⏯ key (PLAY_PAUSE); in a clip it keeps pausing, OK opens the alert there.
    var playKey = key === K.PLAY || (key === K.PLAY_PAUSE && state !== 'vod');
    if (notice.camera && (playKey || (key === K.ENTER && (state === 'live' || state === 'vod') && !strip.open))) {
      openNotice();
      return true;
    }
    if (!model || state === 'start') return false;
    if (key === K.RED) { focusAlerts = true; goHome(); return true; }
    if (key === K.GREEN) { startLive(0); return true; }
    if (key === K.YELLOW) {
      if (state === 'vod' && vod.items[vod.index] && vod.items[vod.index].review) return false;   // clip: full recording
      var last = -1;
      live.sources.forEach(function (x, i) { if (x.id === prefs.last) last = i; });
      startLive(last >= 0 ? last : 0);
      return true;
    }
    if (key === K.BLUE && state !== 'settings') { openSettings(); return true; }
    return false;
  }

  /* ---------- Startup, keys, lifecycle ---------- */

  function exitApp() {
    stopPreview();
    FrigateEvents.stop();
    Player.stop();
    try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* desktop browser */ }
  }

  var offline = { waiting: false, timer: null, tick: null };

  function useModel(m) {
    model = m;
    live.sources = liveSources();
    FrigateEvents.start(Frigate.eventsUrl(), onAlert);
  }

  function cachedModel() {
    try {
      var c = JSON.parse(localStorage.getItem(MODEL_KEY) || 'null');
      return c && c.base === Frigate.getBase() ? c.model : null;
    } catch (e) { return null; }
  }

  /**
   * Opens the menu: at once from the last camera list when there is one (refreshed in the
   * background), otherwise after Frigate answers. Frigate out of reach: the start screen retries.
   */
  function connect() {
    clearTimeout(offline.timer);
    clearInterval(offline.tick);
    offline.waiting = false;
    if (!model) {
      var cached = cachedModel();
      if (cached) useModel(cached);
    }
    if (model) {
      homeKey = null;
      $('home-rows').innerHTML = '';
      goHome();
    } else {
      state = 'start';
      show('screen-start');
      $('start-status').textContent = t('start.connecting', { url: Frigate.getBase() });
      $('start-actions').textContent = '';
    }
    refreshModel();
  }

  /** Loads the camera list; rebuilds the menu if it changed. Never leaves the current screen. */
  function refreshModel() {
    clearTimeout(offline.timer);
    Frigate.load().then(function (m) {
      try { localStorage.setItem(MODEL_KEY, JSON.stringify({ base: Frigate.getBase(), model: m })); } catch (e) { /* storage unavailable */ }
      if (state === 'home') $('home-status').textContent = '';
      var first = !model;
      if (!first && JSON.stringify(m) === JSON.stringify(model)) return;
      useModel(m);
      if (first || state === 'start') { homeKey = null; $('home-rows').innerHTML = ''; goHome(); }
      else if (state === 'home') { $('home-rows').innerHTML = ''; goHome(); }
    }).catch(function (e) {
      if (!model) return waitOffline();
      // Menu already up from the saved list: say so and keep trying.
      if (state === 'home') $('home-status').textContent = t('home.offline');
      offline.timer = setTimeout(refreshModel, 15000);
    });
  }

  /** Start screen while Frigate cannot be reached: counts down to the next try. */
  function waitOffline() {
    state = 'start';
    show('screen-start');
    offline.waiting = true;
    $('start-status').textContent = t('start.offline', { url: Frigate.getBase() });
    var n = 10;
    var render = function () { $('start-actions').textContent = t('start.retry', { n: n }); };
    render();
    clearInterval(offline.tick);
    offline.tick = setInterval(function () {
      if (state !== 'start') return clearInterval(offline.tick);
      if (--n <= 0) { clearInterval(offline.tick); connect(); } else render();
    }, 1000);
  }

  document.addEventListener('keydown', function (e) {
    var input = document.activeElement;
    if (input && input.tagName === 'INPUT') {
      // Typing goes to the field; Done/Cancel on the TV keyboard (or Enter/Esc) leave it.
      if (e.keyCode === K.ENTER || e.keyCode === IME_DONE || e.keyCode === IME_CANCEL || e.keyCode === 27 || e.keyCode === K.BACK) {
        input.blur();
        e.preventDefault();
      }
      return;
    }
    var key = Keys.normalize(e);
    var handled = globalKeys(key);
    if (handled) { e.preventDefault(); return; }
    if (state === 'home') handled = homeKeys(key);
    else if (state === 'live') handled = liveKeys(key);
    else if (state === 'vod') handled = vodKeys(key);
    else if (state === 'recordings') handled = recordingsKeys(key);
    else if (state === 'settings') handled = settingsKeys(key);
    else if (state === 'start' && key === K.BACK) { exitApp(); handled = true; }
    else if (state === 'start' && key === K.ENTER && offline.waiting) { connect(); handled = true; }
    else if (state === 'start' && key === K.BLUE) { openSettings(); handled = true; }
    if (handled) e.preventDefault();
  });

  // Leaving the app (Home button, another app) stops the stream; coming back resumes it.
  var resumeAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      resumeAt = Player.position();
      stopLiveRetry();
      stopPreview();
      Player.stop();
    } else if (state === 'live') {
      playLive();
    } else if (state === 'vod') {
      playVodItem(vod.index, resumeAt);
    } else if (state === 'home') {
      goHome();
    }
  });

  function boot() {
    I18n.load();
    I18n.apply(document);
    Keys.register();
    for (var d = 0; d <= 9; d++) {
      try { tizen.tvinputdevice.registerKey(String(d)); } catch (e) { /* not on this remote */ }
    }
    Player.init($('av-player'), $('video'));
    tickClock();
    setInterval(tickClock, 10000);
    var saved = null;
    try { saved = localStorage.getItem(URL_KEY); } catch (e) { /* storage unavailable */ }
    if (!saved) {
      // First run: there is no sensible default address, ask for it.
      openSettings(t('settings.firstRun'));
      return;
    }
    Frigate.setBase(saved);
    applyLiveSettings();
    connect();
  }

  boot();
})();
