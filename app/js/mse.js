/*
 * One live go2rtc stream played through MSE into a <video> element. Used full screen (Player) and
 * for the small live preview on the home screen.
 *
 * go2rtc's protocol: send {type:'mse', value:'<codecs>'}; it answers {type:'mse', value:'<mime>'}
 * and then streams fragmented MP4 as binary messages, starting with the init segment.
 *
 * What the Samsung TV (Tizen 7) taught us, none of which shows in desktop Chrome:
 *  - its hardware decoder drops everything on a seek and waits for the next keyframe, so seeking to
 *    the live edge on every append never shows a picture: no seeks before the first frame shows,
 *    catch up on a small delay by playing at 1.1x, jump only when far behind;
 *  - it says it plays FLAC over MSE but the decoder never starts: audio codecs that stall are
 *    remembered on the TV and not asked for again;
 *  - MSE only buffers what has every announced track, so audio that is announced but never sent
 *    keeps the buffer empty: then the stream is reopened as video only.
 */
var Mse = (function () {
  // What go2rtc can send over MSE, in its own order of preference (from go2rtc's video-rtc.js).
  var CODECS = ['avc1.640029', 'avc1.64002A', 'avc1.640033', 'hvc1.1.6.L153.B0', 'mp4a.40.2', 'mp4a.40.5', 'flac', 'opus'];
  var AUDIO = /^(mp4a|flac|opus)/;

  var CATCHUP_LAG_S = 0.8, JUMP_LAG_S = 4, EDGE_S = 0.5, JUMP_EVERY_MS = 10000, KEEP_S = 10;
  var BAD_AUDIO_KEY = 'frigatetv.mseBadAudio';

  function tr(key, params) { return typeof I18n !== 'undefined' ? I18n.t(key, params) : key; }

  function supported() { return typeof window !== 'undefined' && !!window.MediaSource; }

  function badAudio() {
    try { return JSON.parse(localStorage.getItem(BAD_AUDIO_KEY) || '[]'); } catch (e) { return []; }
  }

  function audioCodecOf(mime) {
    return ((/codecs="([^"]*)"/.exec(mime || '') || [])[1] || '').split(',')
      .map(function (c) { return c.trim(); })
      .filter(function (c) { return AUDIO.test(c); })[0] || '';
  }

  function markBadAudio(mime) {
    var codec = audioCodecOf(mime);
    if (!codec) return;
    var family = codec.split('.')[0], list = badAudio();
    if (list.indexOf(family) < 0) list.push(family);
    try { localStorage.setItem(BAD_AUDIO_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
  }

  /** The codecs this browser can play through MSE, as go2rtc expects them (comma separated). */
  function codecs(videoOnly) {
    var bad = badAudio();
    return CODECS.filter(function (c) {
      if (AUDIO.test(c) && (videoOnly || bad.indexOf(c.split('.')[0]) >= 0)) return false;
      try { return MediaSource.isTypeSupported('video/mp4; codecs="' + c + '"'); } catch (e) { return false; }
    }).join(',');
  }

  /**
   * Opens url (a go2rtc ws://…/api/ws?src=… URL) into video. opts.videoOnly asks for no audio.
   * on: { error(msg), stall(), audioHeld({ retry }), noMedia(), shown() } — all optional.
   */
  function Stream(video, url, opts, on) {
    this.video = video;
    this.url = url;
    this.opts = opts || {};
    this.on = on || {};
    this.mime = '';
    this.bytes = 0;
    this.appends = 0;
    this.lastError = '';
    this.shown = false;
    this.closed = false;
    this._queue = [];
    this._openedAt = this._lastData = Date.now();
    this._jumpedAt = 0;
    this._done = false;   // start decided (shown, failed or handed over)
    this._open();
  }

  Stream.prototype._emit = function (name, arg) {
    if (!this.closed && this.on[name]) this.on[name](arg);
  };

  Stream.prototype._fail = function (msg) {
    if (this.closed) return;
    this._done = true;
    this._emit('error', msg);
  };

  Stream.prototype._open = function () {
    var self = this, video = this.video;
    this.ms = new MediaSource();
    video.src = URL.createObjectURL(this.ms);
    this.ms.addEventListener('sourceopen', function () {
      if (self.closed) return;
      try { URL.revokeObjectURL(video.src); } catch (e) { /* keep it */ }
      var ws;
      try { ws = new WebSocket(self.url); } catch (e) { return self._fail(tr('error.open', { msg: e.message })); }
      self.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = function () { ws.send(JSON.stringify({ type: 'mse', value: codecs(self.opts.videoOnly) })); };
      ws.onmessage = function (ev) { self._message(ev); };
      ws.onerror = function () { self._fail(tr('error.offline', { url: self.url })); };
      ws.onclose = function () { self._fail(tr('error.offline', { url: self.url })); };
    });
    this._timer = setInterval(function () { self._tick(); }, 500);
  };

  Stream.prototype._message = function (ev) {
    if (this.closed) return;
    var self = this;
    if (typeof ev.data === 'string') {
      var msg = {};
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'mse') {
        this.mime = msg.value;
        try {
          this.sb = this.ms.addSourceBuffer(msg.value);
          this.sb.mode = 'segments';
          this.sb.addEventListener('updateend', function () { self._pump(); });
        } catch (e) { this._fail(tr('error.open', { msg: msg.value })); }
      } else if (msg.type === 'error') {
        this._fail(tr('error.open', { msg: msg.value }));
      }
      return;
    }
    this._lastData = Date.now();
    this.bytes += ev.data.byteLength;
    this._queue.push(ev.data);
    this._pump();
  };

  /** Appends what has arrived (in one go), keeps playback near the live edge and the buffer short. */
  Stream.prototype._pump = function () {
    var sb = this.sb, video = this.video;
    if (!sb || sb.updating || this.closed) return;
    var b = video.buffered;
    if (b.length) {
      var end = b.end(b.length - 1), start = b.start(0), t = video.currentTime, lag = end - t;
      if (!this.shown) {
        if (t < start) video.currentTime = start;
      } else if (lag > JUMP_LAG_S && Date.now() - this._jumpedAt > JUMP_EVERY_MS) {
        this._jumpedAt = Date.now();
        video.currentTime = end - EDGE_S;
      } else {
        var rate = lag > CATCHUP_LAG_S ? 1.1 : 1;
        if (video.playbackRate !== rate) video.playbackRate = rate;
      }
      if (t - start > KEEP_S * 3) {
        try { sb.remove(start, t - KEEP_S); return; } catch (e) { /* try again after the next append */ }
      }
    }
    if (this._queue.length) {
      var total = 0, i;
      for (i = 0; i < this._queue.length; i++) total += this._queue[i].byteLength;
      var data = new Uint8Array(total), off = 0;
      for (i = 0; i < this._queue.length; i++) { data.set(new Uint8Array(this._queue[i]), off); off += this._queue[i].byteLength; }
      this._queue = [];
      try {
        sb.appendBuffer(data);
        this.appends++;
      } catch (e) {
        // Buffer full: drop old video and try again with this data.
        this.lastError = e.name;
        this._queue.unshift(data.buffer);
        if (b.length) { try { sb.remove(b.start(0), Math.max(b.start(0) + 1, video.currentTime - 2)); } catch (e2) { /* next time */ } }
        return;
      }
    }
    if (video.paused && b.length) video.play().catch(function () { /* retried on the next data */ });
  };

  Stream.prototype._tick = function () {
    if (this.closed) return clearInterval(this._timer);
    var video = this.video, buf = video.buffered;
    if (!this.shown && (video.readyState >= 3 || (buf.length && video.currentTime > buf.start(0) + 0.5))) {
      this.shown = true;
      this._done = true;
      this._emit('shown');
    }
    if (!this._done) {
      var waited = Date.now() - this._openedAt;
      // The decoder refused this stream (MediaError 3). Code 4 is not checked: emptying the element
      // on a camera switch fires it late, and it would land on the next stream.
      if (video.error && video.error.code === 3) {
        return this._fail(tr('error.video') + ' · ' + this.diagnostics());
      }
      // go2rtc answered and sent the header but no video: its fMP4 output for this stream is stuck
      // (seen on some cameras whose RTSP and HLS still work). The app falls back to HLS.
      if (this.sb && this.bytes < 4096 && waited > 5000) {
        this._done = true;
        return this._emit('noMedia');
      }
      // go2rtc never answers while it waits on an audio converter for a camera that sends no audio.
      if (!this.mime && waited > 5000 && !this.opts.videoOnly) {
        this._done = true;
        return this._emit('audioHeld', { retry: false });
      }
      var buffered = buf.length ? buf.end(buf.length - 1) - buf.start(0) : 0;
      var noAudioData = !buf.length && this.bytes > 50000 && waited > 4000;
      var decoderStuck = buffered > 2 && video.readyState < 2 && waited > 5000;
      if (audioCodecOf(this.mime) && this.sb && (noAudioData || decoderStuck)) {
        this._done = true;
        // A codec the TV cannot really decode: never ask for it again on this TV.
        if (decoderStuck) markBadAudio(this.mime);
        return this._emit('audioHeld', { retry: decoderStuck });
      }
      // Video only, seconds buffered, nothing playable: the TV's decoder does not take this stream.
      if (!audioCodecOf(this.mime) && buffered > 2 && video.readyState < 2 && waited > 6000) {
        return this._fail(tr('error.video') + ' · ' + this.diagnostics());
      }
      if (waited > 12000) return this._fail(tr('error.video') + ' · ' + this.diagnostics());
    }
    // A live stream that sends nothing for 10 s has stalled.
    if (Date.now() - this._lastData > 10000) { this._lastData = Date.now(); this._emit('stall'); }
  };

  /** { codec } of the audio go2rtc sends, { none: true } without audio, null before it answers. */
  Stream.prototype.audioInfo = function () {
    if (!this.mime) return null;
    var a = audioCodecOf(this.mime);
    if (!a) return { none: true };
    return { codec: /^mp4a/.test(a) ? 'AAC' : a.toUpperCase(), rate: 0, channels: 0 };
  };

  /** One line about the stream, shown on screen when video does not start (remote debugging). */
  Stream.prototype.diagnostics = function () {
    var v = this.video, b = v.buffered, e = v.error;
    var buf = b.length ? b.start(0).toFixed(2) + '–' + b.end(b.length - 1).toFixed(1) + 's' : '0s';
    return 'MSE ' + this.mime + ' · readyState ' + v.readyState + ' · t ' + v.currentTime.toFixed(1) +
      ' · buffer ' + buf + ' · error ' + (e ? e.code + (e.message ? ': ' + e.message : '') : '-') +
      ' · ' + Math.round(this.bytes / 1024) + ' KB, ' + this.appends + ' appends' + (this.lastError ? ', ' + this.lastError : '');
  };

  Stream.prototype.close = function () {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this._timer);
    if (this.ws) {
      this.ws.onclose = this.ws.onerror = this.ws.onmessage = null;
      try { this.ws.close(); } catch (e) { /* already closed */ }
    }
    var v = this.video;
    v.playbackRate = 1;
    v.pause();
    v.removeAttribute('src');
    try { v.load(); } catch (e) { /* nothing loaded */ }
  };

  return { Stream: Stream, supported: supported, codecs: codecs };
})();
