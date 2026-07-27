---
name: ai-generators
description: Use before adding any AI feature to a BRICKS app — chat, Q&A, voice interface, transcription, semantic search / RAG, or AI-generated media. Picks the right generator for the feature and target platform from the built-in catalog - local LLMs (llm/GGML, mlxLlm, neuropilotLlm, qnnLlm, onnxLlm, appleLlm), cloud LLMs (anthropicLlm, openaiLlm and compatible endpoints), speech-to-text (speechInference, realtimeTranscription, platformStt, appleStt, onnxStt), text-to-speech (ggmlTts, tts/ONNX, openaiTts, appleTts), vadInference, reranker, vectorStore, the assistant orchestrator, and the GenerativeMedia brick. Weighs offline requirements, privacy, latency, and per-device cost before wiring anything. Triggers on "add AI", "add a chatbot / voice assistant", "which generator should I use", "make it answer questions about…". Do NOT use for choosing the CTOR editor's own chat model (that is app settings, not the app being built).
license: MIT
metadata:
  version: 0.1.0
  author: BRICKS
---

# AI Generator Selection

Pick the right AI building blocks for the app being built, before wiring
anything. The full per-generator table lives in
[references/generator-matrix.md](references/generator-matrix.md) — read it when
you need exact platform support or generator properties.

**Announce at start:** "I'm using the ai-generators skill to pick the AI
components."

## Decision procedure

1. **Name the feature**, not the tech: "answers questions about the menu",
   "transcribes speech live", "generates ambient visuals".
2. **List the target devices** (ask if unknown — this decides everything):
   phone/tablet, Android signage box, Apple TV, desktop, or web preview.
3. **Apply the offline rule.** BRICKS apps are expected to keep working
   offline. If the feature must work offline → local generators only. Cloud
   generators (anthropicLlm / openaiLlm / openaiTts / GenerativeMedia) need a
   degrade path: cached content, default media, or a hidden feature state.
4. **Pick per feature** (details in the matrix):
   - **Text generation / chat** → `llm` (GGML, most platforms) as default
     local choice; `mlxLlm` (iOS/tvOS 17+, also vision-language);
     `neuropilotLlm` (MediaTek Genio) / `qnnLlm` (Qualcomm) when the device
     has that silicon; `appleLlm` on iOS/tvOS 26+ (zero model download);
     `onnxLlm` for transformers.js ONNX models; `anthropicLlm` / `openaiLlm`
     for cloud or LAN-hosted OpenAI-compatible servers (ollama, llama.cpp
     server).
   - **Speech-to-text** → `speechInference` (Whisper GGML) for utterances;
     `realtimeTranscription` for continuous live captions (bundles VAD);
     `platformStt` / `appleStt` when native platform recognition is enough
     and its platform limits are acceptable.
   - **Text-to-speech** → `tts` (ONNX — the only local TTS that also works
     on web) or `ggmlTts` (native GGML); `appleTts` for zero-setup Apple
     voices; `openaiTts` cloud.
   - **Wake/turn detection** → `vadInference`.
   - **Semantic search / RAG** → `vectorStore` (+ `reranker` for quality).
   - **AI images/video on screen** → the `GenerativeMedia` brick (cloud
     providers; always configure the offline fallbacks).
5. **One assistant vs hand-wiring:** if the feature is a conversational agent
   (voice or chat) that may also need tools or file search, prefer the single
   `assistant` generator — it orchestrates LLM + STT + TTS + MCP tools + file
   search with auto-summary, and its live policies release contexts when idle.
   Hand-wire individual generators when you need a custom pipeline shape
   (e.g. captions only, or search without chat).
6. **State the choice** to the user in one short block: feature → generator(s)
   → why (platform + offline + quality), then continue with
   `ai-model-selection` for the actual model and `ai-recipes` for wiring.

## Cloud vs local — the four questions

| Question | Points to local | Points to cloud |
|---|---|---|
| Must it work offline? | yes → local, hard requirement | no |
| Is the content sensitive (customers, cameras, mics)? | yes → on-device | no |
| Fleet size × usage cost? | many devices, constant use → local is free at runtime | few devices, bursty |
| Quality bar? | small models suffice (menus, FAQs, captions) | needs frontier quality |

A LAN-hosted OpenAI-compatible server (ollama / llama.cpp server via
`openaiLlm` with a custom base URL) is the middle path: local-network privacy
and no per-token cost, with bigger models than the device could run.

**Buttress (BRICKS remote inference)** is the other middle path: the `llm`
(GGML), `mlxLlm`, and `speechInference` generators can offload transparently
to a workspace-bound GPU server on the LAN — same generator, same events, and
a `use-local` fallback that keeps the offline story intact when the server is
unreachable. Prefer it over the `openaiLlm` route when the app should keep its
on-device pipeline shape. Setup (server install, workspace binding, the
`buttressConnectionSettings` property) is covered by the built-in `bricks-ctor`
skill's `references/buttress.md` — read that before wiring Buttress.

## Hard platform limits to check early

- `llm` (GGML) wants **>8 GB device RAM** — most signage boxes fail this;
  use small models on NPU paths (`neuropilotLlm`/`qnnLlm`), `onnxLlm`,
  Buttress offload, or a LAN server instead.
- **TTS (GGML) does not work on web** (no vocoder) — use `tts` (ONNX) there.
- **Web preview runs single-threaded** — treat it as a functional check, not
  a performance test.
- tvOS: `appleStt` is unavailable; Scene3D is experimental; check the matrix
  row before promising a feature.

## When Not To Use

- Choosing or configuring the CTOR editor's own chat model — that's app
  settings, not the app being built.
- The model/hardware sizing question ("which GGUF fits this box") — use
  `ai-model-selection`.
- The wiring itself (events, state, verification) — use `ai-recipes`.
