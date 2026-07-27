#!/usr/bin/env bun
/**
 * docx_extract.ts — extract headings, paragraphs, lists, tables, and embedded
 * media from a .docx document. Zero dependencies (self-contained ZIP reader on
 * node:zlib), runs fully offline.
 *
 *   bun docx_extract.ts <file.docx> [--out <path>] [--extract-media <dir>]
 *
 * Options:
 *   --out <path>           Write the JSON result to this file instead of stdout.
 *   --extract-media <dir>  Copy embedded images/videos into <dir> (original
 *                          file names); JSON lists the paths.
 *
 * Output shape:
 *   { source, blockCount, blocks, media }
 *   - blocks, in document order:
 *       { type: 'heading',   level, text }   heading styles incl. localized ones; Title = level 1
 *       { type: 'list-item', level, text }   level is 1-based indent depth
 *       { type: 'paragraph', text }
 *       { type: 'table',     rows }          rows: string[][], cell paragraphs joined with \n
 *   - media: embedded media file names (or extracted paths with --extract-media)
 *
 * Known limits: headers/footers, footnotes, and comments are not extracted;
 * hyperlinks keep their text but lose the URL; tracked changes export as if
 * accepted; nested tables flatten into their containing cell's text; vertically
 * merged cells carry text only in the top cell (continuations are empty);
 * legacy .doc and .odt are unsupported — ask for a .docx export.
 */

import { inflateRawSync } from 'node:zlib'
import { mkdirSync } from 'node:fs'

const argv = process.argv.slice(2)
const files: string[] = []
const opts: Record<string, string> = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--out' || a === '--extract-media') opts[a.replace(/^--/, '').replace('extract-media', 'mediaDir')] = argv[++i]
  else if (a.startsWith('--')) fail(`Unknown option: ${a}`)
  else files.push(a)
}
if (files.length !== 1) fail('Usage: bun docx_extract.ts <file.docx> [--out <path>] [--extract-media <dir>]')

const file = files[0]
if (/\.(doc|odt)$/i.test(file)) fail('Legacy .doc / OpenDocument .odt are unsupported — ask for a .docx export')
const buf = Buffer.from(await Bun.file(file).arrayBuffer().catch(() => fail(`File not found: ${file}`)))
const zip = readZip(buf)

// mc:AlternateContent duplicates content (modern Choice + legacy Fallback);
// drop the Fallback halves up front so text boxes don't extract twice.
const docXml = (text(zip, 'word/document.xml') || fail('word/document.xml missing — not a docx file?'))
  .replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '')
const docRels = parseRels(text(zip, 'word/_rels/document.xml.rels') || '', 'word/')
const styleLevels = headingLevels(text(zip, 'word/styles.xml') || '')

// ------------------------------------------------------------- blocks ----

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'list-item'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'table'; rows: string[][] }

const blocks: Block[] = []
for (const chunk of bodyChunks(docXml)) {
  if (chunk.kind === 'tbl') {
    const rows: string[][] = []
    for (const tr of chunks(chunk.xml, 'tr')) {
      const cells = chunks(tr, 'tc').map((tc) =>
        chunks(tc, 'p').map(paragraphText).filter(Boolean).join('\n'))
      if (cells.length) rows.push(cells)
    }
    if (rows.some((r) => r.some((c) => c))) blocks.push({ type: 'table', rows })
    continue
  }

  const text = paragraphText(chunk.xml)
  if (!text) continue

  // The paragraph's own properties: the first <w:pPr> only if it precedes any
  // content (a text box's inner paragraph may carry its own pPr further in).
  const pprMatch = chunk.xml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)
  const contentIdx = chunk.xml.search(/<w:r\b|<w:hyperlink\b|<w:fldSimple\b|<w:sdt\b/)
  const ppr = pprMatch && (contentIdx < 0 || (pprMatch.index as number) < contentIdx) ? pprMatch[0] : ''

  const outline = ppr.match(/<w:outlineLvl\b[^>]*w:val="(\d+)"/)
  const styleId = ppr.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)?.[1]
  const level = outline ? Math.min(9, Number(outline[1]) + 1) : styleId ? styleLevels.get(styleId) : undefined
  if (level) {
    blocks.push({ type: 'heading', level, text })
  } else if (/<w:numPr>/.test(ppr)) {
    const ilvl = ppr.match(/<w:ilvl\b[^>]*w:val="(\d+)"/)
    blocks.push({ type: 'list-item', level: ilvl ? Number(ilvl[1]) + 1 : 1, text })
  } else {
    blocks.push({ type: 'paragraph', text })
  }
}

// -------------------------------------------------------------- media ----

// Media referenced from the body, in document order (drawings + legacy VML).
const mediaIds: string[] = []
for (const m of docXml.matchAll(/r:embed="([^"]+)"|<v:imagedata\b[^>]*r:id="([^"]+)"/g)) {
  const id = m[1] || m[2]
  if (id && !mediaIds.includes(id)) mediaIds.push(id)
}
const media: string[] = []
for (const id of mediaIds) {
  const target = docRels.get(id)
  if (target && /word\/media\//.test(target) && !media.includes(target)) media.push(target)
}
let mediaOut: string[] = media.map((m) => m.split('/').pop() as string)
if (opts.mediaDir) {
  mkdirSync(opts.mediaDir, { recursive: true })
  mediaOut = media.map((m) => {
    const name = m.split('/').pop() as string
    const bytes = raw(zip, m)
    if (bytes) Bun.write(`${opts.mediaDir}/${name}`, bytes)
    return `${opts.mediaDir}/${name}`
  })
}

const result = { source: file, blockCount: blocks.length, blocks, media: mediaOut }
const json = JSON.stringify(result, null, 2)
if (opts.out) {
  await Bun.write(opts.out, json + '\n')
  console.log(JSON.stringify({ out: opts.out, blockCount: blocks.length, mediaCount: mediaOut.length }))
} else console.log(json)

// ------------------------------------------------------------ helpers ----

// Top-level <w:p> / <w:tbl> chunks in document order. Depth-counted per kind:
// tables contain paragraphs, and paragraphs can contain tables/paragraphs
// again through text boxes — only the outermost chunk of either kind counts.
function bodyChunks(xml: string): { kind: 'p' | 'tbl'; xml: string }[] {
  const out: { kind: 'p' | 'tbl'; xml: string }[] = []
  let current: 'p' | 'tbl' | null = null
  let depth = 0
  let start = -1
  for (const m of xml.matchAll(/<\/?w:(p|tbl)\b[^>]*>/g)) {
    const token = m[0]
    const kind = m[1] as 'p' | 'tbl'
    if (current && kind !== current) continue
    if (token.startsWith('</')) {
      if (current && --depth === 0) {
        out.push({ kind: current, xml: xml.slice(start, (m.index as number) + token.length) })
        current = null
      }
    } else if (token.endsWith('/>')) {
      if (!current) out.push({ kind, xml: token })
    } else if (current) {
      depth++
    } else {
      current = kind
      depth = 1
      start = m.index as number
    }
  }
  return out
}

// Depth-counted chunks of one tag inside a fragment (handles nested tables).
function chunks(xml: string, tag: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  for (const m of xml.matchAll(new RegExp(`</?w:${tag}\\b[^>]*>`, 'g'))) {
    const token = m[0]
    if (token.startsWith('</')) {
      if (depth > 0 && --depth === 0) out.push(xml.slice(start, (m.index as number) + token.length))
    } else if (token.endsWith('/>')) {
      if (depth === 0) out.push(token)
    } else if (depth++ === 0) start = m.index as number
  }
  return out
}

// Visible text of a paragraph: runs in order, <w:br>/<w:cr> → newline,
// <w:tab> → tab. Paragraph properties are stripped first so tab-stop
// definitions and style names never leak into the text; <w:delText>
// (tracked deletions) and <w:instrText> (field codes) are never matched.
function paragraphText(pXml: string): string {
  const src = pXml.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>|<w:pPr\b[^>]*\/>/g, '')
  let out = ''
  for (const m of src.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:br|cr)\b[^>]*\/?>|<w:tab\s*\/>/g)) {
    if (m[1] !== undefined) out += decodeXml(m[1])
    else out += m[0].includes('tab') ? '\t' : '\n'
  }
  return out.trim()
}

// styles.xml → styleId → heading level. Catches Heading1–9 ids, localized
// heading styles (w:name "heading N" or an outlineLvl in the style), and Title.
function headingLevels(stylesXml: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const st of stylesXml.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)) {
    const chunk = st[0]
    const id = attr(chunk.match(/<w:style\b[^>]*/)?.[0] || '', 'w:styleId')
    if (!id) continue
    const name = attr(chunk.match(/<w:name\b[^>]*/)?.[0] || '', 'w:val')
    const idMatch = id.match(/^Heading([1-9])$/i)
    const nameMatch = name?.match(/^heading ([1-9])$/i)
    const outline = chunk.match(/<w:outlineLvl\b[^>]*w:val="(\d+)"/)
    if (idMatch) map.set(id, Number(idMatch[1]))
    else if (nameMatch) map.set(id, Number(nameMatch[1]))
    else if (id === 'Title' || name === 'Title') map.set(id, 1)
    else if (outline) map.set(id, Math.min(9, Number(outline[1]) + 1))
  }
  return map
}

// Relationship targets normalized against the owning part's directory.
function parseRels(xml: string, baseDir: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of xml.matchAll(/<Relationship\b[^>]*/g)) {
    const id = attr(m[0], 'Id')
    let target = attr(m[0], 'Target') || ''
    if (!id || !target || /^https?:/.test(target)) continue
    if (target.startsWith('/')) target = target.slice(1)
    else {
      let dir = baseDir
      while (target.startsWith('../')) {
        target = target.slice(3)
        dir = dir.replace(/[^/]+\/$/, '')
      }
      target = dir + target
    }
    out.set(id, target)
  }
  return out
}

type ZipEntry = { name: string; method: number; compSize: number; localOffset: number }

function readZip(b: Buffer): Map<string, ZipEntry> {
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) fail('Not a valid .docx (zip end record not found)')
  const count = b.readUInt16LE(eocd + 10)
  let p = b.readUInt32LE(eocd + 16)
  if (p === 0xffffffff) fail('ZIP64 archives are not supported')
  const entries = new Map<string, ZipEntry>()
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) break
    const method = b.readUInt16LE(p + 10)
    const compSize = b.readUInt32LE(p + 20)
    const nameLen = b.readUInt16LE(p + 28)
    const extraLen = b.readUInt16LE(p + 30)
    const commentLen = b.readUInt16LE(p + 32)
    const localOffset = b.readUInt32LE(p + 42)
    const name = b.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, { name, method, compSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function raw(zip: Map<string, ZipEntry>, name: string): Buffer | null {
  const e = zip.get(name)
  if (!e || buf.readUInt32LE(e.localOffset) !== 0x04034b50) return null
  const nameLen = buf.readUInt16LE(e.localOffset + 26)
  const extraLen = buf.readUInt16LE(e.localOffset + 28)
  const start = e.localOffset + 30 + nameLen + extraLen
  const data = buf.subarray(start, start + e.compSize)
  if (e.method === 0) return Buffer.from(data)
  if (e.method === 8) return inflateRawSync(data)
  return null
}

function text(zip: Map<string, ZipEntry>, name: string): string | null {
  return raw(zip, name)?.toString('utf8') ?? null
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

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}
