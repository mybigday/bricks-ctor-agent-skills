# Document Essentials

Turn business files into app content. Four skills, one per format, each opt-in:

- **`pdf`** — extract text from PDF menus, price lists, catalogs, and reports; route the content
  into Data entries, properties, or searchable knowledge; wire runtime PDF ingestion for apps
  that accept documents while running.
- **`docx`** — extract headings, paragraphs, lists, tables, and embedded images from Word
  documents with a self-contained zero-dependency parser; import as Data entries, properties, or
  searchable knowledge; re-import when the document changes.
- **`xlsx`** — parse spreadsheets (.xlsx, .csv, .tsv) into structured, typed rows with a
  self-contained zero-dependency parser; import as Data entries or Property Bank values; re-import
  when the sheet changes.
- **`pptx`** — extract per-slide text, speaker notes, and embedded images; rebuild decks as
  Slideshow-brick playlists or re-authored native layouts.

Try prompts like:

- "Import this menu PDF and build a menu board from it: `~/Downloads/menu.pdf`"
- "Build a menu board from `menu.docx`"
- "Load `prices.xlsx` into the app's product list"
- "Turn `company-deck.pptx` into a lobby signage loop"

## Notes

- All parsing happens locally on the design machine. The Word/spreadsheet/deck parsers have zero
  dependencies; the PDF script runs the version-pinned `officeparser@5.1.1` CLI via bunx
  (network needed once, cached afterwards).
- Runtime (on-device) ingestion: Word docs, spreadsheets, and other office docs work everywhere
  via the vectorStore generator and `parseDocument` in data calculations; **PDF parsing at
  runtime is web/desktop only** — the mobile/TV launchers don't include a runtime PDF parser.
- No OCR in this version: scanned PDFs extract little or no text; the `pdf` skill falls back to a
  vision-model description flow.
