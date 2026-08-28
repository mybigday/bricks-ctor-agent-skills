# Query Cost & Filters

Activity Log keeps almost every runtime event a device emits, and the ceiling is much higher than it
sounds. Two devices measured in production:

- A retail tablet: **141,000 events / 118 MB in one day**.
- An idle tablet running a per-frame tick generator: **169,484 events / 85 MB in 26 minutes** — ~109
  events per second, ~196 MB/hour, on a device that was showing a camera preview and nothing else.

The second one is not a pathological configuration; it is one generator writing one property per
tick. Treat every query as a scan whose cost you choose up front.

## What actually reduces cost

Measured against a live workspace, same server, same session:

| Query | Wall clock | Rows | Bytes |
|---|---|---|---|
| 8 days, no `--device` | 148 s | 344,345 | 280 MB |
| 8 days, `--device X` | 4.2 s | 1,078 | 703 KB |
| 1 day, `--device X` | 2.5 s | 142 | 60 KB |
| 3 days, `--device X --event-name CANVAS_ENTER` | 5.0 s | 2,396 | 779 KB |
| 1 hour, `--device Y` (busy kiosk) | 8.0 s | 8,993 | 7.4 MB |
| 26 min, `--device Z` (tick-storm tablet) | 30 s | 169,484 | 85 MB |

`al-report.mjs` digests that last one in 0.7 s and ~380 MB of RSS, so the bulk-to-file-then-analyse
path holds at this scale — but only because the file never touches your context.

Order of leverage:

1. **`--device <id>`** — by far the biggest win. One noisy device can be 99.7% of a workspace's
   volume, and without this filter you download all of it.
2. **`--event-name <name>`** — surgical. Use it once you know which event answers the question.
3. **`--type general|data|local_sync`** — coarse but cheap; `data` alone isolates property-bank
   writes.
4. **`--subspace <id>` / `--sender <id>`** — precise when you already read the config and know which
   canvas, brick, or generator matters.
5. **Time range** — always the last thing you widen.

`--limit` is **not** in that list. It caps what gets printed, not what the server scans: an 8-day
unfiltered query with `--limit 3` still ran past two minutes. Use it to keep a probe's output small,
never to make an expensive query cheap.

`--start-time` is required. Both bounds accept ISO 8601 or a relative shorthand (`30m`, `2h`, `3d`,
`1w`) interpreted as "ago".

The **30-day maximum is enforced by the CLI, not the server** — `Time range must be 30 days or less`
comes from a client-side guard before any request is made. It exists so a stray `--start-time 1y`
cannot start a scan nobody can pay for. Do not read it as a statement about what the backend can
serve, and do not design around it as a server limit; step through consecutive windows instead.

## Discovery order

Start with the query that can prove data exists for the least money.

```bash
# 1. cheapest possible probe — screenshot query returns timestamps only
bricks al screenshots --device <id> --start-time 7d -j > shots.json

# 2. shape check — tiny window, tight limit, JSON so you can read the payload
bricks al events --device <id> --start-time 1h --limit 20 -j

# 3. named probe once you know what you are looking for
bricks al events --device <id> --event-name GENERATOR_TICK_COMPLETED --start-time 6h --limit 50 -j
```

If the interaction time is unknown, walk backwards in bounded windows (1 h, then 6 h, then 1 d)
rather than opening the range in one step.

## Reading an empty result

Three different failures look similar. Tell them apart before you widen the window:

| What you see | Meaning | Next move |
|---|---|---|
| `[]` on stdout, exit 0 | Authorised, but genuinely no rows in this range | Move the window; check `last_alive_time` on the device |
| `Failed to query events: Unauthorized` on stderr, exit 1 | The workspace token has no Activity Log access, or the workspace does not have it enabled | Stop querying; report the access gap |
| Events exist but never the one you want | The **device-side filter** is dropping it before upload | See below |

Activity Log has a per-device switch and a per-device **filter regex over the event name**. If the
filter is set, non-matching events never leave the device and no query can recover them. The CLI
does not expose these settings — they live in the BRICKS Controller under the device's Activity Log
settings. When a signal is structurally missing, say so and name the setting; do not scan the day
hoping it appears.

### Check Activity Log access once, before anything else

`Unauthorized` is decided at the **token/workspace level, not per device** — every device in the
workspace fails identically, including devices that demonstrably belong to it. So one probe answers
it for the whole workspace. Never sweep a device list to "find one that works".

```bash
bricks al screenshots --device <any-device-in-this-workspace> --start-time 7d -j
```

Two traps:

- **`bricks doctor --json` does not test Activity Log.** It probes the workspace API only and happily
  reports `"ok": true` on a token whose every `al` call returns `Unauthorized`. Its verdict tells you
  nothing about this skill's data sources.
- **Errors go to stderr, and the exit code is 1.** `bricks al … -j 2>/dev/null | grep -c something`
  prints `0` for an authorised-but-empty result *and* for `Unauthorized`. Capture stderr and check
  the exit code, or you will record "no data" for a workspace you simply cannot read.

### `Unauthorized` usually means the wrong kind of credential

A **workspace token often cannot read Activity Log even when your account can.** Verified on the same
workspace, same device, minutes apart: the saved workspace-token profile returned `Unauthorized` for
both `al events` and `al screenshots`, while an OAuth profile returned the data immediately. OAuth
contexts send the extra workspace header the activity-log server uses for delegated verification;
raw workspace tokens carry only a scope list, and Activity Log is not in it.

So when `al` says `Unauthorized`, the fix is usually a credential swap, not an access request:

```bash
bricks auth login                  # OAuth, opens the browser
bricks auth workspaces             # what the account can reach
bricks auth use-workspace <id>
```

Only report a genuine access gap after the OAuth path has also failed.

Workspace tokens are also scoped per method. A token can be perfectly valid for `app get` and still
be rejected by `device list` with `This token is not allowed for the method. (required qd but got …)`.
When that happens, the bound device ids are still reachable through `bricks app get <app-id> -j`
(`id_for_devices` and `devices[]`), which is enough to run every query in this skill.

## JSONL discipline

```bash
bricks al events --device <id> \
  --start-time 2026-01-15T09:00:00Z --end-time 2026-01-15T09:20:00Z \
  --jsonl > events.jsonl
```

- `--jsonl` streams one JSON object per line straight to stdout as results arrive — it does not
  buffer the whole result set, so it is the only safe mode for large pulls.
- **Redirect to a file. Never pipe.** `bricks … -j | sed`, `| jq`, `| cat` truncates at exactly
  65,536 bytes because the process exits before the pipe drains. A 1.27 MB metrics payload arrived
  as 64 KB through a pipe and complete via `>`. Read the file afterwards.
- Never read a multi-megabyte JSONL file into your context. Aggregate it with a script, or feed it to
  `scripts/al-report.mjs`.
- `--event-name` takes one value. For several names, run one pull per name and pass every file to the
  report tool with repeated `--events` flags.
- **Results arrive newest-first.** Both `al events` and `al screenshots` return descending by
  timestamp, so line 1 of your JSONL is the *end* of the window and `head` shows you the latest
  events, not the earliest. Sort before you reason about sequence — `scripts/al-report.mjs` does.
  The `al screenshots` table numbers `#1` as the newest capture for the same reason.

## Execution timeouts kill the pull from outside

`bricks al events` sets **no request timeout of its own** — it waits as long as the server takes. So a
timeout never comes from the CLI; it comes from whatever is running it. In CTOR Desktop that is the
Bash tool, which defaults to **30 s**, is capped at **5 minutes**, and exposes the limit as a
`timeout` parameter in milliseconds. Raise it before any bulk pull instead of discovering the default
the hard way.

Thirty seconds sits inside the natural spread of a dense window, which is the whole problem:

| | Wall clock |
|---|---|
| CLI process start | 78 ms |
| + auth / first round trip | ~0.7 s |
| 5-min window, 18 rows returned | 1.3 – 1.9 s |
| 5-min window, **35,959 rows** | **5.4 / 7.6 / 10.7 / 12.0 s** (four identical runs) |

Two things in that table. **Cost tracks the window scanned, not the rows returned** — filtering 500
results out of a dense five minutes still pays for the five minutes, the same reason `--limit` is not
a cost control. And **identical queries vary by more than 2x**, so a pull that finishes in 12 s today
can cross 30 s under load. That is why this shows up as "it times out sometimes" rather than as a
clean reproduction, and why the fix is a longer timeout rather than a faster query.

### The silent part

`--jsonl` writes one line as each result arrives, so a pull killed at the timeout leaves a **valid but
incomplete** file. Every line parses, nothing reports an error, and every number computed from it is
quietly wrong.

Results arrive **newest-first**, so truncation costs you the *oldest* end of the window: the last line
should sit near your `--start-time`. Check it before analysing.

```bash
# oldest event actually captured -- should be close to --start-time
tail -1 events.jsonl | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["timestamp"])'
```

If it stops well short, you were cut off. Re-run with a longer timeout, or split the window, before
trusting anything downstream.

## Stop conditions

Stop and narrow — do not retry the same shape — when a query runs past ~30 s, when the output file
crosses tens of megabytes, or when the results are dominated by high-frequency events you did not
ask for. Check the event catalog in the generated report: if one event name is more than a third of
the volume, exclude it by name on the next pull and recommend tightening the device-side filter.
