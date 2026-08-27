# Behaviour Analysis

Questions about the **people** in front of the screen: what they pressed, how long they stayed, where
they gave up, when the place is busy. The event stream supports all of it, but only if you first
separate what a human did from what the app did on its own.

## The press family is the ground truth for touch

A pressable brick dispatches `<TEMPLATE_KEY>_ON_PRESS`, so the event name in the log is
`BRICK_<TEMPLATE>_ON_PRESS` and **`sender` is the brick that was touched** — join it through the app
config and you have the button's title.

| Event | Meaning |
|---|---|
| `BRICK_<TEMPLATE>_ON_PRESS` | A completed press. `BRICK_RECT_ON_PRESS`, `BRICK_TEXT_ON_PRESS`, `BRICK_IMAGE_ON_PRESS`, … |
| `BRICK_<TEMPLATE>_ON_PRESS_IN` / `_ON_PRESS_OUT` | Touch down / up. Present only when the app wires them; their gap is dwell-on-button |
| `BRICK_CHART_ON_PRESS`, `BRICK_MAPS_ON_MAP_PRESS`, `BRICK_MAPS_ON_MARKER_PRESS` | Presses that carry *what* was hit in the payload, not just that something was |

**Outlets are not events, and some names are both.** `BRICK_PRESSING` exists only as an outlet (a
live property other bricks bind to), so it never reaches Activity Log and looking for it is a dead
end — press-state styling is invisible here. Other names, such as `BRICK_CAMERA_BARCODE_READ`, are
declared in *both* a brick's `eventTypes` and its `outletTypes`: the outlet is the current value, the
event is the moment it changed, and only the event is logged. So finding a name in the product's
source is not proof it appears in the stream — confirm against a real sample.

Other genuine human input:

| Area | Events |
|---|---|
| Text entry | `BRICK_TEXT_INPUT_ON_CHANGE`, `_ON_SUBMIT`, `_ON_FOCUS`, `_ON_BLUR`, `_ON_MATCH`, `_ON_NOT_MATCH`, `_ON_FULL_FILL`, `_ON_EMPTY` |
| Lists / paging | `BRICK_ITEMS_ON_SCROLL`, `_ON_PAGE_CHANGE`, `_ON_END_REACHED`, `_ON_INTO_DETAIL_MODE`, `_ON_INTO_LIST_MODE` |
| Charts | `BRICK_CHART_ON_PRESS`, `BRICK_CHART_ON_LEGEND_SELECT_CHANGED` |
| Maps | `BRICK_MAPS_ON_REGION_CHANGE` (pan/zoom) |
| Drawing | `BRICK_SKETCH_ON_STATE_CHANGE`, `_ON_TOOL_CHANGE` |
| Scanning / vision | `BRICK_CAMERA_BARCODE_READ`, `_FACE_DETECTED`, `_PICTURE_TAKEN` |

**Confirm the names against the app before trusting a count.** Which templates are pressable depends
on the app, and a brick only emits if its handler is wired. This table is a starting point for what
to look for, not a list of what any given app produces: sample a window where you know someone
interacted, list the distinct `event_name` values, and work from what is actually there.

```bash
bricks al events --device <id> --start-time 30m --jsonl > sample.jsonl
node -e 'const c={};for(const l of require("fs").readFileSync("sample.jsonl","utf8").split("\n"))
  if(l.trim())c[JSON.parse(l).event_name]=(c[JSON.parse(l).event_name]||0)+1;
  console.log(Object.entries(c).sort((a,b)=>b[1]-a[1]))'
```

## Human vs machine — the distinction everything else rests on

Most events in a busy stream are the app talking to itself. Counting them as activity produces
confident nonsense: a screen alone in a dark room emits tens of events per second.

| Machine-driven (ignore for behaviour) | Why |
|---|---|
| `GENERATOR_TICK_TICKING` / `_COMPLETED` | A timer. Frequently 30–50% of all volume |
| `CANVAS_SHOWING_TIMEOUT` | A canvas auto-advancing on schedule |
| `BRICK_SHOW_START`, `BRICK_STANDBY`, `BRICK_BREATHE_START` | Render and animation churn |
| `BRICK_SLIDESHOW_CHANGE_*`, `_ROUND_END` | Slideshow rotating on its own |
| `FIRE_EVENT` (`@INTERNAL_EVENT_QUEUE`) | The action queue executing |
| `PROPERTY_BANK_UPDATE` | State writes — a *consequence*, human or not |

The load-bearing rule for canvas transitions:

- A `CANVAS_ENTER` **preceded by `CANVAS_SHOWING_TIMEOUT` in the same subspace** is the app advancing
  itself. Unattended.
- A `CANVAS_ENTER` **preceded by a press** is a person navigating. Attended.

Everything downstream — sessions, funnels, "is anyone actually using this" — depends on getting that
split right. Do it explicitly rather than assuming every canvas change is a user.

## Pull only what you need

Behaviour questions are the best case for server-side filtering, because the interesting events are a
tiny slice of the volume:

```bash
# every press on this device for a day, one event name at a time
bricks al events --device <id> --event-name BRICK_RECT_ON_PRESS \
  --start-time 2026-01-15T00:00:00Z --end-time 2026-01-16T00:00:00Z --jsonl > press.jsonl

# how often one specific button was used — `--sender` is a server-side filter
bricks al events --device <id> --sender BRICK_<uuid> --start-time 7d --jsonl > button.jsonl

# the navigation skeleton, without any of the churn
bricks al events --device <id> --event-name CANVAS_ENTER --start-time 7d --jsonl > nav.jsonl
```

`--sender` turns "how many times was the *Checkout* button pressed this week" into a single cheap
query once you have the brick id from the config.

## Recipes

### Sessions

There is no session id. Derive one: sort interaction events by time and cut a new session whenever
the gap exceeds an idle threshold (start around 60–120 s and check it against the app's own
attract/standby timeout). Corroborate with the canvas lanes — most kiosks return to a standby canvas
between users, and that return is a cleaner boundary than any timeout you pick.

Report: sessions per hour, interactions per session, session duration, and the share of sessions that
reached a completion canvas.

### Funnels and drop-off

Take `CANVAS_ENTER` in order per session, map ids to titles, and count how many sessions reach each
stage of the intended path. Drop-off concentrates at one stage far more often than it spreads evenly
— name that stage, and pair it with the dwell time before the exit, because "left after 40 s" and
"left after 2 s" are different problems.

### Dwell and attention

Per canvas: total on-screen time, mean and median per visit, visits per session. The baseline report
already computes occupancy; behaviour work usually wants it *per session* and split attended vs
unattended, which is a small script on top of the same lanes.

### Interaction heat

Group presses by `sender`, join titles, rank. This is the "which buttons matter" answer. Two caveats
worth stating in any report: bricks with no press handler wired are invisible regardless of how often
they are touched, and a brick reused across canvases aggregates unless you also group by
`subspace_id` plus the canvas that was active at that moment.

### Busy hours

Bucket interaction events by hour-of-day across several days. Use the **device** clock — that is what
Activity Log records — and state the timezone assumption explicitly, because a device whose clock is
wrong will shift the whole profile without any other symptom.

## Honesty about what this is not

- **Not per-person.** There is no identity in the stream. Sessions are time-based guesses; two people
  in quick succession are one session, and one person who pauses is two. Say so.
- **Not every touch.** Only bricks with a wired handler emit anything. A press on a decorative brick,
  or a swipe the app does not handle, leaves no trace — so "no presses here" can mean "nobody pressed
  it" *or* "nothing was listening".
- **Not the whole screen.** If the device-side Activity Log filter regex excludes an event name, it
  never left the device and no query recovers it. Check the filter before concluding a control is
  unused.
- **Not people-tracking.** Report flows and aggregates. Do not reconstruct individual visits, and do
  not combine this with camera output to identify anyone.
