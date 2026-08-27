# Device Telemetry

Field investigation for CTOR projects: device metrics plus Activity Log events in, one
self-contained HTML report out. One skill, opt-in:

- **`bricks-telemetry`** — answers "what happened on the real device" questions from
  `bricks device metrics` (uptime heartbeat, memory, disk) and `bricks activity-log`
  (every runtime event, plus screenshot history when enabled): fault diagnosis (freeze,
  restart, wrong screen, failed payment or print), operator and end-user behaviour
  analysis (presses, dwell, funnels, sessions), minute-by-minute screen reconstruction
  with or without screenshots, and open-ended questions answered straight from the raw
  event stream.

Try prompts like:

- "The lobby kiosk froze yesterday afternoon — what happened?"
- "Which buttons do people actually press, and where do they drop off?"
- "What was on this device's screen between 9:00 and 9:30?"

## Notes

- **Filter-first by design.** Activity Log query cost tracks the time range and device
  filter, not row count — an unfiltered 8-day pull is minutes and hundreds of MB; the
  same window with `--device` is seconds. The skill's query-cost rules keep pulls cheap,
  and raw events stream to JSONL files rather than into the agent's context.
- The bundled `al-report.mjs` builds a baseline HTML report (health, timeline, screen
  state, behaviour, anomalies); the skill directs the agent to write custom analysis
  against the JSONL when the question needs one.
- Reading Activity Log usually requires OAuth credentials (`bricks auth login`) —
  workspace tokens frequently cannot access it.
- Everything is read-only, and reports embed customer telemetry: they belong on the
  customer's own machine or LAN, never a third-party host.
