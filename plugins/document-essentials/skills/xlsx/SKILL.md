---
name: xlsx
description: Use when the user brings a spreadsheet (.xlsx, .csv, .tsv) into their BRICKS project and wants its data in the app — product lists, price tables, schedules, bookings, inventory, KPI sheets. Parses sheets into structured, typed rows on the design machine with a bundled zero-dependency script, shapes them, and imports as Data entries, Property Bank values, or data-calculation sources; large tables can also feed the vectorStore for semantic search. Covers re-import when the sheet changes and runtime ingestion for apps that accept uploaded sheets. Triggers on "import this Excel", "use this spreadsheet", "load the price list", or a spreadsheet path in the prompt. Do NOT use to create or edit spreadsheet files as the deliverable, and not for PDFs, Word docs, or slide decks (use the pdf / docx / pptx skills).
license: MIT
metadata:
  version: 0.1.0
  author: BRICKS
---

# Spreadsheet Import

Turn a spreadsheet into live app data: Data entries, Property Bank values, or
data-calculation sources.

**Announce at start:** "I'm using the xlsx skill to import this spreadsheet."

## Step 1: Inspect

Run the bundled parser in listing mode to see sheets, sizes, and a first-row
preview. Resolve the script path against this skill directory (the directory
containing this SKILL.md) and pass the absolute path to `bun` as a single
command — no pipes, redirections, or chained shell commands. The script has
zero dependencies and runs fully offline.

```bash
bun /absolute/path/to/xlsx/scripts/xlsx_to_json.ts --list path/to/file.xlsx
```

Confirm with the user which sheet and columns matter when there is more than
one plausible target. Watch for: header rows that don't start at row 1, merged
cells, unit rows under headers, and trailing summary rows.

## Step 2: Parse to structured rows

```bash
bun /absolute/path/to/xlsx/scripts/xlsx_to_json.ts --sheet "Menu" --header-row 2 --out output/import/menu.json path/to/file.xlsx
```

The output is `{ source, sheet, headerRow, columns, rowCount, rows }` with
typed cells. Rules the script applies:

- **Dates:** spreadsheet serial numbers become ISO strings (`--dates serial`
  keeps raw numbers). Verify one sample date against the source before
  importing — date detection is heuristic.
- **Formulas:** the last **computed value** is exported, never the formula.
- **Empty cells** become `null`, not `""`.
- **Merged cells:** the value lands in the top-left cell; add `--fill-merged`
  to copy it across the merged range.
- CSV/TSV files parse directly; strings with leading zeros stay strings.

For very large sheets, parse is capped at 5000 rows by default — confirm the
shape on the first rows, then re-run with `--limit 0` for everything.

## Step 3: Choose the destination

| Content | Destination | Why |
|---|---|---|
| Values edited rarely, used in one place (title, phone, prices on one board) | Brick properties / Property Bank values | simplest; no indirection |
| Lists and tables the UI iterates (menu items, rooms, products) | **Data entries** (project Data, edited with `edit_entry`) | structured; drives list UIs |
| Content users will search or ask questions about | vectorStore ingestion (see `ai-recipes` doc-qa pattern) | semantic search / RAG |
| Data that must update on devices without redeploy | Data Bank (cloud data via the dataBank generator) | live updates to the fleet |

Default for tabular data: Data entries. Ask the user only when the destination
changes the app's structure.

## Step 4: Import

- Data entries: use the `edit_entry` tool (Data type). Derive stable keys from
  a natural column (SKU, item name) — not from row order — so re-imports
  update instead of duplicate.
- Shape rows to what the UI needs before importing: rename columns to
  property names (the script's `columns[].key` mapping is the starting
  point), coerce types, drop unused columns.
- Keep the parsed JSON in `output/import/` — it records the source file,
  sheet, header row, and column mapping, which makes the import reviewable
  and repeatable.

## Step 5: Verify

Preview in the simulator: the list UI renders every row; spot-check first,
last, and one middle row against the source file. Check type-sensitive
displays: dates, currency, decimals, phone numbers.

## Re-import (the sheet changed)

1. Re-run Step 2 with the same flags (they are recorded in the previous JSON).
2. Diff old vs new JSON; report added/removed/changed keys to the user.
3. Update Data entries by stable key; never wholesale-delete unless asked.

## Runtime ingestion (apps that accept sheets while running)

For apps that must ingest user-uploaded files at runtime, don't parse at
design time — wire the app itself:

- The `vectorStore` generator's insert-file command ingests Office/OpenOffice
  documents into searchable chunks (works on all launchers).
- Data calculations can call `parseDocument(path)` for text extraction.

Both give **text**, not structured cells — for structured runtime data,
prefer the Data Bank flow (update data in the cloud, devices subscribe via the
dataBank generator) over runtime file parsing.

## Guidelines

- Sample before bulk: for files with thousands of rows, parse 20 rows first
  (`--limit 20`), confirm the shape with the user, then run the full import.
- Numbers displayed as text (leading zeros, phone numbers) must stay strings —
  respect the source column formatting.
- Multi-sheet workbooks: one logical table per destination; don't merge
  unrelated sheets into one Data list.

## When Not To Use

- The deliverable is a spreadsheet file (creating/editing .xlsx) — out of scope.
- The file is a PDF, Word document, or slide deck — use the `pdf` / `docx` /
  `pptx` skills.
- Tiny one-off values (a single number) — just set the property directly.
