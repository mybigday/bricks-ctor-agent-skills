# Starter Model Catalog

Known-good starting points, by device class. Any GGUF works with the `llm`
generator — these are the ones proven in BRICKS bundles and deployments.
Always verify the concrete file with `huggingface_search` / `huggingface_select`
(architecture, context_length, file size) before wiring it in.

## Speech-to-text (all device classes)

| Model | Use |
|---|---|
| `BricksDisplay/whisper-ggml` — `base` | Kiosk default: good accuracy/latency balance |
| … `small` | Accuracy-sensitive, stronger devices |
| … `tiny` | Lowest latency, wake-phrase-grade accuracy |

Pick multilingual variants for mixed zh/ja/en environments; language-locked
variants are faster and more accurate when the language is known.

## LLM by device class

| Device class | Size class | Proven examples |
|---|---|---|
| Constrained Android box / MediaTek Genio (NPU path) | 0.5B–2B | Qwen 2.5 0.5B / 1.5B, Gemma 2 2B — NeuroPilot bundle presets (Genio 720: 0.5B measured ≈700 tok/s prefill / ≈45 tok/s generation) |
| Phones / Apple TV (A17+/M1+, Metal or MLX) | 1B–3B @ Q4 | Qwen 2.5 1.5B/3B class, Gemma 2 2B class (GGUF via `llm`, or MLX builds via `mlxLlm`) |
| Desktop / >8 GB RAM devices | 3B–8B @ Q4–Q5 | Llama 3 8B class (upper bound of the NeuroPilot bundle tiers; comfortable on desktop GPUs) |
| Web preview | smallest only | Functional checks; single-threaded — never judge speed here |
| LAN server (`openaiLlm` → ollama / llama.cpp server) | anything the server fits | Middle path: bigger models, local-network privacy, no per-token cost |

## Quantization ladder

`Q4_K_M` default → `Q5_K_M`/`Q6_K` when RAM is plentiful and quality matters →
`Q8_0`/F16 desktop-only. Downwards, prefer a smaller model at Q4 over the same
model at Q3.

## Embeddings (vectorStore)

Small embedding GGUFs suffice for menus/FAQ/product data. Rules that matter
more than the model choice: chunk size **below** the embedding context, and
tokenizer model = your LLM's GGUF (loads vocab-only, saves a download).

## Task-fit reminders

- Menus, FAQs, product finders: 0.5B–2B with a tight system prompt does the
  job — bigger models mostly add latency here.
- Open-ended conversation, multilingual nuance, tool use: 3B+; consider the
  `assistant` generator's auto-summary to survive small contexts.
- Vision (describe what the camera sees): `mlxLlm` VLM models on Apple
  hardware; otherwise cloud.
