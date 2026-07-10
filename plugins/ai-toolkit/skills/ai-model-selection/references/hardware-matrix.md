# Hardware & Acceleration Matrix

Distilled from the platform feature-support table and the `llm` generator's
hardware notes. "Accel Variant" is the generator property that selects the
desktop backend.

## LLM (GGML / llama.cpp)

Hard requirement: **device RAM > 8 GB** for the `llm` generator.

| Platform | Acceleration | Notes |
|---|---|---|
| iOS / tvOS | Metal (+ CPU) | Recommended M1+ / A17+ class chips for GPU accel |
| Android | CPU; OpenCL **only Adreno 700+**; Hexagon NPU **Snapdragon 8 Gen 1+** | Android 13+ recommended; other GPUs unsupported → CPU |
| Linux x86_64 | Vulkan or CUDA (Accel Variant) | Hexagon NPU on Qualcomm Dragonwing IQ9+ |
| Linux arm64 | CUDA (or CPU) | |
| macOS arm64 | Metal | M1+ recommended |
| macOS x86_64 | **CPU only** | Plan sizes accordingly |
| Windows x86_64 / arm64 | Vulkan or CUDA (Accel Variant) | |
| Web | CPU (WASM), WebGPU | **Single-threaded in current web preview** — functional testing only |

## STT (Whisper GGML)

| Platform | Acceleration |
|---|---|
| iOS / tvOS | CPU, Metal, **CoreML** |
| Android | CPU only |
| Desktop | CPU, Vulkan/CUDA (Linux/Windows), Metal (macOS arm64) |
| Web | CPU, WebGPU |

## TTS

| Runtime | Platforms | Acceleration highlights |
|---|---|---|
| GGML (`ggmlTts`) | native + desktop, **no web** (no vocoder) | Metal / OpenCL (Adreno 700+) / Vulkan / CUDA |
| ONNX (`tts`) | everywhere incl. web | CoreML (Apple), QNN + NNAPI (Android), DirectML/DNNL (Windows), WebGPU/WASM (web) |

## VAD (GGML)

Desktop/native accelerated like STT; **web preview: WASM CPU only**.

## Vector store

Embedding sources `ggml` and `openai` available on all platforms except
Windows arm64 (`ggml` not yet there). SQLite persistence exists everywhere,
but web runs it **in-memory only** — persist embeddings server-side or rebuild
on load for web targets.

## Reranker (GGML)

Same acceleration pattern as LLM; same RAM caution.

## Quick RAM ladder (rule of thumb)

| Device RAM | On-device LLM budget |
|---|---|
| < 4 GB | none (NPU vendor bundles / tiny ONNX / LAN server) |
| 4–8 GB | 0.5B–2B @ Q4 (prefer NPU generators on supported silicon) |
| 8–12 GB | 1B–4B @ Q4–Q5 comfortable (the `llm` generator's supported floor is >8 GB) |
| 16 GB+ / dGPU | 7–8B @ Q4–Q6 |

KV-cache reminder: memory grows with context length — halve the context before
shrinking the model.
