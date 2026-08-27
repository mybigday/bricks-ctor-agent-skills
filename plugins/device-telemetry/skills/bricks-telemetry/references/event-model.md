# Event Model

Every row returned by `bricks al events` has the same shape:

```json
{
  "device_id":  "0123456789abcdef01234567",
  "event_type": "general",
  "event_name": "GENERATOR_THERMAL_PRINTER_ON_ERROR",
  "subspace_id":"SUBSPACE_aaaaaaaa-…",
  "sender":     "GENERATOR_bbbbbbbb-…",
  "payload":    { "GENERATOR_THERMAL_PRINTER_ERROR_MESSAGE": "Printer offline", "…": "…" },
  "timestamp":  "2026-01-15T09:12:04.788Z"
}
```

`sender` and `subspace_id` are the stable ids from the application config. Join them through
`bricks app get <id> -j` to get the titles the customer uses. Without that join a report is unusable
to anyone but you.

## The three streams

### `general` — runtime events

`sender` is whatever fired the event, `payload` is that event's property map.

| `sender` prefix | Meaning |
|---|---|
| `CANVAS_…` | A canvas lifecycle event |
| `BRICK_…` | A brick's own event (press, load, animation state, template-specific) |
| `GENERATOR_…` | A generator's event (tick, and template-specific events) |
| `@INTERNAL_EVENT_QUEUE` | `FIRE_EVENT` — the runtime dispatching a queued action list |

Names seen on real devices, grouped by what they tell you:

| Event | Use it for |
|---|---|
| `CANVAS_ENTER` / `CANVAS_EXIT` | **Screen state.** Paired, they reconstruct exactly which canvas was on screen and for how long |
| `CANVAS_FIRST_ENTER` | Cold start / first visit — a burst of these is an app relaunch |
| `CANVAS_SHOWING_TIMEOUT` | A canvas auto-advancing on its timer. **Routine, not an error**, despite the name |
| `GENERATOR_TICK_TICKING` / `GENERATOR_TICK_COMPLETED` | Countdown progress. `TICKING` is per-tick and is usually the single noisiest event in the workspace |
| `GENERATOR_<TEMPLATE>_<EVENT>` | Integration outcomes — payment readers, printers, network calls. Where real failures surface |
| `BRICK_SHOW_START` / `BRICK_STANDBY` / `BRICK_BREATHE_START` | Render/animation churn. High volume, low diagnostic value |
| `BRICK_IMAGE_ON_LOAD`, `BRICK_SLIDESHOW_*`, `BRICK_ITEMS_*` | Media and list behaviour; slideshow rotation rate |
| `BRICK_SWITCH_UPDATE`, `VALUE_CHANGE` | Input and value churn |
| `FIRE_EVENT` | The action queue running — useful for "what did the app decide to do next" |
| `ACTIVITY_LOG_DROPPED_EVENT` | **A gap marker.** A payload exceeded the encoder cap and the real event was dropped. Its payload names the event that went missing |

### `data` — property-bank writes

`event_name` is always `PROPERTY_BANK_UPDATE`. `sender` is the property node
(`PROPERTY_BANK_DATA_NODE_…`), so joining the config gives you the property title directly. The
payload is either one object or an array of them:

```json
{
  "value": "Error: printer connection lost",
  "changed": true,
  "bankId": "SUBSPACE_cccccccc-…",
  "fromRoutingBankId": "SUBSPACE_aaaaaaaa-…",
  "isHit": false,
  "isHitWithoutChange": false,
  "originFromRouting": { "title": "Last printer error", "type": "string", "routing": "default" },
  "origin": [{ "handler": "SYSTEM", "action": "CHANGE_CANVAS", "parameterList": [ … ] }]
}
```

This is the richest signal in the log:

- `value` — what the state became.
- `changed` — whether it was an actual change or a rewrite of the same value.
- `bankId` vs `fromRoutingBankId` — when they differ, the write arrived by **data routing** from
  another subspace. A single logical change therefore appears once per receiving bank; do not count
  it as two independent writes.
- `origin` — the action that caused the write. This is your causal chain: "which action changed this
  value" is answerable without reading the project source.

Because the payload embeds the property definition, `data` events are large. Average event size
across a real 8-day dump was **813 bytes**, and `data` rows sit well above that. Values longer than
64K characters are replaced with `[omitted: N chars]` at the device before upload.

### `local_sync` — LAN peer stats

Emitted every ~10 s by devices in a Local Sync group, under the event name `LOCAL_SYNC_INFO`. The
device pushes its peer list, which it builds as an array of `{ id, isMain, … }` — **camelCase, and
`id`, not `device_id`**. (The activity-log server also exposes a normalised `local_sync_stats` query
using `device_id` / `is_main` / `latency`, but `bricks al` does not surface it, so that is not the
shape you get from `al events --type local_sync`.)

Use it for "which device was the main", "did a peer drop out", and latency drift. If a workspace does
not use Local Sync this stream is simply absent.

> Unlike the rest of this page, the payload shape here is read from the producer rather than from a
> captured sample — no workspace reachable during authoring used Local Sync. Sample one event and
> confirm the keys before writing a script against them.

## Whose clock — read this before correlating anything

**Activity Log timestamps are minted by the device.** The event's `timestamp` is stamped on the
device at the instant the event fires, travels with the record, and is never re-stamped on arrival.
The same is true of screenshot timestamps, which is why the epoch-ms you pass to `al screenshot
--ts` is a device-clock value.

**Device metrics timestamps are minted by the server** when the heartbeat lands. So are
`watch_dog_timer.last_alive_time` and the rest of `bricks device get`.

Consequences that bite:

- Cross-referencing a metrics outage with an event burst compares two independent clocks. It only
  works if the device's clock is right. `scripts/al-report.mjs` measures the offset between the two
  windows and prints a warning banner when they do not overlap — believe the banner over your
  intuition.
- A device with a wrong clock puts its events outside your query range entirely. That looks
  identical to "no data". If `bricks device get` says the device was alive in a window but
  `al events` is empty for it, suspect the clock before you suspect the log.
- Day boundaries differ between the two sources: metrics are bucketed by the **server's** date,
  events fall on the **device's** date. Near midnight they disagree.
- Multi-device comparisons (Local Sync, a controller and its display) line up two device clocks
  against each other. Treat sub-second ordering across devices as unreliable unless you have
  independent evidence they are in sync.
- Within one device the clock is self-consistent, so durations, ordering, and dwell times inside a
  single device's stream are trustworthy even when its absolute time is wrong.

## Cadence — what the timestamps do and do not mean

- Events are **buffered on the device and uploaded about every 2 minutes**, backing off up to 15
  minutes when uploads fail. `timestamp` is the moment the event fired, but its *arrival* can lag by
  minutes. A query run immediately after an interaction may legitimately return nothing.
- Sub-2-minute holes in the stream are batching, not downtime. Judge availability from the metrics
  heartbeat, not from event gaps.
- Screenshot capture, when enabled, runs on its own ~10 second timer independent of events.
- A device with the app parked on an idle canvas still emits animation and tick events continuously.
  Silence usually means the player stopped, not that the screen was idle.

## Noise budget

From one busy hour on one production kiosk (8,993 events, 7.2 MB):

| Event | Share |
|---|---|
| `GENERATOR_TICK_TICKING` | 39.4% |
| `VALUE_CHANGE` | 9.3% |
| `BRICK_STANDBY` | 6.8% |
| `BRICK_SLIDESHOW_CHANGE_START` / `CHANGE_END` / `ROUND_END` | 6.6% each |
| `BRICK_SHOW_START` | 5.2% |

Roughly 80% of the volume answers no diagnostic question. Two consequences:

1. When you pull a window, exclude the top offenders by pulling `--event-name` per event you
   actually need, instead of everything.
2. When a workspace is drowning in log volume, the fix is the **device-side Activity Log filter
   regex** (Controller → device → Activity Log). The generated report prints a ready-made exclusion
   pattern built from that window's top talkers — hand it over as a recommendation, since the CLI
   cannot set it for you.
