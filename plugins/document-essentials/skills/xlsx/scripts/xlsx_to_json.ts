#!/usr/bin/env bun
/**
 * xlsx_to_json.ts — parse a spreadsheet into structured JSON. Zero dependencies
 * (self-contained ZIP + XML reader on top of node:zlib), runs fully offline.
 *
 *   bun xlsx_to_json.ts --list <file.xlsx>
 *   bun xlsx_to_json.ts [options] <file.(xlsx|csv|tsv)>
 *
 * Options:
 *   --list               List sheets with size and a first-row preview, then exit.
 *   --sheet <name|n>     Sheet to parse: name or 1-based index (default: 1).
 *   --header-row <n>     1-based row that holds the column headers (default: 1).
 *   --raw                Emit arrays of cell values for every row (no header mapping).
 *   --limit <n>          Max data rows to emit, 0 = no limit (default: 5000).
 *   --fill-merged        Copy each merged range's top-left value into all its cells.
 *   --dates <iso|serial> Date cell output format (default: iso).
 *   --out <path>         Write JSON here instead of stdout.
 *
 * Supported: .xlsx (and .xlsm structure), .csv, .tsv.
 * Known limits (rare in practice — fall back to exporting CSV if hit):
 *   - No ZIP64 archives (>4GB), no encrypted workbooks.
 *   - Date detection uses number-format heuristics (builtin ids + d/m/y/h/s tokens).
 *   - Formula cells yield their last computed value, never the formula text.
 */

import { inflateRawSync } from 'node:zlib'

// ---------------------------------------------------------------- CLI ----

const argv = process.argv.slice(2)
const files: string[] = []
const opts: Record<string, string | boolean> = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--list' || a === '--raw' || a === '--fill-merged') opts[a.slice(2)] = true
  else if (a === '--sheet' || a === '--header-row' || a === '--limit' || a === '--dates' || a === '--out')
    opts[a.slice(2)] = argv[++i]
  else if (a.startsWith('--')) fail(`Unknown option: ${a}`)
  else files.push(a)
}
if (files.length !== 1) fail('Usage: bun xlsx_to_json.ts [options] <file.(xlsx|csv|tsv)> (see header comment)')

const file = files[0]
const buf = Buffer.from(await Bun.file(file).arrayBuffer().catch(() => fail(`File not found: ${file}`)))
const lower = file.toLowerCase()

type Cell = string | number | boolean | null
type SheetData = { name: string; rows: Cell[][]; merges: string[] }

let sheetNames: string[] = []
let loadSheet: (nameOrIndex: string, maxRows: number) => SheetData

if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
  const delim = lower.endsWith('.tsv') ? '\t' : ','
  const rows = parseCsv(stripBom(buf.toString('utf8')), delim)
  sheetNames = ['Sheet1']
  loadSheet = (_n, maxRows) => ({ name: 'Sheet1', rows: maxRows ? rows.slice(0, maxRows) : rows, merges: [] })
} else {
  const zip = readZip(buf)
  const wb = readWorkbook(zip)
  sheetNames = wb.sheets.map((s) => s.name)
  loadSheet = (nameOrIndex, maxRows) => {
    const byName = wb.sheets.find((s) => s.name === nameOrIndex)
    const byIndex = /^\d+$/.test(nameOrIndex) ? wb.sheets[Number(nameOrIndex) - 1] : undefined
    const sheet = byName || byIndex
    if (!sheet) fail(`Sheet not found: ${nameOrIndex} (available: ${sheetNames.join(', ')})`)
    return parseSheet(zip, wb, sheet, maxRows)
  }
}

if (opts.list) {
  const sheets = sheetNames.map((name, i) => {
    const { rows } = loadSheet(name, 50)
    const preview = rows.find((r) => r.some((c) => c !== null && c !== '')) || []
    return { index: i + 1, name, scannedRows: rows.length, cols: Math.max(0, ...rows.map((r) => r.length)), preview: preview.slice(0, 8) }
  })
  emit({ source: file, sheets, note: 'scannedRows caps at 50 for listing; parse a sheet for full data' })
} else {
  const limit = Number(opts.limit ?? 5000)
  const headerRow = Number(opts['header-row'] ?? 1)
  const { name, rows, merges } = loadSheet(String(opts.sheet ?? '1'), 0)
  if (opts['fill-merged']) fillMerged(rows, merges)

  if (opts.raw) {
    const out = limit ? rows.slice(0, limit) : rows
    emit({ source: file, sheet: name, sheetNames, rowCount: rows.length, truncated: limit > 0 && rows.length > limit, rows: out })
  } else {
    if (headerRow < 1 || headerRow > rows.length) fail(`--header-row ${headerRow} is outside the sheet (${rows.length} rows)`)
    const headers = (rows[headerRow - 1] || []).map((c) => (c === null ? '' : String(c)))
    const columns = headers.map((header, i) => ({ key: '', header, column: colLetter(i) })).filter((c) => c.header.trim() !== '')
    const used = new Set<string>()
    for (const c of columns) {
      let key = slugify(c.header) || c.column.toLowerCase()
      let k = key
      for (let n = 2; used.has(k); n++) k = `${key}_${n}`
      used.add(k)
      c.key = k
    }
    const dataRows = rows.slice(headerRow).filter((r) => r.some((c) => c !== null && c !== ''))
    const truncated = limit > 0 && dataRows.length > limit
    const objects = (truncated ? dataRows.slice(0, limit) : dataRows).map((r) => {
      const o: Record<string, Cell> = {}
      for (const c of columns) o[c.key] = r[colIndex(c.column)] ?? null
      return o
    })
    emit({
      source: file, sheet: name, sheetNames, headerRow, columns, rowCount: dataRows.length, truncated,
      rows: objects,
      mapping: 'keys derived from headers — review before importing; re-run with the same flags to re-import',
    })
  }
}

// ------------------------------------------------------------- output ----

function emit(value: unknown) {
  const json = JSON.stringify(value, null, 2)
  if (opts.out) {
    Bun.write(String(opts.out), json + '\n')
    console.log(JSON.stringify({ out: opts.out, bytes: json.length }))
  } else console.log(json)
}

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}

// ----------------------------------------------------------- ZIP read ----

type ZipEntry = { name: string; method: number; compSize: number; size: number; localOffset: number }

function readZip(b: Buffer): Map<string, ZipEntry> {
  // End-of-central-directory record: scan backwards (max 64KB comment).
  let eocd = -1
  const scanStart = Math.max(0, b.length - 65557)
  for (let i = b.length - 22; i >= scanStart; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) fail('Not a valid .xlsx (zip end record not found). Encrypted or corrupted file?')
  const count = b.readUInt16LE(eocd + 10)
  let p = b.readUInt32LE(eocd + 16)
  if (p === 0xffffffff) fail('ZIP64 archives are not supported — export the sheet as CSV instead')
  const entries = new Map<string, ZipEntry>()
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) break
    const method = b.readUInt16LE(p + 10)
    const compSize = b.readUInt32LE(p + 20)
    const size = b.readUInt32LE(p + 24)
    const nameLen = b.readUInt16LE(p + 28)
    const extraLen = b.readUInt16LE(p + 30)
    const commentLen = b.readUInt16LE(p + 32)
    const localOffset = b.readUInt32LE(p + 42)
    const name = b.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, { name, method, compSize, size, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function zipFile(zip: Map<string, ZipEntry>, name: string): string | null {
  const e = zip.get(name) || zip.get(name.replace(/^\//, ''))
  if (!e) return null
  const p = e.localOffset
  if (buf.readUInt32LE(p) !== 0x04034b50) return null
  const nameLen = buf.readUInt16LE(p + 26)
  const extraLen = buf.readUInt16LE(p + 28)
  const start = p + 30 + nameLen + extraLen
  const data = buf.subarray(start, start + e.compSize)
  if (e.method === 0) return data.toString('utf8')
  if (e.method === 8) return inflateRawSync(data).toString('utf8')
  fail(`Unsupported zip compression method ${e.method} for ${name}`)
}

// -------------------------------------------------------- XLSX pieces ----

type Workbook = {
  sheets: { name: string; target: string }[]
  date1904: boolean
  shared: string[]
  dateStyles: Set<number>
}

function readWorkbook(zip: Map<string, ZipEntry>): Workbook {
  const wbXml = zipFile(zip, 'xl/workbook.xml') || fail('xl/workbook.xml missing — not an xlsx file?')
  const relsXml = zipFile(zip, 'xl/_rels/workbook.xml.rels') || ''
  const rels = new Map<string, string>()
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*/g)) {
    const id = attr(m[0], 'Id')
    let target = attr(m[0], 'Target') || ''
    if (target.startsWith('/')) target = target.slice(1)
    else if (!target.startsWith('xl/')) target = 'xl/' + target
    if (id) rels.set(id, target)
  }
  const sheets: { name: string; target: string }[] = []
  for (const m of wbXml.matchAll(/<sheet\b[^>]*/g)) {
    const name = decodeXml(attr(m[0], 'name') || `Sheet${sheets.length + 1}`)
    const rid = attr(m[0], 'r:id') || attr(m[0], 'id')
    const target = (rid && rels.get(rid)) || `xl/worksheets/sheet${sheets.length + 1}.xml`
    sheets.push({ name, target })
  }
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wbXml)

  const shared: string[] = []
  const ssXml = zipFile(zip, 'xl/sharedStrings.xml')
  if (ssXml) {
    for (const m of ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\/>/g)) {
      const inner = m[1] || ''
      let text = ''
      for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeXml(t[1])
      shared.push(text)
    }
  }
  return { sheets, date1904, shared, dateStyles: readDateStyles(zip) }
}

// Style indexes (cellXfs order) whose number format is date/time-like.
function readDateStyles(zip: Map<string, ZipEntry>): Set<number> {
  const out = new Set<number>()
  const xml = zipFile(zip, 'xl/styles.xml')
  if (!xml) return out
  const custom = new Map<number, string>()
  for (const m of xml.matchAll(/<numFmt\b[^>]*/g)) {
    const id = Number(attr(m[0], 'numFmtId'))
    const code = decodeXml(attr(m[0], 'formatCode') || '')
    if (!Number.isNaN(id)) custom.set(id, code)
  }
  const isDateCode = (code: string) =>
    /[dmhys]/i.test(code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').replace(/General/gi, ''))
  const builtinDate = (id: number) =>
    (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)
  const cellXfs = xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] || ''
  let idx = 0
  for (const m of cellXfs.matchAll(/<xf\b[^>]*/g)) {
    const id = Number(attr(m[0], 'numFmtId') || '0')
    const code = custom.get(id)
    if (builtinDate(id) || (code !== undefined && isDateCode(code))) out.add(idx)
    idx++
  }
  return out
}

function parseSheet(zip: Map<string, ZipEntry>, wb: Workbook, sheet: { name: string; target: string }, maxRows: number): SheetData {
  const xml = zipFile(zip, sheet.target) || fail(`Sheet XML missing: ${sheet.target}`)
  const rows: Cell[][] = []
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const rowAttrSrc = rm[0]
    const rNum = Number(attr(rowAttrSrc.match(/<row\b[^>]*/)![0], 'r') || rows.length + 1)
    while (rows.length < rNum - 1) rows.push([])
    const cells: Cell[] = []
    for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cAttrs = `<c ${cm[1]}`
      const ref = attr(cAttrs, 'r') || ''
      const t = attr(cAttrs, 't') || ''
      const s = Number(attr(cAttrs, 's') || '-1')
      const inner = cm[2] || ''
      const idx = ref ? colIndex(ref.replace(/\d+$/, '')) : cells.length
      while (cells.length < idx) cells.push(null)
      cells[idx] = cellValue(t, s, inner, wb)
    }
    rows.push(cells)
    if (maxRows && rows.length >= maxRows) break
  }
  const merges: string[] = []
  for (const m of xml.matchAll(/<mergeCell\b[^>]*ref="([^"]+)"/g)) merges.push(m[1])
  return { name: sheet.name, rows, merges }
}

function cellValue(t: string, styleIdx: number, inner: string, wb: Workbook): Cell {
  const v = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]
  if (t === 's') return v === undefined ? null : (wb.shared[Number(v)] ?? null)
  if (t === 'inlineStr') {
    let text = ''
    for (const m of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeXml(m[1])
    return text
  }
  if (v === undefined) return null
  if (t === 'str') return decodeXml(v)
  if (t === 'b') return v === '1'
  if (t === 'e') return null // formula error (#DIV/0! etc.)
  const num = Number(v)
  if (Number.isNaN(num)) return decodeXml(v)
  if (opts.dates !== 'serial' && wb.dateStyles.has(styleIdx)) return serialToIso(num, wb.date1904)
  return num
}

function serialToIso(serial: number, date1904: boolean): string {
  // 1900 system epoch 1899-12-30 absorbs Excel's phantom 1900 leap day for
  // all real-world dates (serial >= 61, i.e. 1900-03-01 onward).
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const ms = Math.round(serial * 86400000)
  const d = new Date(epoch + ms)
  const iso = d.toISOString()
  return ms % 86400000 === 0 ? iso.slice(0, 10) : iso.slice(0, 19)
}

// --------------------------------------------------------------- CSV ----

function parseCsv(text: string, delim: string): Cell[][] {
  const rows: Cell[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === delim) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  // Numbers stay numbers; everything else stays a string (leading zeros survive).
  return rows.map((r) => r.map((c) => (c !== '' && /^-?\d+(\.\d+)?$/.test(c) && !/^0\d/.test(c) ? Number(c) : c === '' ? null : c)))
}

// ------------------------------------------------------------ helpers ----

function fillMerged(rows: Cell[][], merges: string[]) {
  for (const ref of merges) {
    const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
    if (!m) continue
    const [c1, r1, c2, r2] = [colIndex(m[1]), Number(m[2]) - 1, colIndex(m[3]), Number(m[4]) - 1]
    const value = rows[r1]?.[c1] ?? null
    for (let r = r1; r <= r2; r++) {
      rows[r] = rows[r] || []
      for (let c = c1; c <= c2; c++) rows[r][c] = value
    }
  }
}

function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function colLetter(index: number): string {
  let s = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function slugify(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\wÀ-￿-]/g, '')
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`(?:^|[\\s"'])${name.replace(':', '\\:')}="([^"]*)"`))
  return m ? m[1] : null
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}
