# Custom Analysis

`scripts/al-report.mjs` is a **baseline**. It answers the questions that come up on most
investigations — was it up, what was on screen, what errored, what got written, how noisy is the log
— so you never start from nothing. It is deliberately generic, and it is not the ceiling.

**When the user's question is not one of those, the JSONL is the real artifact and the analysis is
yours to write.** Do not bend the generic report into a shape it was not built for, and never tell
the user something cannot be answered because the report has no section for it.

## Deciding what to build

| Situation | Do this |
|---|---|
| The question is one of the baseline sections | Run the report, read it, answer |
| The question needs one extra view alongside the usual context | Run the report, write a small script for the extra view, and **add it to the page** |
| The question is entirely bespoke (a funnel, a fleet comparison, an export) | Write a purpose-built script; skip the baseline or keep it as an appendix |
| The user wants the numbers in their own tooling | Aggregate to CSV/JSON and hand that over instead of HTML |

The deliverable stays the same shape either way: **a self-contained artifact plus a short verdict.**
A bespoke answer buried in chat is worth less than a page the user can re-open next week.

## Working the JSONL

Every line is one event, already documented in [Event model](event-model.md). A file can be hundreds
of megabytes, so stream it and keep only what you aggregate — never read it whole into your context.

```js
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const counts = new Map()
const rl = createInterface({ input: createReadStream('events.jsonl'), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line) continue
  const e = JSON.parse(line)
  counts.set(e.event_name, (counts.get(e.event_name) || 0) + 1)
}
```

For files small enough to hold (tens of MB), `readFileSync(...).split('\n')` is fine and simpler.
`al-report.mjs` does exactly that and digests 169k events / 85 MB in 0.6 s.

Two things to get right every time:

- **Sort by timestamp.** The server returns **newest-first**. Anything order-sensitive — sessions,
  funnels, dwell, "what happened next" — is wrong if you skip this.
- **Join the ids.** Build the id→title map from the app config exactly as the report does: walk
  `config.subspace_map[*]` and each of `canvas_map` / `brick_map` / `generator_map` /
  `property_bank_map`, reading `title` and `template_key`. A report full of uuids is unusable to the
  person who asked.

## Reusing the report as a scaffold

`al-report.mjs` is plain ES modules with no dependencies, structured as: parse args → build the
id→title map → load and sort events → derive aggregates → render inline SVG and HTML. Two ways to
build on it:

**Add a section.** Compute your aggregate near the others and render it next to the existing ones.
The helpers are already there — `label(id)`, `esc()`, `dur()`, `pct()`, `bytes()`, and the chart
builders. Worth doing when the new view belongs beside the standard context (health, timeline,
screen state) rather than standing alone.

**Write a sibling script.** For a one-off — a funnel for one flow, a fleet-wide comparison, a CSV
export — a separate file is cleaner than a flag nobody will use again. Copy the loader and the
id→title map, emit your own HTML or CSV. Keep it in the project next to the pulled data so the whole
investigation is reproducible.

Prefer a sibling script by default. A plugin update replaces the shipped skill files, so
edits to the shipped `al-report.mjs` are silently reverted — change it only when
you intend to ship the change back, and use its flags (`--benign`, `--filtered`) for per-deployment
tuning.

## Keep custom output self-contained

Whatever you generate, the same constraints apply as to the baseline report: inline all CSS and JS,
embed images as data URIs, no CDN, no external fonts. The user must be able to open it offline in six
months, or mail it to a colleague themselves — self-contained is what makes that their decision
rather than yours. Follow the light/dark token pattern in `al-report.mjs` so a custom page
does not look foreign next to the standard one.

For non-visual deliverables, CSV or JSON is often the better answer — say so rather than wrapping a
table in HTML for its own sake.

## Sanity checks before you report a number

Custom analysis fails quietly, and a confident wrong number is worse than no answer:

- **Does the window contain what you think?** Print first and last timestamp and the event-name
  histogram before computing anything on top.
- **Did a device-side filter remove the events you are counting?** A zero can mean "never happened"
  or "never logged". [Query cost & filters](query-cost.md) has the three ways to tell.
- **Are you counting machine events as user activity?** See
  [Behaviour analysis](behaviour-analysis.md) — this is the single most common way these numbers go
  wrong.
- **Is a routed property write being double-counted?** One logical change appears once per receiving
  bank when data routing is involved; `bankId` vs `fromRoutingBankId` distinguishes them.
- **Are you crossing the two clocks?** Device time and server time are different sources. Never
  compute a duration that spans both.

State the assumptions you made in the report itself — idle threshold, timezone, which events you
treated as human, what you excluded. Someone will re-run this next month and needs to know whether
the numbers are comparable.
