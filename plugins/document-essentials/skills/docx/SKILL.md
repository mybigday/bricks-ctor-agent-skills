---
name: docx
description: Use when the user brings a Word document (.docx) into their BRICKS project and wants its content in the app — menus, price lists, policies, product sheets, event programs, manuals, service guides. Extracts headings, paragraphs, lists, tables, and embedded images on the design machine with a bundled zero-dependency script; routes the results into Data entries, Property Bank values, data-calculation sources, or media assets, and can feed the vectorStore for document Q&A. Covers re-import when the document changes and runtime ingestion for apps that accept uploaded documents. Triggers on "import this Word document", "use this docx", "read the menu from this Word file", or a .docx path in the prompt. Do NOT use to create or edit Word files as the deliverable, and not for PDFs, spreadsheets, or slide decks (use the pdf / xlsx / pptx skills).
license: MIT
metadata:
  version: 0.1.0
  author: BRICKS
---

# Word Document Import

Turn a Word document into live app content: Data entries, Property Bank
values, media assets, or searchable knowledge.

**Announce at start:** "I'm using the docx skill to import this document."

## Step 1: Extract

Run the bundled script. Resolve the path against this skill directory (the
directory containing this SKILL.md) and pass the absolute script path to `bun`
as a single command — no pipes or chaining. Zero dependencies, fully offline.

```bash
bun /absolute/path/to/docx/scripts/docx_extract.ts document.docx --out output/import/document.json --extract-media output/import/document-media
```

The JSON contains `blocks` in document order — `heading` (with level;
localized heading styles and Title are recognized), `paragraph`, `list-item`
(with indent level), and `table` (rows of cell strings) — plus extracted
`media` paths. Legacy `.doc` and `.odt` are unsupported — ask for a `.docx`
export.

Extraction rules to keep in mind:

- **Structure needs styles.** Documents authored without Word's heading/list
  styles (pure direct formatting, some converters) come out as plain
  paragraphs — infer the structure from the text yourself.
- **Tables:** vertically merged cells carry text only in the top cell
  (continuations are empty strings); nested tables flatten into their
  containing cell's text.
- **Tracked changes** export as if accepted; hyperlinks keep their text but
  lose the URL.
- **Not extracted:** headers, footers, footnotes, comments.

## Step 2: Choose the destination

| Content | Destination | Why |
|---|---|---|
| A few values used in fixed places (title, phone, tagline, opening hours) | Brick properties / Property Bank values | simplest; no indirection |
| Lists and tables the UI iterates (menu items, products, schedule rows) | **Data entries** (project Data, edited with `edit_entry`) | structured, drives list UIs |
| Long-form content users will search or ask questions about (manuals, policies) | vectorStore ingestion (see `ai-recipes` doc-qa pattern) | semantic search / RAG |
| Embedded images worth showing (photos, logos, illustrations) | `media_upload_files` → Image / Slideshow bricks | reuses the document's own assets |

Default for tabular content: Data entries. Ask the user only when the choice
changes the app's structure.

## Step 3: Shape and import

1. Use the heading hierarchy to segment content — headings usually delimit the
   categories or sections a screen iterates. Word tables usually map 1:1 to a
   Data list with the first row as column names. Write the structured result
   to `output/import/<name>.json` so the mapping is reviewable.
2. Import:
   - Data entries: use the `edit_entry` tool (Data type). Derive stable keys
     from a natural field (item name, SKU) — not from block order — so
     re-imports update instead of duplicate.
   - Property values: set brick properties or Property Bank initial values via
     the project editing tools.
   - Embedded images: upload the `--extract-media` output with
     `media_upload_files` (if the media tools are unavailable, ask the user to
     upload via the Controller UI).
3. Record provenance at the top of the JSON file: source path, extraction
   date, and the field mapping.

## Step 4: Verify

Preview in the simulator: spot-check imported values against the source
document — first item, last item, and one from the middle. Check currency,
dates, and phone-number formatting survived, and that every uploaded image
renders.

## Runtime ingestion (apps that accept documents while running)

For apps that must ingest user-provided documents at runtime, don't parse at
design time — wire the app itself:

- The `vectorStore` generator's insert-file command ingests Word / Office /
  OpenOffice documents into searchable chunks — works on **all launchers**
  (unlike PDF, which is web/desktop only at runtime).
- Data calculations can call `parseDocument(path)` for text extraction.

Both give **text**, not structured blocks — for structured runtime data,
prefer the Data Bank flow (update data in the cloud, devices subscribe via the
dataBank generator) over runtime file parsing.

## Re-import (the document changed)

Re-run Step 1, diff the new blocks JSON against the previous one (headings,
tables, counts), report changes to the user, and update Data entries by stable
key. Never wholesale-delete entries unless asked.

## When Not To Use

- The deliverable is a Word file (creating/editing .docx) — out of scope.
- The file is a PDF, spreadsheet, or slide deck — use the `pdf` / `xlsx` /
  `pptx` skills.
- The user pasted the text already — just use it directly.
