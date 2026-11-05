const test = require('node:test');
const assert = require('node:assert');
const F = require('../app/js/frigate.js');

const streams = {
  cam_living: { producers: [{ url: 'rtsp://*:*@192.168.1.43:554/stream1#video=copy#audio=aac' }] },
  cam_living_sub: { producers: [] },
  cam_street: { producers: [{ url: 'rtsp://*:*@192.168.1.90:554/stream1' }] },
  cam_street_sub: { producers: [{ url: 'rtsp://*:*@192.168.1.90:554/stream2' }] },
  cam_yard_indoor: { producers: [] },
  cam_yard_sub: { producers: [] },
  birdseye: { producers: [] }
};

test('normalizeUrl drops credentials and go2rtc options', () => {
  assert.strictEqual(F._normalizeUrl('rtsp://u:p@CAM.local:554/s1#video=copy'), 'rtsp://cam.local:554/s1');
  assert.strictEqual(F._normalizeUrl('rtsp://*:*@1.2.3.4:554/a'), 'rtsp://1.2.3.4:554/a');
});

test('live.streams that exist in go2rtc win', () => {
  const cam = { live: { streams: { 'Main Stream': 'cam_living', 'Sub Stream': 'cam_living_sub' } } };
  assert.deepStrictEqual(F._resolveStreams('Living', cam, streams), { main: 'cam_living', sub: 'cam_living_sub' });
});

test('a direct camera URL is matched to the go2rtc stream with the same source', () => {
  const cam = { live: { streams: { Street: 'Street' } }, ffmpeg: { inputs: [{ path: 'rtsp://admin:x@192.168.1.90:554/stream1', roles: ['record', 'detect'] }] } };
  assert.deepStrictEqual(F._resolveStreams('Street', cam, streams), { main: 'cam_street', sub: 'cam_street_sub' });
});

test('a go2rtc restream input is used by name, and a renamed sub-stream is found', () => {
  const cam = { ffmpeg: { inputs: [{ path: 'rtsp://127.0.0.1:8554/cam_yard_indoor', roles: ['record'] }] } };
  assert.deepStrictEqual(F._resolveStreams('Yard', cam, streams), { main: 'cam_yard_indoor', sub: 'cam_yard_sub' });
});

test('no stream found', () => {
  assert.deepStrictEqual(F._resolveStreams('X', { ffmpeg: { inputs: [{ path: 'rtsp://9.9.9.9/a', roles: ['record'] }] } }, streams), { main: null, sub: null });
});

test('model skips disabled cameras and needs birdseye restream', () => {
  const config = {
    cameras: {
      B: { enabled: true, ui: { order: 2 }, record: { enabled: true } },
      A: { enabled: true, ui: { order: 1 } },
      Off: { enabled: false }
    },
    birdseye: { enabled: true, restream: false }
  };
  const m = F._buildModel(config, streams);
  assert.deepStrictEqual(m.cameras.map(c => c.name), ['A', 'B']);
  assert.strictEqual(m.birdseye.stream, null);
  config.birdseye.restream = true;
  assert.strictEqual(F._buildModel(config, streams).birdseye.stream, 'birdseye');
});

test('URLs', () => {
  F.setBase('http://192.168.1.10:5000/');
  F.setLive({ mode: 'hls' });
  assert.strictEqual(F.liveUrl('cam rua'), 'http://192.168.1.10:1984/api/stream.m3u8?src=cam%20rua');
  assert.strictEqual(F.vodUrl('Garage', 100.4, 200.2), 'http://192.168.1.10:5000/vod/Garage/start/100/end/201/master.m3u8');
  assert.strictEqual(F.thumbUrl({ thumb_path: '/media/frigate/clips/review/thumb-x.webp' }), 'http://192.168.1.10:5000/clips/review/thumb-x.webp');
});

test('live URLs: go2rtc MSE WebSocket by default, HLS on request', () => {
  F.setBase('http://192.168.1.10:5000');
  F.setLive({});
  assert.strictEqual(F.liveMode(), 'mse');
  assert.strictEqual(F.liveUrl('cam street'), 'ws://192.168.1.10:1984/api/ws?src=cam%20street');
  F.setLive({ mode: 'hls' });
  assert.strictEqual(F.liveUrl('cam_street'), 'http://192.168.1.10:1984/api/stream.m3u8?src=cam_street');
  F.setLive({ mode: 'rtsp' });
  assert.strictEqual(F.liveMode(), 'mse');
});
