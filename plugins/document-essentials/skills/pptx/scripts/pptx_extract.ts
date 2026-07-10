#!/usr/bin/env bun
/**
 * pptx_extract.ts — extract slide text, speaker notes, and embedded media from
 * a .pptx deck. Zero dependencies (self-contained ZIP reader on node:zlib),
 * runs fully offline.
 *
 *   bun pptx_extract.ts <file.pptx> [--out <path>] [--extract-media <dir>] [--no-notes]
 *
 * Options:
 *   --out <path>           Write the JSON result to this file instead of stdout.
 *   --extract-media <dir>  Copy each slide's embedded images/videos into <dir>
 *                          as slide<N>_<original-name>; JSON lists the paths.
 *   --no-notes             Skip speaker notes.
 *
 * Output shape:
 *   { source, slideCount, slides: [{ index, title, blocks, notes, media }] }
 *   - blocks: text paragraphs per shape, in document order
 *   - title:  text of the title placeholder when present
 *
 * Known limits: no slide→image rendering (PowerPoint/Keynote export does that
 * better); charts/SmartArt extract only their text runs; .ppt (legacy binary)
 * is unsupported — ask for a .pptx export.
 */

import { inflateRawSync } from 'node:zlib'
import { mkdirSync } from 'node:fs'

const argv = process.argv.slice(2)
const files: string[] = []
const opts: Record<string, string | boolean> = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--no-notes') opts.noNotes = true
  else if (a === '--out' || a === '--extract-media') opts[a.replace(/^--/, '').replace('extract-media', 'mediaDir')] = argv[++i]
  else if (a.startsWith('--')) fail(`Unknown option: ${a}`)
  else files.push(a)
}
if (files.length !== 1) fail('Usage: bun pptx_extract.ts <file.pptx> [--out <path>] [--extract-media <dir>] [--no-notes]')

const file = files[0]
if (file.toLowerCase().endsWith('.ppt')) fail('Legacy .ppt is unsupported — ask for a .pptx export')
const buf = Buffer.from(await Bun.file(file).arrayBuffer().catch(() => fail(`File not found: ${file}`)))
const zip = readZip(buf)

// Slide order: presentation.xml sldIdLst r:id order → rels → slides/slideN.xml
const presXml = text(zip, 'ppt/presentation.xml') || fail('ppt/presentation.xml missing — not a pptx file?')
const presRels = parseRels(text(zip, 'ppt/_rels/presentation.xml.rels') || '', 'ppt/')
const slidePaths: string[] = []
for (const m of presXml.matchAll(/<p:sldId\b[^>]*/g)) {
  const rid = attr(m[0], 'r:id')
  const target = rid && presRels.get(rid)
  if (target) slidePaths.push(target)
}
if (!slidePaths.length) fail('No slides found in the deck')

const slides = slidePaths.map((path, i) => {
  const xml = text(zip, path) || ''
  const rels = parseRels(text(zip, relsPath(path)) || '', dirOf(path))

  // Shapes in document order; title = placeholder type "title"/"ctrTitle".
  let title: string | null = null
  const blocks: string[] = []
  for (const sp of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>|<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g)) {
    const shape = sp[0]
    const paragraphs: string[] = []
    for (const p of shape.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
      let line = ''
      for (const t of (p[1] || p[2] || '').matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g))
        line += decodeXml(t[1] ?? t[2] ?? '')
      if (line.trim()) paragraphs.push(line.trim())
    }
    if (!paragraphs.length) continue
    const isTitle = /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(shape)
    if (isTitle && title === null) title = paragraphs.join(' ')
    else blocks.push(paragraphs.join('\n'))
  }

  // Speaker notes via the slide's notesSlide relationship.
  let notes: string | null = null
  if (!opts.noNotes) {
    const notesTarget = [...rels.values()].find((t) => /notesSlides\//.test(t))
    if (notesTarget) {
      const nx = text(zip, notesTarget) || ''
      const lines: string[] = []
      for (const t of nx.matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)) {
        const s = decodeXml(t[1] ?? t[2] ?? '')
        if (s.trim()) lines.push(s.trim())
      }
      // Drop the trailing slide-number placeholder PowerPoint adds.
      notes = lines.filter((l) => !/^\d+$/.test(l)).join('\n') || null
    }
  }

  // Embedded media (images/videos) referenced by this slide.
  const media: string[] = []
  for (const target of rels.values()) {
    if (!/ppt\/media\//.test(target) || media.includes(target)) continue
    media.push(target)
  }
  let mediaOut: string[] = media.map((m) => m.split('/').pop() as string)
  if (opts.mediaDir) {
    const dir = String(opts.mediaDir)
    mkdirSync(dir, { recursive: true })
    mediaOut = media.map((m) => {
      const name = `slide${i + 1}_${m.split('/').pop()}`
      const bytes = raw(zip, m)
      if (bytes) Bun.write(`${dir}/${name}`, bytes)
      return `${dir}/${name}`
    })
  }

  return { index: i + 1, title, blocks, notes, media: mediaOut }
})

const result = { source: file, slideCount: slides.length, slides }
const json = JSON.stringify(result, null, 2)
if (opts.out) {
  await Bun.write(String(opts.out), json + '\n')
  console.log(JSON.stringify({ out: opts.out, slideCount: slides.length }))
} else console.log(json)

// ------------------------------------------------------------ helpers ----

function relsPath(p: string): string {
  const parts = p.split('/')
  const name = parts.pop()
  return `${parts.join('/')}/_rels/${name}.rels`
}

function dirOf(p: string): string {
  return p.split('/').slice(0, -1).join('/') + '/'
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
  if (eocd < 0) fail('Not a valid .pptx (zip end record not found)')
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
