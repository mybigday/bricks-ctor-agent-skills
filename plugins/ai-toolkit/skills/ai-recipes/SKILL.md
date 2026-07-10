---
name: ai-recipes
description: Use when implementing a complete AI feature in a BRICKS app end-to-end, after generator and model choice. Proven wiring patterns with events, actions, and Property Bank state - voice kiosk (VAD → STT → LLM → TTS, or the assistant generator with MCP tools and file search), document Q&A / product finder (file ingestion → vectorStore → reranker → LLM), realtime transcription display, and AI image/video signage with the GenerativeMedia brick. Each recipe includes the generators and bricks to add, state shape, event wiring, offline behavior, and how to verify in the simulator and on device. Triggers on "build a voice assistant kiosk", "make a FAQ bot from these files", "live captions", "AI-generated visuals", "wire it up". Do NOT use for picking generators or models (use ai-generators / ai-model-selection first).
license: MIT
metadata:
  version: 0.1.0
  author: BRICKS
---

# AI Feature Recipes

End-to-end wiring patterns. Each recipe lives in `references/` — read the one
that matches, then adapt:

| Recipe | File | Use for |
|---|---|---|
| Voice kiosk | [references/voice-kiosk.md](references/voice-kiosk.md) | Talk-to-it kiosks, voice ordering, information desks |
| Document Q&A / RAG | [references/doc-qa.md](references/doc-qa.md) | "Answer questions about our menu/manual/products" |
| Live captions | [references/live-captions.md](references/live-captions.md) | Realtime transcription on screen |
| Generative signage | [references/generative-signage.md](references/generative-signage.md) | AI-generated ambient visuals |

**Announce at start:** "I'm using the ai-recipes skill — following the <name>
recipe."

## Rules that apply to every recipe

1. **Prerequisites first.** Generator and model must already be chosen
   (`ai-generators`, `ai-model-selection`). If not, do that first.
2. **State lives in the Property Bank.** Every recipe defines a small state
   machine (e.g. `idle → listening → thinking → speaking`). Drive ALL UI from
   those properties — never from ad-hoc event side effects — so the UI stays
   consistent and testable.
3. **Offline behavior is part of the feature.** Local pipelines: state what
   happens while models download/heat up (first launch needs network unless
   models are preloaded). Cloud pieces: define the degrade path (cached
   content, default media, hidden entry point) — a public screen must never
   show an error card.
4. **Lifecycle on low-RAM devices.** Use heat-up options when latency matters
   and RAM allows; use `only-in-use` live policies when several AI contexts
   share a constrained device.
5. **Verification loop.** After wiring: compile the project → walk the state
   machine in the simulator (drive properties manually to preview each UI
   state) → deploy to a real device for latency and audio checks — mic,
   speaker, and true model speed exist only there. The built-in `bricks-cli`
   skill covers deployment and on-device inspection.
6. **Announce failure states.** Wire the error events of every generator to a
   visible-but-graceful state (retry, fallback content) and log them — silent
   AI failures on a kiosk look like a frozen app.

## When Not To Use

- Choosing generators or models — `ai-generators` / `ai-model-selection`.
- Importing the documents that feed RAG — the `document-essentials` plugin's
  `pdf`/`xlsx`/`pptx` skills handle file → content; this skill consumes their
  output.
- The CTOR editor's own chat — app settings.
