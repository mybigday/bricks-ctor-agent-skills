# Device Health

```bash
bricks device metrics <device-id> --start-date 3d -j > metrics.json
bricks device metrics <device-id> --start-date 2026-06-01 --end-date 2026-06-09 -j > metrics.json
```

Cheap, independent of Activity Log, and frequently enough on its own. Run it **before** any event
query — it costs one request and tells you whether the device was even up.

Redirect to a file: three days of samples is over a megabyte, and piping truncates at 64 KB.

## Shape

One object per calendar day:

```json
{
  "date": "2026-01-15",
  "uptime":       [{ "timestamp": 1768470000000 }, … ],
  "memory_usage": [{ "timestamp": 1768470000000, "values": [3419614208, 7638081536] }, … ],
  "disk_usage":   [{ "timestamp": 1768470000000, "values": [17704202240, 124513931264] }, … ]
}
```

- `timestamp` is epoch milliseconds, stamped **by the server** when the heartbeat arrives — unlike
  Activity Log timestamps, which come from the device clock. See
  [Event model](event-model.md#whose-clock--read-this-before-correlating-anything) before you line
  the two up.
- `values` is `[used, total]` in **bytes** — divide to get a percentage. The `device get` view
  reports the same numbers already normalised to a 0–1 ratio.
- All three arrays share timestamps: one sample per heartbeat.
- `date` buckets by the **server's** calendar day, so near midnight it will not agree with the day an
  event falls on.

**Retention is about a month.** Metrics older than roughly 30 days stop being returned, and older
data is purged outright a couple of months after that. A historic incident will usually have events
but no metrics — `No metrics data found for this device` on a range that far back is the expected
answer, not a failure. Pull metrics while they still exist if you expect to need them.

## Heartbeat gaps are the outage signal

The heartbeat lands about **once a minute** (measured median 60.3 s). A hole in `uptime[]` is the
device not reporting — powered off, crashed, or off the network.

Detection that holds up in practice: take the median delta, flag any gap wider than
`max(3 × median, 3 min)`. On a real device over three days that surfaced 13 gaps, from 3.9 minutes up
to a 77-minute outage — none of which is visible anywhere in the event stream.

`scripts/al-report.mjs` does this for you and prints a coverage percentage (`samples ÷ expected`)
plus a table of every gap. Coverage of 94.7% over three days reads very differently from 99.9%.

Cross-reference the gap boundaries with the events — remembering that this compares the server clock
against the device clock, so a few seconds of disagreement is normal and minutes of it is a finding
in its own right:

| Pattern | Reading |
|---|---|
| Gap in heartbeat, no events either side | Device off / offline. Not an app problem |
| Gap ends with a burst of `CANVAS_FIRST_ENTER` | The player relaunched — a restart, not a network blip |
| Heartbeat continuous, events stop | App alive but wedged, or the device-side event filter excludes what is still firing |
| Heartbeat continuous, memory climbing to the gap | Look at the memory curve before calling it a network fault |
| Heartbeat and events both present but hours apart | A clock problem, not a device problem. Fix the device's time before drawing conclusions |

## Memory

Plot `used / total`. Two shapes matter:

- **Sawtooth** — a steady climb that drops vertically. The drop is the player restarting. A climb
  from 28% to 54% over ~18 hours followed by a cliff is a leak, and the cliff timestamp should line
  up with a `CANVAS_FIRST_ENTER` burst.
- **Flat but high** — the app is holding a large working set. Suspect oversized media, an
  ever-growing Items list, or generative-media caching. Cross-check `BRICK_ITEMS_*` and image-load
  events in the same window.

Absolute thresholds are device-dependent. The trend and the restart cadence carry the signal, not a
fixed percentage.

## Disk

Same `[used, total]` shape. Disk moves slowly; a step change usually means a content deployment or a
cache filling. It matters more than it looks: Activity Log itself reserves up to **30% of device
storage** for buffered events and screenshots (split roughly 1:2), so a nearly full disk both causes
playback problems *and* silently degrades the telemetry you are trying to read.

## What metrics cannot tell you

- Nothing about *what was on screen*. That is `CANVAS_ENTER` / `CANVAS_EXIT`.
- Nothing about CPU, GPU, temperature, or network throughput.
- Nothing when the workspace has no metrics for that range — historic windows on long-dormant
  devices frequently return `No metrics data found for this device`. That is a retention boundary,
  not an error; fall back to Activity Log and say which signal is missing.

For live device state that metrics do not cover — resolution, orientation, touch, camera, Local Sync
role and peer latency, player version, pending updates — use `bricks device get <id> -j`. It reflects
*now*, not the incident window, so record it as context rather than evidence.
