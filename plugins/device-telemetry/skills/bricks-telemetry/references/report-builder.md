# Report Builder

`scripts/al-report.mjs` turns the files you pulled into one self-contained HTML page. No
dependencies, no network, no build step — it runs on `node` or `bun` and writes a single file the
user can open, keep, or attach to a ticket.

**The report is the deliverable.** Your message should be a short verdict plus the absolute path,
and the user has to be able to open it — offer to launch it locally, or serve the directory over
`127.0.0.1` when they are on a remote box. Do not paste the timeline back as prose, and do not leave
them holding a path they cannot reach.

**It is also only a baseline.** The sections below are the questions that come up on most
investigations, not the limit of what the data answers. When the user asks something these sections
do not cover — a funnel, a fleet comparison, an export for their own tooling — write that analysis
yourself and either add it to this page or ship a sibling artifact. See
[Custom analysis](custom-analysis.md).

## Running it

```bash
node /absolute/path/to/bricks-telemetry/scripts/al-report.mjs \
  --events events.jsonl \
  --config app-config.json \
  --metrics metrics.json \
  --device device.json \
  --screenshots ./shots \
  --title "Lobby kiosk — reader failure 2026-06-08" \
  -o reports/lobby-2026-06-08.html
```

| Flag | Source | Effect if omitted |
|---|---|---|
| `--events <file>` | `bricks al events … --jsonl` (repeatable) | Nothing to analyse; only the health section renders |
| `--config <file>` | `bricks app get <app-id> -j` (repeatable) | Ids render raw — unreadable to anyone but you |
| `--metrics <file>` | `bricks device metrics <id> … -j` (repeatable) | Health section shows how to get it |
| `--device <file>` | `bricks device get <id> -j` | Falls back to the device id from the events |
| `--screenshots <dir>` | files named `…<epoch-ms>.jpg` | Filmstrip section is omitted |
| `--title <str>` | — | Auto-titled from the device name |
| `--benign <regex>` | your deployment's routine-but-alarming event names | Only the built-in benign list applies |
| `--filtered` | set it when the pull was narrowed with `--event-name` | Auto-detected, but say so explicitly to be sure |
| `--max-rows <n>` | default 1500 | Raw-event table size |
| `--max-shots <n>` | default 60 | Frames embedded (evenly sampled) |
| `-o <file>` | required | — |

The output directory is created for you, so `-o reports/…` works in a fresh project.

Repeat `--events` when a window had to be split by event name, and `--config` for multi-app or
module-heavy setups. `--config` accepts either the `bricks app get` envelope or a bare config object,
so `.bricks/build/application-config.json` works too — but for a past incident prefer the server
config, because your local build reflects your working tree rather than what the device ran.

Performance is not a concern: 8,993 events across 7.2 MB rendered in 0.14 s, and 169,484 events
across 85 MB rendered in 0.74 s at ~380 MB RSS, producing a 0.85 MB page with a 44-frame filmstrip.

Fill `--screenshots` with `bricks al screenshot --stream --from … -o ./shots` (one MJPEG request)
rather than a loop of per-frame downloads — see
[Screen capture](screen-capture.md#building-a-filmstrip--use-the-mjpeg-stream).

## What each section answers

| Section | Question |
|---|---|
| **Summary** | Scope and scale — device, window, event count, bytes, how many ids got named, plus a ready-made device-side filter regex when a few event names dominate |
| **Device health** | Was it up? Heartbeat count, coverage %, every outage with duration, memory and disk curves — one block per device, since merging devices hides outages |
| **Event volume** | When was it busy, when silent — stacked by event type, with silent gaps called out against the ~2 min upload cadence |
| **Screen state reconstruction** | What was on screen, when, for how long — one occupancy lane per subspace plus a dwell table (enters, on-screen time, share) |
| **Screenshot filmstrip** | What it actually looked like, when history is enabled — with a warning when the app has a Camera/Video brick, whose region is blank in every capture |
| **Anomalies** | Error-named events first, then payloads containing error text. `CANVAS_SHOWING_TIMEOUT` and other routine-but-alarming names are excluded |
| **State changes** | Which property-bank nodes were written, how often (logical writes, with routed duplicates collapsed), and their latest value |
| **Event catalog** | Every event name with count, share, and bytes — the noise budget |
| **Raw events** | Client-side filterable table for drilling into a specific moment |

The page is theme-aware (follows the viewer's light/dark preference) and needs no server — charts are
static inline SVG with hover tooltips; only the raw-event filter uses JavaScript.

## Reading the anomaly list critically

The detector is heuristic on purpose: it flags event names containing `ERROR`, `FAIL`, `TIMEOUT`,
`DISCONNECT`, `CRASH`, `REJECT`, `DENIED`, `LOST`, `DROPPED`, and payloads containing error-ish text.
Name hits are ranked above text hits and marked differently.

Two traps:

- **Benign names.** `CANVAS_SHOWING_TIMEOUT` is a canvas advancing on schedule. It is already
  excluded, along with `GENERATOR_TICK_COMPLETED` and `BRICK_VIDEO_ON_END`. For anything else
  routine in *this* deployment, pass `--benign '<regex>'` — do not edit `BENIGN_NAME` in the script,
  because a plugin update replaces the shipped skill files and your edit disappears.
- **Handled failures.** An error followed within a second or two by property writes and a canvas
  change means the app caught it and recovered. Check whether the recovery completed before
  escalating — a retry that succeeds seconds later is a very different report from one that does not.

## Worked example

Shape of a real investigation, with the customer's names replaced by placeholders. A self-service
kiosk logged 142 events in a 21-second burst after a cold start. The report showed:

- **Screen state**: `Init` → `Connecting` → `Connected` → `Standby` (70% of the window),
  reconstructed purely from canvas events — screenshot history was not enabled on that device.
- **Anomalies**: a `GENERATOR_<PERIPHERAL>_ON_ERROR` naming the method that failed and the message
  *"connection was lost"*, 11.6 s after the peripheral began initialising.
- **State changes**: the error string written to two banks in the same millisecond (data routing
  carrying it from the main subspace into a second one), then an alert-trigger property toggled true
  and back to false.
- **Event catalog**: a retry started 0.3 s later and reported success 4.7 s after that.

Verdict in three sentences: transient network loss during peripheral initialisation, the app's error
path fired correctly, and the retry recovered — no code change needed, investigate site connectivity.
That is the shape of a good answer; the report carries everything backing it.

Note how little of that came from any single section. The canvas lanes gave the sequence, the
anomaly row gave the cause, the property writes proved the app *handled* it, and the catalog proved
the recovery finished. A verdict that leans on one section alone is usually premature.

## Extending it

The script is plain ES modules, roughly: parse args → build the id→title map from configs → load and
sort events → derive aggregates (catalog, canvas lanes, property writes, anomalies, silence) →
metrics → render SVG and HTML. The helpers you will want — `label(id)`, `esc()`, `dur()`, `pct()`,
`bytes()`, and the chart builders — are already in scope.

Natural extensions and where they go:

- **A funnel** — group `CANVAS_ENTER` by canvas title in order and compute drop-off between stages;
  add a section next to the dwell table.
- **Per-hour behaviour** — bucket events by hour-of-day instead of by window position, for
  "when do people actually use this".
- **Interaction heat** — rank `BRICK_*_ON_PRESS` by `sender`, joined to brick titles.
- **Multi-device comparison** — pass several `--events` files from different devices; `devices` is
  already tracked per event, so a per-device breakdown is a small addition.
- **Different anomaly rules** — edit `ERROR_NAME` / `ERROR_TEXT` / `BENIGN_NAME` near the anomaly
  section.

**Anything you edit in the shipped script is temporary.** A plugin update replaces the shipped
skill files, so local edits are silently reverted.
Per-deployment tuning belongs in a flag (`--benign`, `--filtered`); anything larger belongs in a
sibling script you own. [Custom analysis](custom-analysis.md) covers the choice and the JSONL
patterns. Change the shipped file only when you intend to ship the change back.

Keep the output self-contained: inline everything, embed images as data URIs, and never add an
external stylesheet, font, or script.
