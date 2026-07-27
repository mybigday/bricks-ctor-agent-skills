---
name: pdf
description: Use when the user brings a PDF into their BRICKS project and wants its content in the app — menus, price lists, schedules, catalogs, brochures, reports, or scanned documents. Extracts text on the design machine with a bundled script, routes the results into Data entries, Property Bank values, data-calculation sources, or media assets, and covers converting pages to images for slideshows. Also covers wiring runtime PDF ingestion (vectorStore RAG, parseDocument in data calculations) for apps that accept documents while running — note that mobile/TV launchers cannot parse PDF at runtime (web/desktop only). Triggers on "import this PDF", "read the menu from this PDF", "use this catalog", or any .pdf path in the prompt. Do NOT use for creating or exporting PDF files, or for Word docs, spreadsheets, and slide decks (use the docx / xlsx / pptx skills).
license: MIT
metadata:
  version: 0.1.0
  author: BRICKS
---

# PDF Import

Turn a PDF into live app content: Data entries, Property Bank values, media
assets, or searchable knowledge.

**Announce at start:** "I'm using the pdf skill to import this PDF."

## Step 1: Extract the text

Run the bundled script. Resolve the path against this skill directory (the
directory containing this SKILL.md) and pass the absolute script path to `bun`.
Keep it a single command — no pipes, redirections, or chained shell commands.
Internally it runs the version-pinned `officeparser@5.1.1` CLI via bunx: the
first run downloads it (needs network once), then it's cached. If that first
run fails writing to Bun's cache in a restricted sandbox, the error message
shows the project-local cache fallback to use.

```bash
bun /absolute/path/to/pdf/scripts/pdf_extract.ts ~/Downloads/menu.pdf --out output/import/menu.txt
```

The script prints a JSON summary (chars, words, lines) and writes the full text
to `--out`. Read the output file, then sanity-check:

- **Almost no text extracted?** The PDF is likely scanned images — jump to
  "Scanned PDFs" below.
- **Text order looks shuffled?** Multi-column layouts extract in reading-order
  chunks; reconstruct the logical order manually before importing.

## Step 2: Choose the destination

| Content | Destination | Why |
|---|---|---|
| A few values used in fixed places (title, phone, tagline, prices on one board) | Brick properties / Property Bank values | simplest; no indirection |
| Lists and tables the UI iterates (menu items, products, schedule rows) | **Data entries** (project Data, edited with `edit_entry`) | structured, drives list UIs |
| Content users will search or ask questions about | vectorStore ingestion (see `ai-recipes` doc-qa pattern) | semantic search / RAG |
| Page visuals worth showing as-is (designed brochure pages) | Page images in the media box → Slideshow brick | preserves layout fidelity |

Default for tabular content: Data entries. Ask the user only when the choice
changes the app's structure.

## Step 3: Shape and import

1. Parse the extracted text into structured records (e.g. menu item name /
   price / description). Write the structured result to
   `output/import/<name>.json` so the mapping is reviewable.
2. Import:
   - Data entries: use the `edit_entry` tool (Data type). Derive stable keys
     from a natural field (item name, SKU) — not from row order — so re-imports
     update instead of duplicate.
   - Property values: set brick properties or Property Bank initial values via
     the project editing tools.
3. Record provenance at the top of the JSON file: source path, extraction
   date, and the field mapping.

## Step 4: Page images (optional)

When the design of the pages matters (brochures, designed menus):

- Ask the user to export pages as PNG/JPEG from their PDF viewer (Preview,
  Acrobat: File → Export), **or** open the PDF with the browser skill and
  screenshot each page.
- Upload the images with `media_upload_files`, then reference them from a
  Slideshow or Image brick. If the media tools are unavailable, ask the user
  to upload via the Controller UI instead.

## Step 5: Verify

Preview in the simulator: spot-check imported values against the source PDF —
first item, last item, and one from the middle. Check currency and number
formatting survived.

## Scanned PDFs (no embedded text)

There is no OCR in this skill. Options, in order:

1. Ask the user for a text-based version of the document (original export
   beats OCR every time).
2. Export pages as images (Step 4) and read them with `read_file` — a
   vision-capable model can transcribe the visible content. Verify transcribed
   numbers carefully before importing.

## Runtime ingestion (apps that accept PDFs while running)

For apps that must ingest user-provided documents at runtime, don't parse at
design time — wire the app itself:

- The `vectorStore` generator's insert-file command ingests Office / OpenOffice
  / PDF documents directly into searchable chunks.
- Data calculations can call `parseDocument(path)` on a file.

**Platform caveat:** runtime PDF parsing works on web and desktop launchers
only — the mobile/TV launchers' document parser does not include PDF. If the
app targets those devices, parse PDFs at design time or convert to a supported
format first.

## Re-import (the PDF changed)

Re-run Step 1, diff the new structured JSON against the previous one, report
added/removed/changed records to the user, and update Data entries by stable
key. Never wholesale-delete entries unless asked.

## When Not To Use

- The deliverable is a PDF file (creating/exporting) — out of scope.
- The file is a Word document, spreadsheet, or slide deck — use the `docx` /
  `xlsx` / `pptx` skills.
- The user pasted the text already — just use it directly.
