---
name: ai-model-selection
description: Use when choosing or changing the actual model for an AI feature in a BRICKS app — which GGUF, which quantization, which size — and when checking whether target devices can run it. Encodes hardware sizing rules - RAM budgets (the llm/GGML generator requires devices with more than 8GB RAM), acceleration per platform (Metal on M1+/A17+, OpenCL on Adreno 700+, Hexagon NPU on Snapdragon 8 Gen 1+, Vulkan/CUDA on desktop, WebGPU on web), context-length vs memory trade-offs, and quantization ladders. Uses the huggingface_search / huggingface_select tools to inspect GGUF metadata before committing, and lists starter models proven in BRICKS bundles (BricksDisplay/whisper-ggml for STT; Qwen 2.5 0.5B/1.5B, Gemma 2 2B class for constrained devices). Also covers when a cloud model is the better call. Triggers on "which model", "will this run on the device", "the model is too slow / too big", "pick a GGUF". Do NOT use for choosing generators (use ai-generators) or for the CTOR editor's own chat model.
license: MIT
metadata:
  version: 0.1.0
  author: BRICKS
---

# Model & Hardware Selection

Size the model to the worst device it must run on. Hardware details live in
[references/hardware-matrix.md](references/hardware-matrix.md); starter models
in [references/model-catalog.md](references/model-catalog.md).

**Announce at start:** "I'm using the ai-model-selection skill to size the
model."

## Sizing procedure

1. **Pin the worst target device** (ask if unknown): exact SoC and RAM matter
   more than the platform name. "Android box" spans 2 GB junk to 16 GB Genio.
2. **Pick the size class** from the device (see the catalog):
   - < 4 GB RAM → no on-device LLM; NPU path with vendor bundles, tiny ONNX
     models, or a LAN/cloud endpoint. STT/VAD still fine (Whisper tiny/base).
   - 4–8 GB → 0.5B–2B class, Q4; prefer NPU generators on supported silicon.
   - > 8 GB (the `llm` generator's stated floor) → 1B–4B comfortable, up to
     7–8B on strong hardware.
   - Desktop with dGPU → 7B+ viable (CUDA/Vulkan/Metal).
3. **Pick quantization**: start `Q4_K_M` (the size/quality workhorse). Step up
   (Q5/Q6/Q8) only on desktop-class RAM; step down (Q3) only as a last resort
   before shrinking the parameter count — a smaller model at Q4 usually beats
   the same model at Q3.
4. **Budget memory**, rough rule: GGUF file size + ~1–2 GB runtime overhead +
   KV cache that grows with context length. When memory is tight, halving the
   context length is the cheapest lever — size the context to the feature
   (a menu Q&A rarely needs more than 4K).
5. **Verify before committing**: inspect the actual GGUF with
   `huggingface_search` / `huggingface_select` — they expose metadata
   (architecture, context_length, size) so you never guess from the repo name.
   Set the generator's model URL + hash from the selected file.
6. **Smoke test where it counts**: the web simulator proves wiring, not
   speed (single-threaded). Judge latency on the real device — deploy and
   check first-token time and tokens/sec with a realistic prompt.

## Degradation playbook (too slow / too big)

In order, cheapest first:

1. Shorter context; trim the system prompt and few-shot examples.
2. Confirm acceleration is actually on (Accel Variant on desktop; Metal /
   OpenCL / NPU support per the hardware matrix — a silent CPU fallback is
   the #1 cause of "it's so slow").
3. Smaller quant (Q4 → Q3) — quality check afterwards.
4. Smaller model (1.5B → 0.5B) — usually better than deep quant cuts.
5. Move inference off-device: LAN llama.cpp/ollama server via `openaiLlm`.
6. Cloud model — accept the offline consequence explicitly with the user.

## STT / TTS / embedding models

- **Whisper (STT)**: models from `BricksDisplay/whisper-ggml`. `base` is the
  kiosk workhorse; `small` when accuracy matters and the device can afford it;
  `tiny` for wake-word-ish latency. Multilingual variants for zh/ja/en mixed
  environments.
- **TTS**: pick by platform first (ONNX `tts` is the only local web option),
  voice second. Test the actual language/voice — quality varies far more than
  size.
- **Embeddings (vectorStore)**: small embedding GGUFs are enough for menus,
  FAQs, and product data; set chunk size below the embedding model's context
  and reuse the LLM's GGUF as the tokenizer model (vocab-only load).

## When cloud wins

Choose `anthropicLlm` / `openaiLlm` (or keep `GenerativeMedia`, which is
cloud-only) when the quality bar exceeds small-model capability AND the
feature can degrade offline (cached responses, hidden entry point, default
media). Say the trade-off out loud to the user; offline-first is the platform
default, not an afterthought.

## When Not To Use

- Picking which generator/feature architecture to use — `ai-generators`.
- Wiring and verification of the finished feature — `ai-recipes`.
- The CTOR editor's own chat model — app settings.
