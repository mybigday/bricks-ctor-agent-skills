# Recipe: Document Q&A / Product Finder (RAG)

"Answer questions about our menu / manual / product sheet."

## Components

- `vectorStore` generator — the knowledge index:
  - Embedding source: `ggml` (on-device GGUF) for offline apps, or an
    OpenAI-compatible endpoint (incl. LAN ollama / llama.cpp server)
  - Chunk size **below** the embedding model's context
  - Tokenizer model: reuse the LLM's GGUF (loads vocab-only)
- LLM generator (or a full `assistant` with file search enabled — prefer that
  for conversational UX; it handles citations, thresholds, and summaries)
- Optional `reranker` generator between search and prompt for quality on
  bigger corpora

## Ingestion

Two moments; pick per app:

- **Design time** (content is fixed): parse source files with the
  `document-essentials` skills (`pdf`/`xlsx`/`pptx`) and insert the cleaned
  text via the vectorStore insert-text command — cleaner chunks than raw file
  ingestion, and you control the structure.
- **Runtime** (users/staff add documents): wire the vectorStore insert-file
  command — it ingests Office/OpenOffice/PDF directly. **Runtime PDF parsing
  is web/desktop-only**; mobile/TV launchers should receive pre-parsed
  content or non-PDF formats.

Re-index rule: when the source changes, remove the old file/text from the
store before inserting the new version — duplicate stale chunks are the top
cause of wrong answers.

## Query flow (hand-wired variant)

1. User question (typed or via voice recipe) → property `question`.
2. vectorStore search command → top-k chunks (start k=4).
3. Optional rerank → keep top 2–3.
4. Data calculation builds the prompt: system prompt with hard grounding rules
   ("answer only from the provided context; say you don't know otherwise"),
   then the chunks, then the question.
5. LLM → `answer` property → RichText display; show sources when trust
   matters (citation metadata from the store).

With `assistant` + file search enabled, steps 2–5 are internal — configure
citation count and score threshold instead, and set the ignore-threshold flag
only when misses should still answer from model knowledge (rarely right for
kiosks).

## Offline behavior

Fully offline with ggml embeddings + local LLM once models and the index are
on the device. Web target caveat: web runs SQLite in memory — the index
rebuilds on load, so keep web corpora small or ship pre-inserted content at
design time.

## Verify

- Ask 5 questions with known answers **and 3 that aren't in the corpus** —
  the "I don't know" behavior is the real quality bar for public screens.
- Check retrieval before blaming the LLM: log the retrieved chunks for a bad
  answer; if the right chunk isn't there, fix chunking/re-indexing, not the
  prompt.
- Latency on device with the real corpus size.
