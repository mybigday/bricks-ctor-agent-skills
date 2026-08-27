#!/usr/bin/env node
// Build a self-contained HTML telemetry report from BRICKS activity-log JSONL,
// device metrics, and application config. No network access, no dependencies --
// the output opens in any browser and can be attached to a ticket as-is.
//
//   node al-report.mjs --events e.jsonl --config app.json --metrics m.json \
//                      --device d.json --screenshots ./shots -o report.html
//
// This is a BASELINE report. When the question needs an analysis it does not
// cover, write that analysis against the JSONL instead of bending this script.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

// -- args -------------------------------------------------------------------
const argv = process.argv.slice(2)
const opt = { events: [], config: [], metrics: [], maxRows: 1500, maxShots: 60 }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const next = () => argv[++i]
  if (a === '--events') opt.events.push(next())
  else if (a === '--config') opt.config.push(next())
  else if (a === '--metrics') opt.metrics.push(next())
  else if (a === '--device') opt.device = next()
  else if (a === '--screenshots') opt.screenshots = next()
  else if (a === '--title') opt.title = next()
  else if (a === '--benign') opt.benign = next()
  else if (a === '--filtered') opt.filtered = true
  else if (a === '--max-rows') opt.maxRows = Number(next())
  else if (a === '--max-shots') opt.maxShots = Number(next())
  else if (a === '-o' || a === '--out') opt.out = next()
  else throw new Error(`unknown argument: ${a}`)
}
if (!opt.out) throw new Error('missing -o <report.html>')

// -- name map (application config -> id -> human title) ---------------------
const MAPS = [
  'canvas_map',
  'brick_map',
  'generator_map',
  'property_bank_map',
  'property_bank_calc_map',
  'animation_map',
  'action_map',
]
const names = new Map()
const apps = []
// Camera / video surfaces are composited straight into GPU memory, so the
// screenshot API cannot read them back -- they appear blank in every capture.
// Knowing an app has one turns "the screen is blank" from a bug into a known
// limitation, so collect them while the config is open.
const GPU_SURFACE = /CAMERA|VIDEO|WEBRTC/
const gpuSurfaces = []
for (const file of opt.config) {
  const app = JSON.parse(readFileSync(file, 'utf8'))
  // `config` is a JSON scalar: some responses deliver it parsed, others as a
  // serialized string. Taking it as-is silently skipped every name join and
  // left the report full of raw uuids with no error.
  let cfg = app.config ?? app
  if (typeof cfg === 'string') {
    try {
      cfg = JSON.parse(cfg)
    } catch {
      throw new Error(`${file}: "config" is a string but not valid JSON`)
    }
  }
  if (!cfg || typeof cfg !== 'object' || !cfg.subspace_map) {
    throw new Error(
      `${file}: no subspace_map found. Expected \`bricks app get <id> -j\` output or a bare config object.`,
    )
  }
  apps.push({ id: app._id, name: app.name, subspaces: Object.keys(cfg.subspace_map).length })
  for (const [sid, sub] of Object.entries(cfg.subspace_map)) {
    names.set(sid, { title: sub.title || 'Subspace', kind: 'Subspace' })
    for (const key of MAPS) {
      for (const [id, node] of Object.entries(sub[key] || {})) {
        if (!node || typeof node !== 'object') continue
        const template = node.template_key || node.type || null
        names.set(id, {
          title: node.title || id,
          kind: key.replace(/_map$/, '').replace(/_/g, ' '),
          template,
          subspace: sub.title || sid,
        })
        if (key === 'brick_map' && template && GPU_SURFACE.test(template)) {
          // Camera/video bricks are frequently untitled, so fall back to the
          // template name rather than printing a raw uuid at the user.
          gpuSurfaces.push({
            id,
            title: node.title || template,
            template,
            subspace: sub.title || sid,
          })
        }
      }
    }
  }
}
const label = (id) => (id && names.get(id)?.title) || id || '-'
const meta = (id) => names.get(id) || null

// -- events -----------------------------------------------------------------
const events = []
let rawBytes = 0
let badTimestamps = 0
for (const file of opt.events) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    // UTF-16 length under-reports CJK payloads by up to 3x, and this number
    // drives the "is this pull too big" judgement.
    rawBytes += Buffer.byteLength(line, 'utf8') + 1
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    // One unparseable timestamp poisons every sort, bucket and axis downstream,
    // so drop those rows here and report the count rather than rendering NaN.
    const t = Date.parse(e.timestamp)
    if (!Number.isFinite(t)) {
      badTimestamps++
      continue
    }
    events.push({
      t,
      ts: e.timestamp,
      type: e.event_type || 'general',
      name: e.event_name || '(unnamed)',
      dev: e.device_id || '(no device)',
      sub: e.subspace_id,
      sender: e.sender,
      payload: e.payload,
      bytes: Buffer.byteLength(line, 'utf8'),
    })
  }
}
events.sort((a, b) => a.t - b.t)
const t0 = events.length ? events[0].t : Date.now()
const t1 = events.length ? events[events.length - 1].t : Date.now()

const devices = new Map()
for (const e of events) devices.set(e.dev, (devices.get(e.dev) || 0) + 1)

// -- device / metrics -------------------------------------------------------
const device = opt.device ? JSON.parse(readFileSync(opt.device, 'utf8')) : null
const primaryDevice =
  device?._id || [...devices.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
const deviceName = (id) =>
  id === primaryDevice && device ? device.name || device.device_name || id : id || '-'

const metricDays = []
for (const file of opt.metrics) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  metricDays.push(...(Array.isArray(parsed) ? parsed : [parsed]))
}

// Metrics must be grouped per device: `--metrics` is repeatable, and merging two
// devices' heartbeats into one series lets one device's pings fill the other's
// outage, reporting "no outages" for a device that was down.
const metricsByDevice = new Map()
for (const day of metricDays) {
  const id = day.device_id || primaryDevice || '(unknown device)'
  let bucket = metricsByDevice.get(id)
  if (!bucket) {
    bucket = { id, uptime: [], memory: [], disk: [] }
    metricsByDevice.set(id, bucket)
  }
  for (const s of day.uptime || []) bucket.uptime.push(s)
  for (const s of day.memory_usage || []) bucket.memory.push(s)
  for (const s of day.disk_usage || []) bucket.disk.push(s)
}

// Heartbeat gaps: the uptime series is a fixed-interval ping, so a hole in it is
// the device being unreachable -- the cheapest outage signal available.
const health = []
for (const bucket of metricsByDevice.values()) {
  for (const key of ['uptime', 'memory', 'disk']) {
    bucket[key].sort((a, b) => a.timestamp - b.timestamp)
  }
  const { uptime } = bucket
  const medianDelta = (() => {
    if (uptime.length < 3) return 60_000
    const d = []
    for (let i = 1; i < uptime.length; i++) d.push(uptime[i].timestamp - uptime[i - 1].timestamp)
    d.sort((a, b) => a - b)
    return d[Math.floor(d.length / 2)] || 60_000
  })()
  const gapThreshold = Math.max(medianDelta * 3, 180_000)
  const gaps = []
  for (let i = 1; i < uptime.length; i++) {
    const from = uptime[i - 1].timestamp
    const to = uptime[i].timestamp
    if (to - from > gapThreshold) gaps.push({ from, to, minutes: (to - from) / 60000 })
  }
  // N samples span N-1 intervals, so dividing by span/interval alone reports
  // >100% coverage for a device that never missed a beat.
  const span = uptime.length > 1 ? uptime[uptime.length - 1].timestamp - uptime[0].timestamp : 0
  const expected = uptime.length > 1 ? span / medianDelta + 1 : uptime.length
  health.push({
    ...bucket,
    medianDelta,
    gapThreshold,
    gaps,
    coverage: expected > 0 ? uptime.length / expected : 0,
  })
}
health.sort((a, b) => (a.id === primaryDevice ? -1 : b.id === primaryDevice ? 1 : 0))
const primaryHealth = health.find((h) => h.id === primaryDevice) || health[0] || null

// Clock provenance. Event timestamps are minted by the *device* clock at the moment
// the event fires; metrics timestamps are minted by the *server* when the heartbeat
// lands. Correlating the two sections silently assumes the device clock is correct,
// so measure the disagreement instead of assuming it away.
const clockSkew = (() => {
  if (!events.length || !primaryHealth?.uptime.length) return null
  const mLo = primaryHealth.uptime[0].timestamp
  const mHi = primaryHealth.uptime[primaryHealth.uptime.length - 1].timestamp
  const overlaps = t0 <= mHi && t1 >= mLo
  const offset = (t0 + t1) / 2 - (mLo + mHi) / 2
  return { overlaps, offset }
})()

// -- aggregates -------------------------------------------------------------
const catalog = new Map()
for (const e of events) {
  const k = `${e.type} ${e.name}`
  let row = catalog.get(k)
  if (!row) {
    row = { type: e.type, name: e.name, n: 0, bytes: 0, first: e.t, last: e.t }
    catalog.set(k, row)
  }
  row.n++
  row.bytes += e.bytes
  row.last = e.t
}
const catalogRows = [...catalog.values()].sort((a, b) => b.n - a.n)

// Canvas occupancy -- the screen-state reconstruction. Lanes are keyed by
// device *and* subspace: two devices running the same app share subspace ids, so
// keying on the subspace alone interleaves them into a timeline that happened on
// neither device.
const lanes = new Map()
for (const e of events) {
  if (e.type !== 'general') continue
  if (e.name !== 'CANVAS_ENTER' && e.name !== 'CANVAS_EXIT') continue
  const sub = e.sub || '(no subspace)'
  const key = `${e.dev} ${sub}`
  let lane = lanes.get(key)
  if (!lane) {
    lane = { dev: e.dev, sub, segments: [], open: null }
    lanes.set(key, lane)
  }
  if (e.name === 'CANVAS_ENTER') {
    if (lane.open) {
      lane.open.end = e.t
      lane.segments.push(lane.open)
    }
    lane.open = { canvas: e.sender, start: e.t, end: null }
  } else if (lane.open && lane.open.canvas === e.sender) {
    lane.open.end = e.t
    lane.segments.push(lane.open)
    lane.open = null
  }
}
for (const lane of lanes.values()) {
  if (lane.open) {
    lane.open.end = t1
    lane.open.truncated = true
    lane.segments.push(lane.open)
    lane.open = null
  }
}
const laneRows = [...lanes.values()]
  .map((l) => {
    const dwell = new Map()
    for (const s of l.segments) dwell.set(s.canvas, (dwell.get(s.canvas) || 0) + (s.end - s.start))
    return { ...l, dwell, total: l.segments.reduce((a, s) => a + (s.end - s.start), 0) }
  })
  .sort((a, b) => b.segments.length - a.segments.length)

// Property-bank writes -- "what state changed, driven by what".
const props = new Map()
for (const e of events) {
  if (e.type !== 'data') continue
  const entries = Array.isArray(e.payload) ? e.payload : [e.payload]
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const id = entry.key || e.sender
    let row = props.get(id)
    if (!row) {
      row = { id, n: 0, logical: 0, samples: [], banks: new Set(), lastStamp: -1, last: null }
      props.set(id, row)
    }
    row.n++
    // Data routing delivers one logical change once per receiving bank, in the
    // same millisecond. Counting those as separate writes double-reports the
    // change -- collapse them, and keep the raw count to show the routing.
    if (e.t !== row.lastStamp) {
      row.logical++
      row.lastStamp = e.t
    }
    if (entry.bankId) row.banks.add(entry.bankId)
    // `last` is tracked unconditionally: the sample list is capped for size, and
    // reading its tail as the "latest value" reported the capped-th write.
    row.last = { t: e.t, v: entry.value }
    if (row.samples.length < 240) row.samples.push({ t: e.t, v: entry.value })
  }
}
const propRows = [...props.values()].sort((a, b) => b.n - a.n)

// Anomalies. Name-level matching first (cheap, precise); payload scanning is
// bounded to a stringified prefix so a 64KB property snapshot cannot dominate.
const ERROR_NAME = /(ERROR|FAIL|TIMEOUT|DISCONNECT|CRASH|REJECT|DENIED|LOST|DROPPED)/i
const ERROR_TEXT = /(error|failed|failure|timeout|refused|not found|unauthorized|disconnect)/i
// Routine runtime events whose names contain an alarming word but which fire on the
// happy path -- CANVAS_SHOWING_TIMEOUT is just a canvas auto-advancing on schedule.
// `--benign <regex>` extends this per deployment, because editing this file is
// undone by the next `ctor` skill refresh.
const BENIGN_NAME = /^(CANVAS_SHOWING_TIMEOUT|BRICK_VIDEO_ON_END|GENERATOR_TICK_COMPLETED)$/
const extraBenign = opt.benign ? new RegExp(opt.benign) : null
const isBenign = (name) => BENIGN_NAME.test(name) || (extraBenign ? extraBenign.test(name) : false)
const anomalies = []
for (const e of events) {
  const nameHit = ERROR_NAME.test(e.name) && !isBenign(e.name)
  // Serialize once, and only when the name has not already decided the outcome:
  // `data` payloads embed the whole property definition, so stringifying every
  // one of them twice is the single most expensive thing this script can do.
  let text = null
  let textHit = false
  if (!nameHit) {
    if (isBenign(e.name)) continue
    text = JSON.stringify(e.payload ?? '').slice(0, 600)
    textHit = ERROR_TEXT.test(text)
    if (!textHit) continue
  }
  if (text === null) text = JSON.stringify(e.payload ?? '').slice(0, 600)
  anomalies.push({
    t: e.t,
    name: e.name,
    sender: e.sender,
    sub: e.sub,
    dev: e.dev,
    text,
    severity: nameHit ? 'error' : 'signal',
  })
}
anomalies.sort((a, b) => (a.severity === b.severity ? a.t - b.t : a.severity === 'error' ? -1 : 1))

// Silence: a hole in the event stream far wider than the local cadence. Computed
// per device, because a second device's events otherwise fill the first one's gap.
const silence = []
for (const dev of devices.keys()) {
  const times = events.filter((e) => e.dev === dev).map((e) => e.t)
  if (times.length <= 20) continue
  const spans = []
  for (let i = 1; i < times.length; i++) spans.push(times[i] - times[i - 1])
  const sorted = [...spans].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0
  const cutoff = Math.max(p95 * 6, 120_000)
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > cutoff) silence.push({ dev, from: times[i - 1], to: times[i] })
  }
}

// -- screenshots ------------------------------------------------------------
const shots = []
let shotsFound = 0
if (opt.screenshots) {
  const files = readdirSync(opt.screenshots)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .map((f) => {
      // The last long digit run is the timestamp; a device id earlier in the name
      // can contain one too (`screenshot-<deviceId>-<epochMs>.jpg`).
      const runs = basename(f).match(/\d{10,}/g)
      const t = runs ? Number(runs[runs.length - 1]) : null
      return { file: join(opt.screenshots, f), t, name: f }
    })
    .filter((s) => s.t)
    .sort((a, b) => a.t - b.t)
  shotsFound = files.length
  const step = Math.max(1, Math.ceil(files.length / opt.maxShots))
  for (let i = 0; i < files.length; i += step) {
    const s = files[i]
    const buf = readFileSync(s.file)
    shots.push({
      t: s.t,
      name: s.name,
      mime: /\.png$/i.test(s.name) ? 'image/png' : 'image/jpeg',
      b64: buf.toString('base64'),
      kb: statSync(s.file).size / 1024,
    })
  }
}

// -- formatting helpers -----------------------------------------------------
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
const iso = (t) =>
  new Date(t)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, 'Z')
const clock = (t) => new Date(t).toISOString().slice(11, 23)
const dur = (ms) => {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`
  return `${(ms / 3_600_000).toFixed(1)} h`
}
const bytes = (b) =>
  b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b > 1e3 ? `${(b / 1e3).toFixed(1)} KB` : `${b} B`
const pct = (x) => `${(x * 100).toFixed(1)}%`
const hue = (s) => {
  let h = 0
  const str = String(s)
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return h
}
// Spreading a long series into Math.max overflows the argument stack; a month of
// 60s heartbeats is ~43k samples per device and `--metrics` is repeatable.
const maxOf = (arr, seed) => arr.reduce((m, v) => (v > m ? v : m), seed)

// -- charts (static SVG, drawn here so the page needs no JS to render) -------
const volumeChart = () => {
  if (!events.length) return '<p class="muted">No events in range.</p>'
  const W = 1000
  const H = 150
  const PAD = 28
  const buckets = 120
  const span = Math.max(t1 - t0, 1)
  const types = [...new Set(events.map((e) => e.type))]
  const grid = types.map(() => new Array(buckets).fill(0))
  for (const e of events) {
    const b = Math.min(buckets - 1, Math.max(0, Math.floor(((e.t - t0) / span) * buckets)))
    grid[types.indexOf(e.type)][b]++
  }
  const totals = new Array(buckets).fill(0)
  for (const row of grid) row.forEach((v, i) => (totals[i] += v))
  const max = maxOf(totals, 1)
  const bw = (W - PAD * 2) / buckets
  let bars = ''
  for (let i = 0; i < buckets; i++) {
    let y = H - PAD
    for (let k = 0; k < types.length; k++) {
      const h = (grid[k][i] / max) * (H - PAD * 2)
      if (h <= 0) continue
      y -= h
      const x = (PAD + i * bw).toFixed(1)
      const w = Math.max(bw - 0.5, 0.5).toFixed(1)
      bars += `<rect x="${x}" y="${y.toFixed(1)}" width="${w}" height="${h.toFixed(1)}" fill="var(--t${k})"><title>${esc(iso(t0 + (span * i) / buckets))} / ${esc(types[k])}: ${grid[k][i]}</title></rect>`
    }
  }
  const legend = types
    .map((t, k) => `<span class="key"><i style="background:var(--t${k})"></i>${esc(t)}</span>`)
    .join('')
  return `<div class="legend">${legend}<span class="muted">peak ${max} events / bucket, bucket ~ ${esc(dur(Math.round(span / buckets)))}</span></div>
  <svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none" role="img" aria-label="Event volume over time">
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="var(--line)"/>
    ${bars}
  </svg>
  <div class="axis"><span>${esc(iso(t0))}</span><span class="muted">device clock</span><span>${esc(iso(t1))}</span></div>`
}

const lineChart = (samples, pick, title, fmt) => {
  if (!samples.length) return ''
  const W = 1000
  const H = 120
  const PAD = 26
  const lo = samples[0].timestamp
  const hi = samples[samples.length - 1].timestamp || lo + 1
  const ys = samples.map(pick).filter((v) => Number.isFinite(v))
  if (!ys.length) return ''
  const ymax = maxOf(ys, 0.0001)
  const pts = samples
    .map((s) => {
      const v = pick(s)
      if (!Number.isFinite(v)) return null
      const x = PAD + ((s.timestamp - lo) / Math.max(hi - lo, 1)) * (W - PAD * 2)
      const y = H - PAD - (v / ymax) * (H - PAD * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .filter(Boolean)
    .join(' ')
  const last = ys[ys.length - 1]
  return `<div class="metric">
    <div class="metric-head"><b>${esc(title)}</b><span class="big">${esc(fmt(last))}</span><span class="muted">peak ${esc(fmt(ymax))}</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none" role="img" aria-label="${esc(title)}">
      <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="var(--line)"/>
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    </svg></div>`
}

const laneChart = () => {
  if (!laneRows.length) {
    return '<p class="muted">No CANVAS_ENTER / CANVAS_EXIT events in range, so screen state cannot be reconstructed for this window.</p>'
  }
  const W = 1000
  const ROW = 26
  const PAD = 8
  const span = Math.max(t1 - t0, 1)
  const rows = laneRows.slice(0, 12)
  const H = rows.length * ROW + PAD * 2
  const multiDevice = devices.size > 1
  let out = ''
  rows.forEach((lane, i) => {
    const y = PAD + i * ROW
    out += `<rect x="0" y="${y}" width="${W}" height="${ROW - 4}" fill="var(--lane)"/>`
    for (const s of lane.segments) {
      const x = ((s.start - t0) / span) * W
      const w = Math.max(((s.end - s.start) / span) * W, 1.2)
      const tail = s.truncated ? ', still on screen at window end' : ''
      const who = multiDevice ? `${deviceName(lane.dev)} / ` : ''
      out += `<rect x="${x.toFixed(2)}" y="${y}" width="${w.toFixed(2)}" height="${ROW - 4}" fill="hsl(${hue(s.canvas)} 62% 52%)" opacity="${s.truncated ? 0.5 : 0.92}"><title>${esc(who)}${esc(label(s.canvas))} ${esc(clock(s.start))} to ${esc(clock(s.end))} (${esc(dur(s.end - s.start))})${esc(tail)}</title></rect>`
    }
  })
  const laneLabels = rows
    .map(
      (lane) =>
        `<div class="lane-label" title="${esc(lane.sub)}"><span>${esc(label(lane.sub))}${multiDevice ? ` <span class="muted">${esc(deviceName(lane.dev))}</span>` : ''}</span><span class="muted">${lane.segments.length}</span></div>`,
    )
    .join('')
  // The SVG scales to the container width, so an `auto` height would stretch each
  // 26-unit lane past the fixed 26px label rows and drift them out of alignment.
  // Pinning the height keeps one viewBox unit equal to one pixel vertically.
  return `<div class="lanes"><div class="lane-labels">${laneLabels}</div>
    <svg viewBox="0 0 ${W} ${H}" class="chart lane-svg" style="height:${H}px" preserveAspectRatio="none" role="img" aria-label="Canvas occupancy">${out}</svg></div>
    <div class="axis"><span>${esc(iso(t0))}</span><span class="muted">device clock</span><span>${esc(iso(t1))}</span></div>`
}

// -- noise / cost advice ----------------------------------------------------
// This advice is only sound when the pull was unfiltered. A window narrowed with
// `--event-name` makes that event 100% of the sample, and the recommendation
// would then tell the user to silence the very event under investigation.
const topShare = catalogRows.length ? catalogRows[0].n / Math.max(events.length, 1) : 0
const pullLooksFiltered = Boolean(opt.filtered) || catalogRows.length < 5 || topShare > 0.9
const noisy = catalogRows.filter(
  (r) => r.type === 'general' && r.n / Math.max(events.length, 1) > 0.05,
)
const filterSuggestion =
  !pullLooksFiltered && noisy.length ? `^(?!(${noisy.map((r) => r.name).join('|')})$).*` : null

// -- html -------------------------------------------------------------------
const headline = deviceName(primaryDevice) || 'unknown device'
const title = opt.title || `BRICKS telemetry - ${headline}`
const entry = device?.entry_detail || {}

const card = (k, v, sub = '') =>
  `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`

const rowsForTable = events.slice(0, opt.maxRows).map((e) => ({
  t: e.ts || '',
  ty: e.type,
  n: e.name,
  s: label(e.sender),
  sub: label(e.sub),
  p: JSON.stringify(e.payload ?? '').slice(0, 400),
}))

const longestSilence = silence.length
  ? silence.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))
  : null

const healthBlock = (h) => `
  <div class="cards" style="margin-bottom:14px">
    ${card('Heartbeats', h.uptime.length.toLocaleString(), `every ~${dur(h.medianDelta)}`)}
    ${card('Coverage', pct(h.coverage), 'samples / expected')}
    ${card('Outages', String(h.gaps.length), `longer than ${dur(h.gapThreshold)}`)}
    ${card(
      'Longest outage',
      h.gaps.length
        ? dur(
            maxOf(
              h.gaps.map((g) => g.to - g.from),
              0,
            ),
          )
        : '-',
    )}
  </div>
  ${lineChart(h.memory, (s) => (s.values?.[1] ? s.values[0] / s.values[1] : NaN), 'Memory used', pct)}
  ${lineChart(h.disk, (s) => (s.values?.[1] ? s.values[0] / s.values[1] : NaN), 'Disk used', pct)}
  ${
    h.gaps.length
      ? `<table><thead><tr><th>From</th><th>To</th><th class="num">Duration</th></tr></thead><tbody>${h.gaps
          .slice(0, 30)
          .map(
            (g) =>
              `<tr><td class="mono">${esc(iso(g.from))}</td><td class="mono">${esc(iso(g.to))}</td><td class="num"><span class="pill ${g.minutes > 15 ? 'bad' : 'warn'}">${esc(dur(g.to - g.from))}</span></td></tr>`,
          )
          .join('')}</tbody></table>`
      : '<p class="muted">No heartbeat gaps: the device stayed reachable for the whole metrics window.</p>'
  }`

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<style>
:root{
  --bg:#f7f8fa; --panel:#fff; --fg:#141821; --muted:#6b7280; --line:#dfe3e9;
  --accent:#3b6ef6; --lane:#eef1f6; --warn:#c2410c; --bad:#b91c1c; --ok:#15803d;
  --t0:#3b6ef6; --t1:#8b5cf6; --t2:#0ea5e9;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0d1017; --panel:#151a23; --fg:#e6e9ef; --muted:#98a2b3; --line:#262d3a;
  --accent:#6c8cff; --lane:#1b2130; --warn:#fb923c; --bad:#f87171; --ok:#4ade80;
  --t0:#6c8cff; --t1:#a78bfa; --t2:#38bdf8;}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans TC",sans-serif}
header{padding:26px 28px 14px;border-bottom:1px solid var(--line)}
h1{margin:0 0 4px;font-size:20px;letter-spacing:-.2px}
h2{font-size:15px;margin:0 0 12px;letter-spacing:-.1px}
h3{font-size:13px;margin:18px 0 8px;color:var(--muted);font-weight:600}
.sub{color:var(--muted);font-size:13px}
nav{display:flex;gap:14px;flex-wrap:wrap;padding:10px 28px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
nav a{color:var(--muted);text-decoration:none;font-size:13px}
nav a:hover{color:var(--accent)}
main{padding:20px 28px 60px;max-width:1400px;margin:0 auto}
header,nav{max-width:1400px;margin:0 auto}
section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:18px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.card{background:var(--lane);border-radius:10px;padding:12px}
.card .k{color:var(--muted);font-size:12px}
.card .v{font-size:19px;font-weight:600;margin-top:2px;word-break:break-word}
.card .s{color:var(--muted);font-size:12px;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;position:sticky;top:0;background:var(--panel)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.wrap{word-break:break-word;white-space:pre-wrap;max-width:640px}
.muted{color:var(--muted)}
.scroll{overflow:auto;max-height:460px;border:1px solid var(--line);border-radius:8px}
.chart{width:100%;height:auto;display:block}
.lane-svg{height:auto}
.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-top:4px}
.legend{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:6px;font-size:12px;color:var(--muted)}
.key{display:inline-flex;align-items:center;gap:5px}
.key i{width:10px;height:10px;border-radius:2px;display:inline-block}
.lanes{display:grid;grid-template-columns:190px 1fr;gap:10px;align-items:start}
.lane-labels{display:flex;flex-direction:column;padding-top:8px}
.lane-label{height:26px;font-size:12px;overflow:hidden;white-space:nowrap;display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.lane-label>span:first-child{overflow:hidden;text-overflow:ellipsis}
.metric{margin-bottom:10px}
.metric-head{display:flex;gap:10px;align-items:baseline}
.metric-head .big{font-size:18px;font-weight:600}
.pill{display:inline-block;padding:1px 7px;border-radius:99px;font-size:11px;border:1px solid var(--line)}
.pill.bad{color:var(--bad);border-color:var(--bad)}
.pill.warn{color:var(--warn);border-color:var(--warn)}
.bar{height:6px;border-radius:99px;background:var(--accent);display:inline-block;vertical-align:middle}
input[type=search]{width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);margin-bottom:8px}
.film{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}
.film figure{margin:0;flex:0 0 auto;text-align:center}
.film img{height:170px;border-radius:8px;border:1px solid var(--line);display:block}
.film figcaption{font-size:11px;color:var(--muted);margin-top:3px}
.empty{color:var(--muted);font-style:italic}
.warnbox{margin-top:14px;padding:10px 12px;border-radius:8px;border:1px solid var(--warn);color:var(--warn);font-size:13px}
</style></head><body>
<header>
  <h1>${esc(title)}</h1>
  <div class="sub">${esc(iso(t0))} to ${esc(iso(t1))} &middot; ${events.length.toLocaleString()} events &middot; ${esc(bytes(rawBytes))} raw</div>
</header>
<nav>
  <a href="#summary">Summary</a><a href="#health">Health</a><a href="#volume">Volume</a>
  <a href="#screen">Screen state</a>${shots.length ? '<a href="#film">Filmstrip</a>' : ''}
  <a href="#anomalies">Anomalies</a><a href="#state">State changes</a>
  <a href="#catalog">Event catalog</a><a href="#raw">Raw events</a>
</nav>
<main>

<section id="summary"><h2>Summary</h2>
<div class="cards">
  ${card('Device', headline, devices.size > 1 ? `${devices.size} devices in this pull` : primaryDevice || '')}
  ${card('Window', dur(t1 - t0), `${iso(t0)} to ${iso(t1)}`)}
  ${card('Events', events.length.toLocaleString(), `${bytes(rawBytes)}, ${bytes(Math.round(rawBytes / Math.max(events.length, 1)))}/event`)}
  ${card('Event kinds', String(catalogRows.length), `${devices.size} device(s)`)}
  ${card('Anomalies', String(anomalies.length), `${anomalies.filter((a) => a.severity === 'error').length} error-named`)}
  ${card('Canvas switches', String(laneRows.reduce((a, l) => a + l.segments.length, 0)), `${laneRows.length} lane(s)`)}
  ${entry.operation_version ? card('Device OS', String(entry.operation_version), entry.update?.current_version ? `player ${entry.update.current_version}` : '') : ''}
  ${apps.length ? card('Config joined', apps.map((a) => a.name).join(', '), `${names.size.toLocaleString()} named ids`) : card('Config joined', 'none', 'ids shown raw, pass --config')}
</div>
${
  badTimestamps
    ? `<p class="warnbox">${badTimestamps.toLocaleString()} event(s) had a missing or unparseable timestamp and were excluded. Everything below covers the remaining ${events.length.toLocaleString()}.</p>`
    : ''
}
${
  clockSkew && !clockSkew.overlaps
    ? `<p class="warnbox">Event times and metric times do not overlap (midpoints differ by ${esc(dur(Math.abs(clockSkew.offset)))}). Activity Log timestamps come from the <b>device</b> clock, device metrics from the <b>server</b> clock. Either the two pulls cover different periods, or this device's clock is wrong -- do not correlate the Health section with the event sections until you know which.</p>`
    : ''
}
${
  filterSuggestion
    ? `<p class="muted" style="margin-top:14px">Volume is dominated by <b>${esc(noisy.map((r) => `${r.name} (${pct(r.n / events.length)})`).join(', '))}</b>. <b>If this pull was unfiltered</b>, tightening the device-side activity-log filter cuts retention and query cost without losing the diagnostic signal, e.g. <code>${esc(filterSuggestion)}</code></p>`
    : ''
}
${
  pullLooksFiltered && !opt.filtered && catalogRows.length
    ? `<p class="muted" style="margin-top:14px">This pull looks narrowed (${catalogRows.length} event name(s), top one ${esc(pct(topShare))}), so no device-side filter recommendation is offered — a filtered sample would recommend silencing the very events you queried.</p>`
    : ''
}
</section>

<section id="health"><h2>Device health <span class="muted" style="font-weight:400">&middot; server clock</span></h2>
${
  health.length
    ? health
        .slice(0, 6)
        .map(
          (h) =>
            `${health.length > 1 ? `<h3>${esc(deviceName(h.id))} <span class="mono">${esc(String(h.id).slice(0, 24))}</span></h3>` : ''}${healthBlock(h)}`,
        )
        .join('') +
      (health.length > 6
        ? `<p class="muted">Showing 6 of ${health.length} devices with metrics.</p>`
        : '')
    : '<p class="empty">No metrics supplied, or none retained for this range (device metrics are kept for about a month). Run <code>bricks device metrics &lt;id&gt; --start-date ... -j &gt; metrics.json</code> and pass <code>--metrics metrics.json</code>.</p>'
}
</section>

<section id="volume"><h2>Event volume</h2>${volumeChart()}
${
  longestSilence
    ? `<p style="margin-top:10px"><span class="pill warn">${silence.length} silent gap(s)</span> in the event stream${devices.size > 1 ? ' (measured per device)' : ''}. The longest is ${esc(dur(longestSilence.to - longestSilence.from))} starting ${esc(iso(longestSilence.from))}. Activity-log uploads batch every ~2 min, so treat gaps under that as buffering, not downtime.</p>`
    : ''
}
</section>

<section id="screen"><h2>Screen state reconstruction</h2>${laneChart()}
${
  laneRows.length
    ? `<table style="margin-top:14px"><thead><tr>${devices.size > 1 ? '<th>Device</th>' : ''}<th>Subspace</th><th>Canvas</th><th class="num">Enters</th><th class="num">On screen</th><th class="num">Share</th></tr></thead><tbody>${laneRows
        .slice(0, 6)
        .flatMap((lane) =>
          [...lane.dwell.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(
              ([canvas, ms]) =>
                `<tr>${devices.size > 1 ? `<td>${esc(deviceName(lane.dev))}</td>` : ''}<td>${esc(label(lane.sub))}</td><td>${esc(label(canvas))}</td><td class="num">${lane.segments.filter((s) => s.canvas === canvas).length}</td><td class="num">${esc(dur(ms))}</td><td class="num"><span class="bar" style="width:${Math.round((ms / Math.max(lane.total, 1)) * 90)}px"></span> ${esc(pct(ms / Math.max(lane.total, 1)))}</td></tr>`,
            ),
        )
        .join('')}</tbody></table>`
    : ''
}
</section>

${
  shots.length
    ? `<section id="film"><h2>Screenshot filmstrip</h2>
<div class="film">${shots
        .map(
          (s) =>
            `<figure><img loading="lazy" src="data:${s.mime};base64,${s.b64}" alt="${esc(iso(s.t))}"/><figcaption>${esc(clock(s.t))}</figcaption></figure>`,
        )
        .join('')}</div>
<p class="muted">${shots.length} of ${shotsFound} captures embedded (evenly sampled).</p>
${
  gpuSurfaces.length
    ? `<p class="warnbox">This app renders ${esc([...new Set(gpuSurfaces.map((g) => (g.title === g.template ? g.template : `${g.title} (${g.template})`)))].join(', '))}. Camera and video surfaces are composited directly into GPU memory, so the screenshot API cannot read them back and they appear <b>blank in every capture</b>. Over that region the frames carry no information either way -- a healthy camera and a dead one look identical. Judge it from <code>BRICK_CAMERA_STATE_CHANGE</code> / <code>BRICK_VIDEO_*</code> and the property values instead, and never report it as a blank screen.</p>`
    : ''
}</section>`
    : ''
}

<section id="anomalies"><h2>Anomalies</h2>
${
  anomalies.length
    ? `<div class="scroll"><table><thead><tr><th>Time</th><th>Event</th><th>Sender</th><th>Detail</th></tr></thead><tbody>${anomalies
        .slice(0, 200)
        .map(
          (a) =>
            `<tr><td class="mono">${esc(clock(a.t))}</td><td><span class="pill ${a.severity === 'error' ? 'bad' : 'warn'}">${esc(a.name)}</span></td><td>${esc(label(a.sender))}</td><td class="mono wrap">${esc(a.text)}</td></tr>`,
        )
        .join(
          '',
        )}</tbody></table></div>${anomalies.length > 200 ? `<p class="muted">Showing first 200 of ${anomalies.length} (error-named first).</p>` : ''}`
    : '<p class="muted">No error-shaped events or payloads in this window.</p>'
}
</section>

<section id="state"><h2>State changes (property bank)</h2>
${
  propRows.length
    ? `<div class="scroll"><table><thead><tr><th>Property</th><th>Subspace</th><th class="num">Writes</th><th class="num">Banks</th><th>Latest value</th><th>Last write</th></tr></thead><tbody>${propRows
        .slice(0, 60)
        .map(
          (p) =>
            `<tr><td>${esc(label(p.id))}<div class="muted mono">${esc(String(p.id).slice(0, 30))}</div></td><td>${esc(meta(p.id)?.subspace || '-')}</td><td class="num">${p.logical.toLocaleString()}${p.n !== p.logical ? `<div class="muted">${p.n.toLocaleString()} raw</div>` : ''}</td><td class="num">${p.banks.size || '-'}</td><td class="mono">${esc(JSON.stringify(p.last?.v ?? '').slice(0, 120))}</td><td class="mono">${esc(p.last ? clock(p.last.t) : '')}</td></tr>`,
        )
        .join('')}</tbody></table></div>
<p class="muted">Writes are logical changes; data routing delivers one change to every receiving bank in the same millisecond, and the raw count is shown when it differs.</p>`
    : '<p class="muted">No <code>data</code> events in range (PROPERTY_BANK_UPDATE).</p>'
}
</section>

<section id="catalog"><h2>Event catalog</h2>
<div class="scroll"><table><thead><tr><th>Event</th><th>Type</th><th class="num">Count</th><th class="num">Share</th><th class="num">Bytes</th><th>First</th><th>Last</th></tr></thead><tbody>
${catalogRows
  .map(
    (r) =>
      `<tr><td>${esc(r.name)}</td><td class="muted">${esc(r.type)}</td><td class="num">${r.n.toLocaleString()}</td><td class="num"><span class="bar" style="width:${Math.round((r.n / Math.max(catalogRows[0].n, 1)) * 80)}px"></span> ${esc(pct(r.n / Math.max(events.length, 1)))}</td><td class="num">${esc(bytes(r.bytes))}</td><td class="mono">${esc(clock(r.first))}</td><td class="mono">${esc(clock(r.last))}</td></tr>`,
  )
  .join('')}
</tbody></table></div></section>

<section id="raw"><h2>Raw events</h2>
<input type="search" id="q" placeholder="Filter by event name, sender, subspace, or payload"/>
<div class="scroll"><table id="rawtable"><thead><tr><th>Time</th><th>Type</th><th>Event</th><th>Sender</th><th>Subspace</th><th>Payload</th></tr></thead><tbody></tbody></table></div>
<p class="muted">${Math.min(events.length, opt.maxRows).toLocaleString()} of ${events.length.toLocaleString()} events embedded. The full stream stays in the JSONL file next to this report.</p>
</section>
</main>
<script>
const ROWS = ${JSON.stringify(rowsForTable).replace(/</g, '\\u003c')};
const tbody = document.querySelector('#rawtable tbody');
function esc(s){return String(s == null ? '' : s).replace(/[&<>]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
function render(q){
  const needle = q.trim().toLowerCase();
  const out = [];
  for (const r of ROWS) {
    if (needle && !((r.n + ' ' + r.s + ' ' + r.sub + ' ' + r.p).toLowerCase().includes(needle))) continue;
    out.push('<tr><td class="mono">' + esc(String(r.t || '').slice(11, 23)) + '</td><td class="muted">' + esc(r.ty) + '</td><td>' + esc(r.n) +
      '</td><td>' + esc(r.s) + '</td><td>' + esc(r.sub) + '</td><td class="mono">' + esc(r.p) + '</td></tr>');
    if (out.length > 800) break;
  }
  tbody.innerHTML = out.join('');
}
document.getElementById('q').addEventListener('input', function(e){ render(e.target.value) });
render('');
</script>
</body></html>`

// The documented invocations all write into a `reports/` directory that does not
// exist in a fresh project; without this the whole run is discarded at the last
// line with an ENOENT.
mkdirSync(dirname(opt.out) || '.', { recursive: true })
writeFileSync(opt.out, html)
console.log(
  `${opt.out} - ${events.length} events, ${catalogRows.length} kinds, ${anomalies.length} anomalies, ${laneRows.length} lanes, ${health.length} device(s) with metrics, ${shots.length} screenshots, ${(html.length / 1e6).toFixed(2)} MB`,
)
