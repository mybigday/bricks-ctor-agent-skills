---
name: bricks-telemetry
description: Analyse what real BRICKS devices and their users actually did, from `bricks device metrics` (uptime heartbeat, memory, disk) and `bricks activity-log` (every runtime event, plus screenshot history when enabled). Use for fault diagnosis (freeze, restart, wrong screen, failed payment or print), operator and end-user behaviour analysis (which bricks get pressed, dwell per screen, funnels and drop-off, sessions, busy hours, attended vs unattended), screen monitoring and state reconstruction (what was on screen minute by minute, with or without screenshots), fleet and usage reporting, and custom questions answered from the raw event stream. Also covers the query-cost rules that keep a pull from becoming a multi-hundred-megabyte download. Triggers on device troubleshooting, "why did the device do X", crash or freeze reports, uptime or memory questions, user/usage/engagement analysis, tap or touch analysis, session replay, screenshot history, activity log queries, or any request for a device report.
license: MIT
---

# BRICKS Telemetry

Answer questions about **what happened on real devices** — not about the project source. The project
tells you what the app *should* do; device metrics and Activity Log tell you what it *did*, and what
the people standing in front of it did.

## If you read nothing else

1. Always pass `--device`. An unfiltered 8-day pull is 148 s and 280 MB; the same window filtered is
   4.2 s and 703 KB. `--limit` does not help.
2. Redirect to a file (`> events.jsonl`), never pipe — piping truncates at 64 KB.
3. Join the app config, or your report is full of uuids nobody can read.
4. Deliver an HTML file inside the project, and make sure the user can actually open it.
5. Camera and video regions are blank in every capture. That is the capture path, not a fault.
6. Raise the command timeout before a bulk pull. The CLI has none of its own; the runner kills it at
   30 s by default and leaves a valid-looking, incomplete file.

The reference files carry the detail; these six are what go wrong without them.

## What this data can answer

These are the questions people ask most, not a closed list. The same three streams answer anything
you can express as "which events, in what order, with what state".

| Question shape | Primary signal | Start at |
|---|---|---|
| Why did it break / stall / restart? | metrics heartbeat gaps + error-shaped events | [Device health](references/device-health.md) |
| What did users do? What gets pressed, where do they drop off? | `BRICK_*_ON_PRESS` family + canvas transitions | [Behaviour analysis](references/behaviour-analysis.md) |
| What was on screen at 14:32? | `CANVAS_ENTER` / `CANVAS_EXIT` lanes, + filmstrip | [Screen capture](references/screen-capture.md) |
| Is this fleet healthy / how much is it used? | metrics across devices + event volume | [Device health](references/device-health.md) |
| Anything else the user actually asked for | the raw JSONL | [Custom analysis](references/custom-analysis.md) |

**The bundled report is a baseline, not the answer.** `scripts/al-report.mjs` covers the common
ground so you are never starting from a blank page. The moment the user has a specific question it
does not answer, write the analysis yourself against the JSONL — see
[Custom analysis](references/custom-analysis.md). Do not force a bespoke question into the generic
report, and do not tell the user something is impossible because the report has no section for it.

## The one rule that decides whether this goes well

**Activity Log stores nearly every runtime event a device emits, and query cost tracks the time
range and the device filter — not how many rows you asked for.** Measured on real production
workspaces:

| Query | Wall clock | Rows | Bytes |
|---|---|---|---|
| 8 days, **no** `--device` | **148 s** | 344,345 | **280 MB** |
| 8 days, one `--device` | 4.2 s | 1,078 | 703 KB |
| 1 day, one `--device` | 2.5 s | 142 | 60 KB |
| 3 days, one `--device` + `--event-name CANVAS_ENTER` | 5.0 s | 2,396 | 779 KB |

`--limit` is an **output cap only**. An 8-day unfiltered query with `--limit 3` still took over two
minutes, because the server scans the range either way. Always narrow with `--device` first, then
`--event-name` / `--type` / `--subspace` / `--sender`, and only then widen the window.

Never load raw events into your context. Stream them to a file with `--jsonl` and analyse the file.

## The other rule: two different clocks

**Activity Log timestamps are stamped by the device; device metrics are stamped by the server.**
Nothing reconciles them. So a heartbeat outage and an event burst only line up if the device's clock
is right, a device with a wrong clock files its events outside your query range and looks like it
logged nothing, and metrics days and event days disagree near midnight. The report tool measures the
offset between the two windows and warns when they do not overlap. Within one device the clock is
self-consistent, so durations and ordering inside a single event stream are always safe.

> **Redirect, never pipe.** `bricks … -j | anything` truncates at exactly 65,536 bytes — the process
> exits before the pipe drains. `bricks … -j > file.json` is correct and gets the full payload
> (verified: 1.27 MB written to a file vs 64 KB through a pipe). This applies to every large `-j` /
> `--jsonl` output.

## Workflow

### 1. Establish the target

```bash
bricks auth status                       # confirm the right workspace is active
bricks device list -j > devices.json     # id, name, bound app, last_alive_time
bricks device resolve "Lobby" -j         # human name -> stable id
bricks device get <device-id> -j > device.json

# one probe settles whether this workspace's token can read Activity Log at all
bricks al screenshots --device <device-id> --start-time 7d -j
```

`Unauthorized` there is token/workspace-wide, so trying other devices is wasted effort — and note
that `bricks doctor` reports `ok: true` regardless, because it never touches Activity Log. The usual
cause is the credential *kind*: **workspace tokens frequently cannot read Activity Log while the same
account can over OAuth.** Run `bricks auth login` and retry before reporting an access gap. If
`device list` is rejected for scope reasons, `bricks app get <app-id> -j` still yields device ids in
`id_for_devices`.

`device.json` gives you `bound_application`, `entry_detail.operation_version` (device OS),
`entry_detail.update.current_version` (player build), screen resolution/orientation, and
`watch_dog_timer.last_alive_time`. A `last_alive_time` weeks in the past means you are
investigating history, not a live device — say so before spending a query.

### 2. Check health before touching the event log

```bash
bricks device metrics <device-id> --start-date 3d -j > metrics.json
```

Cheap, and for a fault it often ends the investigation. The `uptime[]` array is a ~60 s heartbeat:
**holes in it are outages**, and the `memory_usage` curve shows leaks as a sawtooth that resets when
the player restarts. Metrics are only retained for about a month, so an older incident will have
events but no metrics — that is expected, not a failure.
See [Device health](references/device-health.md).

### 3. Find the window, do not guess it

Probe with the cheapest query that can prove data exists, then narrow:

```bash
# does this device log at all, and when? probe the window you are investigating,
# not just "recently" -- an offline device has no recent frames even with capture on
bricks al screenshots --device <device-id> \
  --start-time 2026-01-15T09:00:00Z --end-time 2026-01-15T09:30:00Z -j > shots.json
bricks al events --device <device-id> --start-time 1h --limit 20 -j          # shape check
```

`al screenshots` is also how you get a valid `--ts`: `al screenshot --ts` matches the stored
timestamp exactly, so the only values that work are the ones this listing prints, and a 404 means the
timestamp was invented rather than the frame being missing. `--stream --from/--to` needs no listing —
it takes a time range directly — so the listing is a prerequisite for single-frame downloads only.

Empty results are information: see [Query cost & filters](references/query-cost.md) for how to tell
"no data" apart from "logging disabled" and "not authorised".

### 4. Bulk-pull the window as JSONL

```bash
bricks al events --device <device-id> \
  --start-time 2026-01-15T09:00:00Z --end-time 2026-01-15T09:20:00Z \
  --jsonl > events.jsonl
```

Widen in bounded steps. If one window is still too large, split by `--event-name` and concatenate —
the report tool accepts repeated `--events` files, and `--filtered` tells it the sample is a narrowed
slice so it does not read the mix as a noise profile. The CLI refuses ranges wider than 30 days — a
client-side guard, not a server limit, so step through consecutive windows rather than trying to
defeat it.

**Give this command a longer timeout than the default.** `bricks al` sets no timeout of its own, so
the pull runs until the *runner* kills it — 30 s in CTOR Desktop's Bash tool, which its `timeout`
parameter raises to 5 minutes. A dense five-minute window measured 5.4–12.0 s across identical runs,
so the default is close enough to bite intermittently. A killed `--jsonl` pull leaves a file that
parses cleanly and is simply missing its oldest events, so confirm the last line reaches your
`--start-time` before analysing — see
[Query cost & filters](references/query-cost.md#execution-timeouts-kill-the-pull-from-outside).

For a behaviour question you usually want the opposite of everything: pull only the interaction
events, which is both cheaper and cleaner. See
[Behaviour analysis](references/behaviour-analysis.md).

### 5. Join the ids to names

Event `sender` / `subspace_id` are stable ids (`BRICK_…`, `CANVAS_…`, `GENERATOR_…`,
`PROPERTY_BANK_DATA_NODE_…`). The application config turns them into the titles the user knows —
without this join, a report about "which button" is unreadable:

```bash
bricks app get <application-id> -j > app-config.json     # what the device was actually running
```

Prefer the server config over the local `.bricks/build/application-config.json` when investigating a
past window — the local build reflects your working tree, not the release the device ran.

`bound_application` is what the device runs **now**, which need not be what it ran during your
window. If the report shows subspaces the config does not name, the device switched apps mid-window;
pass the other app's config too (`--config` repeats) rather than assuming the ids are junk.

### 6. Analyse, then deliver a report

**If the probe in step 3 returned screenshots and the question is about what was on screen, pull
them.** Frames answer "what was actually displayed" in a way canvas lanes cannot, and skipping them
when they exist is the most common way this workflow under-delivers. One MJPEG request gets the whole
window (26.8 s → 1.4 s versus a download per frame):

```bash
bricks al screenshot --device <device-id> --stream \
  --from 2026-01-15T09:00:00Z --to 2026-01-15T09:30:00Z -o ./shots
```

**Camera and video regions are blank in every capture** — they composite in GPU memory, which the
screenshot API cannot read back. Never report a blank screen without checking the app config for a
Camera/Video brick first; the report flags this for you.

Then build the baseline report, and extend it or write your own analysis on top:

```bash
node /absolute/path/to/bricks-telemetry/scripts/al-report.mjs \
  --events events.jsonl \
  --config app-config.json \
  --metrics metrics.json \
  --device device.json \
  --screenshots ./shots \
  --title "Lobby kiosk — 2026-01-15" \
  -o reports/lobby-2026-01-15.html
```

**Hand the user an HTML file, not a transcript.** A short verdict (2–4 sentences: what happened or
what the data shows, and what to do about it) plus the absolute path — and check they can open it: a
local path if they are on this machine, a `python3 -m http.server` localhost URL if they are not.
The report carries the evidence. When the question needed custom analysis, put that analysis *in* the
page rather than in chat — [Custom analysis](references/custom-analysis.md) shows how.

## Rules index

| Reference | Read it when |
|---|---|
| [Query cost & filters](references/query-cost.md) | Before the first `al events` call — filter order, empty-vs-unauthorised, 30-day limit, JSONL discipline |
| [Event model](references/event-model.md) | Interpreting `event_type` / `event_name` / `sender` / `payload`, whose clock is whose, and which events are noise |
| [Behaviour analysis](references/behaviour-analysis.md) | Any question about people — presses, dwell, funnels, sessions, attended vs unattended |
| [Device health](references/device-health.md) | Heartbeat gaps, memory sawtooth, disk pressure, what metrics cannot tell you |
| [Screen capture](references/screen-capture.md) | Two screenshot channels, `--stream` filmstrips, and the Camera/Video capture blind spot |
| [Report builder](references/report-builder.md) | Running the baseline report and what each section answers |
| [Custom analysis](references/custom-analysis.md) | The user's question is not one the baseline report answers |

## Hard rules

- Read [Query cost & filters](references/query-cost.md) before the first bulk pull. A slow query you
  cancel still cost the server the full scan.
- Never start an investigation with an unfiltered workspace-wide query.
- Redirect large output to a file; never pipe it.
- Activity Log and device metrics are **read-only**. `bricks device control`, `refresh`,
  `clear-cache`, and `remove` change a live device — resolve the target, state what will happen, and
  get explicit confirmation first. Analysis never requires them.
- **The report has to be openable.** Writing the file is not delivering it. Give the absolute path;
  if the user is on the machine, offering to open it (`xdg-open` / `open` / `start`) is usually
  enough. If they are on a remote or headless box, serve it locally instead of leaving them stuck —
  `python3 -m http.server` from the report's directory, then hand them the `127.0.0.1` URL and stop
  the server when they are done.
- **Keep it on the customer's own infrastructure.** The report embeds their device telemetry,
  screenshots of their screens, and their app's internal structure, so it does not belong on a
  third-party host, paste service, or public URL — a local file or a localhost URL is the whole
  intended range. Same for the pulled JSONL and frames.
- Behaviour analysis is data about **people**. Report on aggregates and flows rather than
  reconstructing individual visits, and do not combine it with camera output to identify anyone.
