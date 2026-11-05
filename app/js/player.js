/*
 * Full-screen playback with three engines:
 *  - 'av':    Samsung AVPlay, the TV's native player, for HLS (recordings, clips, live in HLS mode);
 *  - 'mse':   live video from go2rtc's MSE WebSocket into a <video> element (low delay; see mse.js);
 *  - 'video': a plain <video> element, to try the UI in a desktop browser.
 *
 * Lessons carried over from the F1 TV app: never close AVPlay while prepareAsync is running
 * (it can crash the native player); re-issue play() if AVPlay stays READY after preparing;
 * AVPlay briefly rejects seeks right after starting, so retry them.
 */
var Player = (function () {
  var handlers = {};
  var av = null;          // webapis.avplay when available
  var videoEl = null;     // <video> for MSE and the desktop fallback
  var objectEl = null;    // AVPlay's <object>: shown only while AVPlay plays, or it covers the <video>
  var current = null;     // { url, live, engine, startMs } being played
  var preparing = null;   // settles when the current prepareAsync finishes either way
  var stream = null;      // the open Mse.Stream while MSE plays
  var posMs = 0, paused = false, stallTimer = null;

  function tr(key, params) { return typeof I18n !== 'undefined' ? I18n.t(key, params) : key; }

  function on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); }
  function emit(ev, arg) { (handlers[ev] || []).forEach(function (fn) { fn(arg); }); }

  function native() { return typeof webapis !== 'undefined' && !!webapis.avplay; }

  function init(object, video) {
    if (native()) av = webapis.avplay;
    videoEl = video;
    objectEl = object;
    objectEl.classList.add('hidden');
    var htmlEngine = function () { return current && current.engine !== 'av'; };
    videoEl.addEventListener('timeupdate', function () {
      if (!htmlEngine()) return;
      posMs = videoEl.currentTime * 1000;
      emit('time', posMs);
    });
    videoEl.addEventListener('waiting', function () { if (htmlEngine()) { emit('buffering', true); watchStall(current); } });
    videoEl.addEventListener('playing', function () { if (htmlEngine()) { clearTimeout(stallTimer); emit('buffering', false); } });
    videoEl.addEventListener('ended', function () { if (htmlEngine()) emit('ended'); });
    // Not for MSE: emptying the element on a switch fires a late 'error' that would land on the next
    // camera; Mse.Stream notices real failures itself (nothing playable after a few seconds).
    videoEl.addEventListener('error', function () {
      if (htmlEngine() && current.engine !== 'mse') emit('error', tr('error.video') + ' (' + mediaError() + ')');
    });
  }

  function mediaError() {
    var e = videoEl && videoEl.error;
    return e ? e.code + (e.message ? ': ' + e.message : '') : '-';
  }

  /** One line about the <video> state, shown when live video does not start (for remote debugging). */
  function diagnostics() {
    if (!current || current.engine === 'av' || !videoEl) return '';
    if (stream) return stream.diagnostics();
    return current.engine.toUpperCase() + ' · readyState ' + videoEl.readyState + ' · error ' + mediaError();
  }

  /*
   * Opens and closes run one after another (chain), and a newer play() or stop() cancels an older
   * play() that has not opened yet, so quick camera switches never open two streams at once.
   */
  var chain = Promise.resolve(), gen = 0;

  function cancelled() { return new Error('cancelled'); }

  /**
   * Plays url full screen. opts.live marks a live stream; opts.mse plays a go2rtc MSE WebSocket
   * URL; opts.startMs starts a recording part way. Resolves once playback starts.
   */
  function play(url, opts) {
    opts = opts || {};
    var my = ++gen;
    var item = {
      url: url, live: !!opts.live, startMs: opts.startMs || 0, videoOnly: !!opts.videoOnly,
      engine: opts.mse ? 'mse' : (av ? 'av' : 'video')
    };
    document.body.classList.add('playing');
    var p = chain.then(function () {
      if (my !== gen) throw cancelled();
      return close();
    }).then(function () {
      if (my !== gen) throw cancelled();
      current = item;
      posMs = item.startMs;
      paused = false;
      if (item.engine === 'mse') return openMse(item);
      return item.engine === 'av' ? openAv(item) : openVideo(item);
    });
    chain = p.catch(function () { /* the caller handles it */ });
    return p;
  }

  /* ---------- Plain <video> (desktop) ---------- */

  function openVideo(item) {
    videoEl.classList.remove('hidden');
    videoEl.src = item.url;
    if (item.startMs) videoEl.currentTime = item.startMs / 1000;
    return videoEl.play().catch(function (e) { emit('error', tr('error.noHls', { msg: e.message })); });
  }

  /* ---------- go2rtc MSE ---------- */

  // Unlike AVPlay, MSE has nothing that must finish before the next switch: open and return, and
  // report problems as events (a slow start must not hold up the next camera).
  function openMse(item) {
    videoEl.classList.remove('hidden');
    stream = new Mse.Stream(videoEl, item.url, { videoOnly: item.videoOnly }, {
      error: function (msg) { if (current === item) emit('error', msg); },
      stall: function () { if (current === item) emit('stall'); },
      audioHeld: function (info) { if (current === item) emit('audioHeld', info); },
      shown: function () { if (current === item) emit('shown'); },
      noMedia: function () { if (current === item) emit('noMedia'); }
    });
    return Promise.resolve();
  }

  /* ---------- AVPlay ---------- */

  function openAv(item) {
    objectEl.classList.remove('hidden');
    return new Promise(function (resolve, reject) {
      try {
        av.open(item.url);
      } catch (e) {
        return reject(new Error(tr('error.open', { msg: e.message })));
      }
      av.setListener({
        onbufferingstart: function () { emit('buffering', true); watchStall(item); },
        onbufferingcomplete: function () { clearTimeout(stallTimer); emit('buffering', false); },
        oncurrentplaytime: function (ms) { posMs = ms; emit('time', ms); },
        onstreamcompleted: function () { if (current === item) emit('ended'); },
        onerror: function (e) { if (current === item) emit('error', tr('error.player', { msg: e })); }
      });
      try { av.setDisplayRect(0, 0, 1920, 1080); } catch (e) { /* keep default */ }
      try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) { /* keep default */ }
      try {
        // Small buffers keep live video close to real time.
        var start = item.live ? 2 : 4;
        av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', start);
        av.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', 4);
      } catch (e) { /* older firmware: keep defaults */ }

      var settle;
      preparing = new Promise(function (r) { settle = r; });
      av.prepareAsync(function () {
        settle();
        if (current !== item) return reject(new Error('cancelled'));
        if (item.startMs) seekTo(item.startMs);
        try { av.play(); } catch (e) { /* ensurePlaying retries */ }
        ensurePlaying(item);
        resolve();
      }, function (e) {
        settle();
        reject(new Error(current !== item ? 'cancelled' : tr('error.open', { msg: e })));
      });
    });
  }

  /** Buffering that lasts 12 s is reported as a stall (the app reconnects live streams). */
  function watchStall(item) {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(function () { if (current === item && !paused) emit('stall'); }, 12000);
  }

  function ensurePlaying(item) {
    var tries = 0;
    (function check() {
      if (current !== item || paused || ++tries > 8) return;
      var st = '';
      try { st = av.getState(); } catch (e) { return; }
      if (st === 'READY' || st === 'PAUSED') { try { av.play(); } catch (e) { /* retry */ } }
      if (st !== 'PLAYING') setTimeout(check, 700);
    })();
  }

  /* ---------- Controls ---------- */

  var seekGen = 0;

  function seekTo(ms) {
    if (!current || current.live) return;
    var g = ++seekGen, item = current, tries = 0;
    var dur = duration();
    var target = Math.max(0, dur ? Math.min(ms, dur - 2000) : ms);
    posMs = target;
    emit('time', posMs);
    if (item.engine !== 'av') { videoEl.currentTime = target / 1000; return; }
    (function attempt() {
      if (g !== seekGen || item !== current) return;
      try {
        av.seekTo(Math.round(target), function () { /* done */ }, function (e) {
          if (g === seekGen && item === current && e && e.name === 'InvalidValuesError' && ++tries < 8) setTimeout(attempt, 500);
        });
      } catch (e) { /* not seekable now */ }
    })();
  }

  function seekBy(deltaMs) { seekTo(posMs + deltaMs); }

  function togglePause() {
    if (!current || current.live) return;
    paused = !paused;
    if (current.engine === 'av') {
      try { if (paused) av.pause(); else av.play(); } catch (e) { /* wrong state */ }
    } else if (paused) videoEl.pause(); else videoEl.play();
    emit('paused', paused);
  }

  /**
   * The audio actually playing: { codec, rate, channels } (rate/channels 0 when unknown),
   * { none: true } when the stream has no audio, or null when not known yet.
   */
  function audioInfo() {
    if (!current) return null;
    if (current.engine === 'mse') return stream ? stream.audioInfo() : null;
    if (current.engine !== 'av') return null;
    var tracks;
    try { tracks = av.getCurrentStreamInfo() || []; } catch (e) { return null; }
    if (!tracks.length) return null;
    var track = tracks.filter(function (x) { return x.type === 'AUDIO'; })[0];
    if (!track) return { none: true };
    var info = {};
    try { info = JSON.parse(track.extra_info || '{}'); } catch (e) { /* unknown details */ }
    return {
      codec: String(info.codec_fourcc || info.fourCC || '').trim(),
      rate: +info.sample_rate || 0,
      channels: +info.channels || 0
    };
  }

  function duration() {
    if (current && current.engine === 'av') { try { return av.getDuration() || 0; } catch (e) { return 0; } }
    return videoEl && isFinite(videoEl.duration) ? videoEl.duration * 1000 : 0;
  }

  /** Stops playback (and any pending play()); resolves when the player is closed. */
  function stop() {
    ++gen;
    current = null;
    clearTimeout(stallTimer);
    document.body.classList.remove('playing');
    var p = chain.then(close);
    chain = p.catch(function () { /* already closed */ });
    return p;
  }

  // Closes every engine. AVPlay must not be closed during prepareAsync (it can crash): wait for it.
  function close() {
    paused = false;
    clearTimeout(stallTimer);
    if (stream) { stream.close(); stream = null; }
    if (videoEl) {
      videoEl.playbackRate = 1;
      videoEl.pause();
      videoEl.removeAttribute('src');
      try { videoEl.load(); } catch (e) { /* nothing loaded */ }
      videoEl.classList.add('hidden');
    }
    if (!av) return Promise.resolve();
    var wait = preparing || Promise.resolve();
    return wait.then(function () {
      try { av.stop(); } catch (e) { /* not started */ }
      try { av.close(); } catch (e) { /* already closed */ }
      preparing = null;
      objectEl.classList.add('hidden');
    });
  }

  return {
    init: init, on: on, play: play, stop: stop, seekTo: seekTo, seekBy: seekBy,
    togglePause: togglePause, duration: duration, supportsMse: Mse.supported, diagnostics: diagnostics,
    position: function () { return posMs; },
    isPaused: function () { return paused; },
    isActive: function () { return !!current; },
    audioInfo: audioInfo
  };
})();
