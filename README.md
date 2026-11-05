# Frigate TV for Samsung TVs

A native Samsung Smart TV (Tizen) app for [Frigate NVR](https://frigate.video): watch your cameras
live, browse alerts and detections, and scrub through recordings, all with the TV remote.

Live video streams straight from go2rtc with about half a second of delay; recordings play in the
TV's own hardware player (AVPlay). Nothing depends on Frigate's web UI working on a TV browser.

Unofficial and not affiliated with Frigate or Blake Blackshear.

## What you get

- **Home menu.** Opens on a menu: Birdseye and every camera in two rows of live snapshots, then
  recent alerts, recent detections and recordings. Snapshots refresh every 10 seconds.
- **Live view.** Full screen. Switch cameras with ◀ ▶, jump straight to one with the number keys,
  and toggle between the main stream and the lighter sub stream with ▲ ▼.
- **Alerts and detections.** Recent review items with their thumbnails on the home screen. Play
  any of them, step to the previous or next one, and they are marked as reviewed in Frigate.
- **Recordings.** An hour-by-hour timeline per camera and per day, showing how many events each
  hour has. Seek with ◀ ▶ (repeated presses speed up), ⏪ ⏩ for one minute, and playback
  continues into the next hour by itself.
- **Low-delay live video.** Live video comes from go2rtc over MSE (a WebSocket with fragmented
  MP4), about half a second behind real time, with audio. HLS is still available under Settings
  for TVs that have trouble with MSE.
- **Alert notifications.** A new Frigate alert pops up on any screen with a snapshot; press OK
  (while watching) or ⏯ to open that camera live.
- **Live preview on the menu.** Rest on a camera for a second and its snapshot turns into live
  video (sub stream, no sound).
- **Camera strip.** Press OK during live video to pick a camera from a row of thumbnails.
- **From an alert to the full recording.** YELLOW while watching an alert continues in that
  camera's recording at the same moment.
- **Event markers.** Recordings show their alerts and detections on the progress bar; ▲ ▼ jump
  from one to the next.
- **Colour keys everywhere:** 🔴 alerts, 🟢 Birdseye, 🟡 last camera, 🔵 Settings.
- **Remembers your choices:** main or sub stream per camera, the last camera, and cameras
  without audio (so they open at once).
- **Starts instantly** from the last camera list while it refreshes, and retries on its own when
  Frigate is out of reach.
- **English, Portuguese and Spanish.** English by default; change it under Settings.
- **No cloud, no accounts.** The TV talks only to your Frigate server on your network.

## Requirements

- A Samsung TV running Tizen with **Developer Mode** (the app targets Tizen 3.0, 2017 models, and newer).
  Developed and tested on a 2023 QN90C (Tizen 7).
- **Frigate 0.14 or newer** (tested on 0.18.2), reachable from the TV on:
  - port **5000**: Frigate's internal API, which needs no login;
  - port **1984**: go2rtc, which serves the live video (MSE WebSocket, or HLS).
- Cameras restreamed through go2rtc. The app finds each camera's go2rtc stream on its own: from
  `live.streams`, from `rtsp://127.0.0.1:8554/<name>` inputs, or by matching the camera's RTSP
  URL with the go2rtc stream source.

For Birdseye, turn on the restream. Also set a heartbeat: without one, Birdseye sends no frames
while nothing moves, and the TV waits on an empty stream:

```yaml
birdseye:
  enabled: true
  restream: true
  idle_heartbeat_fps: 1
```

For **live audio**, give go2rtc an Opus version of each camera with a microphone. Samsung TVs
(tested on Tizen 7) accept FLAC over MSE but then never start the picture, while Opus plays fine.
The app notices a format the TV cannot decode, remembers it, and asks for the next one, so this
is only needed for sound:

```yaml
go2rtc:
  streams:
    front_door:
      - rtsp://user:pass@192.168.1.20:554/stream1
      - "ffmpeg:front_door#audio=opus"
```

> **Security:** port 5000 has no authentication. Keep it on your local network and never expose
> it to the internet. Use a VPN to watch from outside your home.

## Install

1. **Put the TV in Developer Mode:** open **Apps**, press `1` `2` `3` `4` `5` on the remote, switch
   **Developer mode** on, enter your computer's IP address, then restart the TV.
2. **Install the Tizen Studio CLI** on your computer (the `web-cli` installer from
   [developer.tizen.org](https://developer.tizen.org/development/tizen-studio/download)) and create
   a signing certificate (`tizen certificate …` and `tizen security-profiles add …`). Some recent TVs
   only accept a **Samsung** certificate, created with the Samsung Certificate Extension in Tizen
   Studio's Certificate Manager.
3. **Build, sign and install:**

   ```sh
   tizen package -t wgt -s <your-profile> -o build -- app   # signed build/*.wgt
   sdb connect <tv-ip>
   tizen install -n build/<package>.wgt -t <tv-serial>     # serial from `sdb devices`
   ```

   `scripts/build.sh` makes an unsigned `build/FrigateTV.wgt`, for tools that sign at install time.

4. **Open Frigate TV** on the TV and enter your Frigate address, for example
   `http://192.168.1.10:5000`.

## Remote control

| Screen | Key | Action |
|---|---|---|
| Live | ◀ ▶ / CH ▲▼ | Previous / next camera |
| Live | ▲ ▼ | Main stream ⇄ sub stream |
| Live | 0–9 | Jump to a camera (0 is Birdseye) |
| Live | OK | Camera strip (◀ ▶ choose, OK watch) |
| Clips and recordings | ◀ ▶ | Back / forward 10 s (repeat to speed up, up to 5 min) |
| Clips and recordings | ⏪ ⏩ | Back / forward 1 min |
| Alert clips | ▲ ▼ | Previous / next alert |
| Alert clips | 🟡 YELLOW | Continue in the full recording |
| Recordings | ▲ ▼ | Previous / next event in the hour |
| Recordings | CH ▲ ▼ | Previous / next hour |
| Clips and recordings | OK, ⏯ | Pause / play |
| Anywhere | 🔴 🟢 🟡 🔵 | Alerts · Birdseye · last camera · Settings |
| Alert pop-up | OK (watching) / ⏯ | Open that camera live |
| Anywhere | BACK | Back to the menu (exits from the home screen) |

## How it works

Plain JavaScript (ES5 style), no build step and no dependencies, so it runs on older Tizen
browsers too. The source is in `app/`:

| File | Role |
|---|---|
| `js/frigate.js` | Frigate API client, matching cameras to go2rtc streams, video URLs |
| `js/player.js` | Full-screen playback: go2rtc MSE for live video, Samsung AVPlay for HLS |
| `js/mse.js` | One go2rtc MSE stream into a `<video>` (full screen and menu previews), tuned for Tizen |
| `js/events.js` | Frigate's live messages (`/ws`): new alerts |
| `js/app.js` | Screens, remote navigation, live/clip/recording flows |
| `js/i18n.js` | Translations (en, pt, es) |
| `js/keys.js`, `js/focus.js` | Remote key codes and grid focus |

Where the video comes from:

- **Live:** `ws://<frigate>:1984/api/ws?src=<go2rtc stream>` (go2rtc MSE into a `<video>` element,
  kept within 1.5 s of the live edge), or `http://<frigate>:1984/api/stream.m3u8?src=…` (HLS in AVPlay)
- **Clips and recordings:** `http://<frigate>:5000/vod/<camera>/start/<ts>/end/<ts>/master.m3u8`
- **Review items, recording summaries, snapshots:** Frigate's `/api/...`

### Adding a language

Copy the `en` block in `app/js/i18n.js`, translate it, and add the language to `LANGS`. The
tests check that every language has all the keys and the same `{placeholders}`.

## Development

```sh
node --test tests/*.test.js   # unit tests (Node.js 18+)
scripts/build.sh              # validate and package build/FrigateTV.wgt (unsigned)
```

You can also open `app/index.html` in a desktop Chrome to work on the UI: the arrow keys, Enter
and Esc stand in for the remote. Since the page runs from a file, Chrome may need
`--disable-web-security` to reach Frigate.

## Credits

- [Frigate](https://github.com/blakeblackshear/frigate) and [go2rtc](https://github.com/AlexxIT/go2rtc).
- `keys.js` and `focus.js`, and the AVPlay handling, come from
  [f1tv-tizen](https://github.com/nicbra/f1tv-tizen) (MIT).

## License

[MIT](LICENSE)
