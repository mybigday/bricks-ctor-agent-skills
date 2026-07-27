---
name: pptx
description: Use when the user brings a presentation (.pptx) into their BRICKS project — company decks, menus designed as slides, event programs — and wants it on screen. Extracts per-slide text, titles, speaker notes, and embedded images on the design machine with a bundled zero-dependency script; then builds or updates the app — a Slideshow brick playlist, re-authored native layouts, or media-box assets. Covers slide-to-signage conversion (aspect ratio and safe areas, per-slide duration, loop behavior) and re-import when the deck changes. Triggers on "turn this deck into signage", "import these slides", "use this presentation", or a .pptx path in the prompt. Do NOT use to author new .pptx files as the deliverable, and not for PDFs, Word docs, or spreadsheets (use the pdf / docx / xlsx skills).
license: MIT
metadata:
  version: 0.1.0
  author: BRICKS
---

# Presentation Import

Turn a slide deck into a screen app: a media slideshow, re-authored native
layouts, or extracted content for other bricks.

**Announce at start:** "I'm using the pptx skill to import this deck."

## Step 1: Extract

Run the bundled script. Resolve the path against this skill directory (the
directory containing this SKILL.md) and pass the absolute script path to `bun`
as a single command — no pipes or chaining. Zero dependencies, fully offline.

```bash
bun /absolute/path/to/pptx/scripts/pptx_extract.ts deck.pptx --out output/import/deck.json --extract-media output/import/deck-media
```

The JSON contains, per slide: `index`, `title`, text `blocks`, speaker `notes`,
and extracted `media` file paths. Legacy `.ppt` is unsupported — ask the user
for a `.pptx` export.

## Step 2: Choose the representation

| Representation | Fidelity | Editable in app | When |
|---|---|---|---|
| **Slide images → Slideshow brick** | pixel-perfect | no (replace images to update) | designed decks where layout is the point |
| **Re-authored native bricks** (Text/RichText/Image per slide) | rebuilt | yes — becomes real app content | content-driven decks; when the user wants to keep editing in BRICKS |
| **Hybrid** | mixed | partly | image slides for designed pages + native for text-heavy ones |

The script does **not** render slides to images (no local renderer can match
PowerPoint). For the image path, ask the user to export slides as PNG/JPEG
(PowerPoint: File → Export; Keynote: File → Export To → Images) at the target
screen resolution.

Recommend based on what the user wants to do after import; ask only if
ambiguous.

## Step 3a: Build a Slideshow (image path)

1. Upload the exported slide images with `media_upload_files` (if the media
   tools are unavailable, ask the user to upload via the Controller UI).
2. Add a Slideshow brick and set its media path list in slide order; set the
   per-slide interval (default 8–10 s for signage), loop on, shuffle off.
3. Match the canvas: if the deck is 16:9 and the screen is portrait, don't
   letterbox the full canvas — pair the slideshow with a header/footer or
   re-export portrait slides instead.

## Step 3b: Re-author natively (content path)

1. Use the extracted `title` / `blocks` / `media` per slide as the content
   source; embedded images from `--extract-media` go through
   `media_upload_files`.
2. Rebuild each slide as bricks (Text/RichText/Image), one canvas or one
   Slideshow child per slide. Respect the deck's visual hierarchy: title →
   large, blocks → body size; keep colors from the deck's look if the user has
   no brand palette in the app.
3. Speaker notes often contain timing or context — surface anything that looks
   like display instructions ("show 10s", "skip internally") to the user
   instead of silently dropping it.

## Step 4: Verify

Preview in the simulator at the target aspect ratio. Check: slide order, text
overflow on the smallest target screen, image sharpness (exported resolution ≥
screen resolution), and loop/interval behavior.

## Re-import (the deck changed)

Re-run Step 1, diff the new JSON against the previous one (slide count, titles,
block text), report changes, and update only the affected slides/media. Keep
`output/import/deck.json` as the record of the last import.

## When Not To Use

- The deliverable is a .pptx file (creating/editing presentations) — out of scope.
- The file is a PDF, Word document, or spreadsheet — use the `pdf` / `docx` /
  `xlsx` skills.
- The user wants a data-driven display that happens to look like slides —
  build it natively from the start (Items/Slideshow with app data), no import
  needed.
