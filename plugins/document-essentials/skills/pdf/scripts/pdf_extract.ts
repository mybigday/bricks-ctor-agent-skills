#!/usr/bin/env bun
/**
 * pdf_extract.ts — extract text from a PDF (or other office document).
 *
 * Wraps the version-pinned officeparser CLI (bunx officeparser@5.1.1) so the
 * dependency is fetched once into Bun's cache and the parser API can't drift.
 * First run needs network; afterwards it works offline.
 *
 *   bun pdf_extract.ts <file> [--out <path>] [--stats] [--max-chars <n>]
 *
 * Options:
 *   --out <path>      Write the full extracted text to this file. A JSON
 *                     summary is printed to stdout instead of the text.
 *   --stats           Print only the JSON summary (no text output).
 *   --max-chars <n>   Truncate stdout text output at n chars (default 200000).
 *                     Has no effect on --out files, which always get full text.
 *
 * Output on success (with --out or --stats): one JSON line, e.g.
 *   { "file": "menu.pdf", "chars": 5210, "words": 812, "lines": 140,
 *     "out": "output/import/menu.txt", "likelyScanned": false }
 *
 * Supported input: .pdf plus .docx/.pptx/.xlsx/.odt/.odp/.ods (officeparser).
 * If the first run fails writing to Bun's cache (restricted sandboxes), retry
 * with a project-local cache: BUN_INSTALL_CACHE_DIR=output/.bun-cache bun …
 */

const OFFICEPARSER = 'officeparser@5.1.1'

const args = process.argv.slice(2)
const files: string[] = []
const opts: Record<string, string | boolean> = {}
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--stats') opts.stats = true
  else if (a === '--out' || a === '--max-chars') opts[a.slice(2)] = args[++i]
  else if (a.startsWith('--')) fail(`Unknown option: ${a}`)
  else files.push(a)
}

if (files.length !== 1) {
  fail('Usage: bun pdf_extract.ts <file> [--out <path>] [--stats] [--max-chars <n>]')
}

const file = files[0]
if (!(await Bun.file(file).exists())) fail(`File not found: ${file}`)

const proc = Bun.spawn(['bunx', OFFICEPARSER, file], {
  stdout: 'pipe',
  stderr: 'pipe',
})
const [text, errText, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
])
if (exitCode !== 0) {
  fail(
    `officeparser failed (exit ${exitCode}) for ${file}:\n${errText.trim()}\n\n` +
      'Hints: the first run downloads the parser (needs network once); in a\n' +
      'restricted sandbox, retry with a project-local cache dir:\n' +
      `  BUN_INSTALL_CACHE_DIR=output/.bun-cache bun ${process.argv[1]} ${file}`,
  )
}

const trimmed = text.trim()
const summary = {
  file,
  chars: trimmed.length,
  words: trimmed ? trimmed.split(/\s+/).length : 0,
  lines: trimmed ? trimmed.split('\n').length : 0,
  out: (opts.out as string) || null,
  // A text-based PDF of any real document has far more than 50 chars; a
  // near-empty result almost always means scanned page images (no OCR here).
  likelyScanned: file.toLowerCase().endsWith('.pdf') && trimmed.length < 50,
}

if (opts.out) {
  await Bun.write(String(opts.out), trimmed + '\n')
  console.log(JSON.stringify(summary))
} else if (opts.stats) {
  console.log(JSON.stringify(summary))
} else {
  const maxChars = Number(opts['max-chars'] || 200000)
  if (trimmed.length > maxChars) {
    console.log(trimmed.slice(0, maxChars))
    console.error(`[truncated at ${maxChars} chars — use --out to get the full text]`)
  } else {
    console.log(trimmed)
  }
}
if (summary.likelyScanned) {
  console.error(
    '[warning] Almost no text extracted — this PDF is likely scanned images. ' +
      'There is no OCR here; see the pdf skill\'s "Scanned PDFs" section.',
  )
}

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}
