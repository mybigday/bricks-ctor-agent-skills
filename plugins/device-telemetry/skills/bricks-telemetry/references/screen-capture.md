# Screen Capture

Two independent channels put device pixels in your hands. They have different storage, different
retention, and different prerequisites — check both before telling anyone screenshots are
unavailable.

## Channel A — latest frame via Media Flow

```bash
bricks device screenshot <device-id> --no-take -o current.png   # fetch the stored frame (read-only)
bricks device screenshot <device-id> -o current.png             # ask the device to capture a fresh one
```

Available on any device, no setup required. Stores **one latest frame per device** in the workspace's
system media box — there is no history, each capture overwrites the last.

- `--no-take` is purely read-only and returns whatever was captured last, with its timestamp — often
  hours or days old. Prefer it while diagnosing.
- Without `--no-take` the CLI sends a `take-screenshot` control command to the device and waits ~3 s
  for the upload.
- **Do not poll this.** On-demand capture goes through the device's own capture path and is
  deliberately not built for a high-frequency loop; driving it in a tight loop to fake a timeline
  will degrade playback on the device. One frame to see the current state is the intended use. If you
  need a sequence, that is Channel B's job.
- It also touches a live device: get the user's agreement before capturing on anything serving
  customers.
- Requires the workspace to have Media Flow enabled (`enable_media_workspace`). Otherwise the command
  fails with "Media workspace is not enabled for this workspace".

Use it for: *what is on this screen right now*, and as the reference frame when reading a canvas
timeline.

## Channel B — screenshot history via Activity Log

```bash
bricks al screenshots --device <device-id> --start-time 2h -j > shots.json
bricks al screenshot  --device <device-id> --ts 1768470000000 -o shots/frame-1768470000000.jpg
```

**Opt-in per device.** Once the user enables screenshot capture in the device's Activity Log
settings, the device captures continuously and every frame stays retrievable for as long as the
workspace plan retains it. That is the channel for continuous monitoring and for going back to *any*
past moment inside the retention window — the thing Channel A cannot do at all.

- Capture runs on a **10 second timer** (JPEG, quality 50, long edge up to 640 px) and uploads with
  the event batches. ~360 frames per hour — enough for frame-by-frame reconstruction, and enough to
  matter for device storage. Measured on a live tablet: 26 frames over 4m21s at 10.0 s spacing,
  321×223 px, 4–5 KB each.
- **A missing frame is a signal.** Capture and upload are serialised, so a relaunch or a stall
  swallows a tick. On that same device the single 20 s gap in an otherwise perfect 10 s cadence
  landed exactly on an app switch, corroborated by a subspace change in the events at the same
  second.
- `al screenshots` returns **timestamps only**, which makes it the cheapest possible probe for
  "does this device capture at all, and when was it active". **Always run it before `al screenshot`.**
  The `--ts` you download with must come from this listing.
- The listing prints both a human timestamp and a copy-pasteable epoch-ms value. **Pass the epoch-ms
  to `--ts`.** The server matches the stored timestamp exactly, so a truncated ISO string whose
  milliseconds are non-zero — or any timestamp you derived from somewhere else, such as an event
  time — returns `Screenshot fetch failed (404): {"error":"Screenshot not found"}`. A 404 means you
  guessed a timestamp, not that the screenshot is missing.
- That timestamp is stamped by the **device** clock at capture, the same clock the events use, so
  frames and events line up with each other even when the device's absolute time is wrong.
- `--space <id>` overrides the workspace id, which is otherwise taken from the active profile.

### When it returns nothing

An empty `al screenshots` result with exit code 0 means one of three things — and none of them is
"the device was idle":

1. Screenshot capture was never enabled for that device (the common case; it is off by default).
2. The frames aged out of the workspace plan's retention window.
3. You are querying a range the device was not running in.

Enabling it is a Controller-side setting on the device (Activity Log → screenshot capture). The CLI
cannot toggle it, and `bricks device get` does not report whether it is on, so you have to separate
the three cases by probing:

- **Probe the window you are investigating first.** Frames there answer the question directly.
- **If that is empty, probe a window when the device was demonstrably running** — use
  `watch_dog_timer.last_alive_time` from `bricks device get` and take the hour before it. A device
  that has been offline for a day has no frames in the last hour no matter how capture is configured,
  so "nothing recently" proves nothing on its own.
- **Only if that is also empty** is capture genuinely off (or the frames aged out of the plan's
  retention).

Getting this wrong in the confident direction — reporting "screenshot history is not enabled" for a
device that has been capturing all along — is the easiest mistake here, and it throws away the best
evidence you have.

Say it explicitly when it applies: *"screenshot history is not enabled for this device, so the screen
reconstruction below is built from canvas events."* Then, if the device is still deployed, recommend
turning it on — it is the difference between reconstructing this incident from state and being able
to *see* the next one.

## Building a filmstrip — use the MJPEG stream

`--stream` replays a whole window as a single **MJPEG** request instead of one round trip per frame:

```bash
bricks al screenshot --device <id> --stream --from 40m -o ./shots
bricks al screenshot --device <id> --stream \
  --from 2026-01-15T09:00:00Z --to 2026-01-15T09:30:00Z -o ./shots
bricks al screenshot --device <id> --stream --from 2h --max-frames 60 -j -o ./shots
```

`--from` / `--to` take ISO, epoch-ms, or the usual relative shorthand (`30m`, `2h`, `1d`); `--to`
defaults to now. Frames land in the `-o` directory (default `./screenshots`) as
`screenshot-<device>-<epoch-ms>.jpg`, named from each part's `X-Timestamp` — exactly what
`al-report.mjs --screenshots` expects. `--max-frames <n>` stops early, `-j` prints a manifest of
every saved frame.

Measured on a live device, same 26 frames both ways:

| Path | Requests | Wall clock |
|---|---|---|
| `bricks al screenshot --ts …` in a loop | 26 | **26.8 s** |
| `bricks al screenshot --stream` | 1 | **1.4 s** |

A 7-day window returned 141 frames / 605 KB in 2.0 s, so there is no need to thin the range the way
the per-frame path demanded. Two behaviours to know:

- **The stream is oldest-first**, the opposite of the `al screenshots` GraphQL listing. Do not assume
  they agree.
- **It is a replay, not a live tail.** Passing a `to` in the future does not hold the connection open
  — the server sends what it has and closes. For continuous monitoring, re-request on an interval and
  advance `--from`.

Use `--ts` when you want exactly one frame; use `--stream` for anything that is a sequence.

Then pass `--screenshots ./shots` to `scripts/al-report.mjs`. It parses the epoch-ms out of each
filename, samples evenly down to `--max-shots` (default 60), and embeds them base64 in the report so
the HTML stays self-contained.

## Reconstruction without screenshots

`CANVAS_ENTER` and `CANVAS_EXIT` give you exact screen state at millisecond resolution — better
temporal precision than a 10-second capture timer, and available on every device that logs events at
all. The report renders them as one occupancy lane per subspace, so a multi-subspace app shows the
main flow and each embedded module side by side.

When only lanes exist, pair them with the `PROPERTY_BANK_UPDATE` values in the same window to
describe the screen's contents from state rather than pixels.

## Which channel is lying

Events and frames have **complementary blind spots**, and knowing which one to distrust matters more
than having both.

### Camera and video never appear in a capture

**Camera, video, and other GPU-composited surfaces are drawn straight into GPU memory, which the
screenshot API cannot read back.** They come out blank in every frame, on every device, always. This
is a property of the capture path, not a fault, and it is the single easiest way to misread a
filmstrip.

A real 26-minute window on a production tablet shows how convincing the trap is: the filmstrip was blank
white for 23 of those minutes, which looks exactly like a dead app. The events disagreed — 169,484 of
them, zero error-shaped, a clean canvas timeline, and `BRICK_CAMERA_STATE_CHANGE` reporting
`BRICK_CAMERA_STATUS: READY`. The events were right. The app was a camera app rendering a camera
preview, and the preview is precisely what a screenshot cannot contain.

So: **before reporting a blank screen, check whether that region is a Camera, Video, VideoStreaming,
or WebRTC brick.** The app config tells you (`brick_map[*].template_key`), and `al-report.mjs` prints
a warning on the filmstrip when it finds one.

But "expected blank" is not the end of the analysis — it is the start of a different one. Over a
GPU-composited region the frames carry **no information in either direction**: a healthy camera and a
dead one produce the identical white rectangle. So the region still has to be evaluated, just from
the application's own state instead of from pixels:

- `BRICK_CAMERA_STATE_CHANGE` — `BRICK_CAMERA_STATUS`, plus the permission fields, which is how you
  tell "running" from "never started" and from "denied".
- `BRICK_VIDEO_*` events — progress, subtitle cues, and end-of-media, which prove a video is actually
  advancing rather than stalled on frame one.
- The property-bank values and canvas lanes driving that brick — is it even on the canvas the app
  thinks it is, with the source it should have?

Report the region as *unverifiable from capture* and state what the events say about it. Never
report it as blank, and never report it as fine just because the app was emitting events.

### What the filmstrip is genuinely irreplaceable for

Everything the runtime does not model as an event: a missing or broken image, wrong language, stale
prices, a layout collapsed at the wrong resolution, a native dialog or OS overlay on top of the app,
a third-party splash. In that same window the frames also recovered a sequence no event carried —
the app's own UI, then the BRICKS launcher's idle screen during an app switch, then the
next app. Reading those states off the pixels took seconds.

Use the lanes to know *which* screen and for how long, the property values to know what it was
supposed to show, and the frames to see what it actually looked like — while remembering the frames
cannot show you a camera or a video.
