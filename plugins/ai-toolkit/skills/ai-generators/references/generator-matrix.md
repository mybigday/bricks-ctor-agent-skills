# AI Generator Matrix

Per-generator reference distilled from the generator definitions
(`bricks-core/src/generators/*/def.js`) and the platform feature-support table.
Verify against the generator's property panel when wiring — properties evolve.

## Text generation (LLM)

| Generator | Runs | Platforms / requirements | Notes |
|---|---|---|---|
| `llm` | local, GGML/llama.cpp, any GGUF | iOS/tvOS (Metal, M1+/A17+ recommended), Android 13+ (CPU; OpenCL only on Adreno 700+; Hexagon NPU on Snapdragon 8 Gen 1+), Linux/Windows (choose `vulkan` or `cuda` in Accel Variant; Hexagon NPU on Dragonwing IQ9+ Linux), macOS (Metal on arm64, CPU-only on x86_64), Web (CPU/WebGPU, single-thread preview) | **Device RAM must exceed 8 GB.** The default local choice when hardware allows; Buttress-offloadable |
| `mlxLlm` | local, Apple MLX | iOS/tvOS 17+ (Apple Silicon-optimized) | Supports **LLM and VLM** (vision); models from HuggingFace Hub; Buttress-offloadable |
| `neuropilotLlm` | local, MediaTek NeuroPilot SDK | Android on MediaTek Genio (e.g. 720/520) | Preloadable model-bundle presets; NPU-accelerated small models |
| `qnnLlm` | local, Qualcomm AI Engine (QNN) | Android on Qualcomm silicon | Optional load-on-init; NPU-accelerated |
| `onnxLlm` | local, transformers.js/ONNX Runtime | All platforms incl. web (coreml/qnn/nnapi/dnnl/dml/xnnpack/webgpu/cpu per platform) | Any converted model on HuggingFace; good below the 8 GB GGML floor |
| `appleLlm` | local, Apple Intelligence | iOS/tvOS 26+ | No model download; capability follows the OS |
| `anthropicLlm` | cloud | any | Anthropic-compatible API endpoints |
| `openaiLlm` | cloud or LAN | any | OpenAI-compatible endpoints — includes self-hosted ollama / llama.cpp server on the local network |

**Buttress-offloadable** = the generator can delegate inference transparently
to a workspace-bound Buttress GPU server on the LAN via its
`buttressConnectionSettings` property (`use-local` fallback keeps offline
behavior). Server install, workspace binding, and the property reference live
in the built-in `bricks-ctor` skill's `references/buttress.md`.

## Speech-to-text

| Generator | Runs | Platforms | Notes |
|---|---|---|---|
| `speechInference` | local, Whisper GGML (whisper.cpp) | iOS/tvOS (Metal + CoreML), Android (CPU), Desktop (Vulkan/CUDA/Metal), Web (CPU/WebGPU) | Default STT; models from `huggingface.co/BricksDisplay/whisper-ggml`; iOS GPU accel recommends M1+/A17+; Buttress-offloadable |
| `realtimeTranscription` | local pipeline | wherever its STT + VAD generators run | Continuous live transcription: references an STT (GGML) generator + a VAD generator; tune slice duration / min duration / process intervals |
| `platformStt` | native platform recognition | per platform | Zero-download, locale property; platform accuracy/limits apply |
| `appleStt` | native Apple recognition | iOS 26+, macOS 26+ — **not tvOS** | Newer Apple recognition stack |
| `onnxStt` | local, transformers.js/ONNX | all incl. web | Any converted HF model |

## Text-to-speech

| Generator | Runs | Platforms | Notes |
|---|---|---|---|
| `tts` (ONNX) | local | all **including web** (webgpu/wasm) | The portable local TTS choice |
| `ggmlTts` | local, llama.cpp-based | native + desktop, **no web** (no vocoder) | HF GGUF TTS models |
| `appleTts` | native Apple synthesis | Apple platforms | Zero setup, system voices |
| `openaiTts` | cloud | any | API key + endpoint properties |

## Detection, search, orchestration

| Generator | What it does | Notes |
|---|---|---|
| `vadInference` | Voice-activity detection (whisper.cpp) | Web preview: WASM CPU. Pair with STT for push-free voice UX |
| `traditionalVad` | Non-ML VAD | Cheapest wake gate |
| `reranker` | Local rerank (llama.cpp) | Quality boost on vectorStore results; RAM note like `llm` |
| `vectorStore` | Vector DB for semantic search / RAG | Embedding source `ggml` (on-device GGUF) **or** OpenAI-compatible API (OpenAI/ollama/llama.cpp server). Commands: load/release/reset, **insert file (Office/OpenOffice/PDF)**, insert text, remove file, search, cancel download. Set chunk size below the embedding model's context; tokenizer model can reuse the LLM's GGUF (loads vocab-only) |
| `assistant` | Conversational agent orchestrating LLM + STT + TTS + MCP tools + file search (RAG) with auto-summary | LLM slot accepts GGML/MLX/OpenAI/QNN/ONNX/Anthropic/NeuroPilot generators. Live policies (`only-in-use`) release LLM/STT/TTS/file-search contexts when idle — important on low-RAM devices. Auto-summary (context compaction) currently GGML-only. File search: citation count + score threshold. MCP generators plug in as tools; guardrail hooks available. Events: generating/finished/messages-update/heatup/log/error |
| `dataBank` | Subscribe to shared Data Bank properties | The live-update data path (not AI, often paired) |

## On-screen AI media

| Brick | What it does | Notes |
|---|---|---|
| `GenerativeMedia` | Generates images/videos from a text prompt | Providers: `openai`, `freepik-classic`, `deepai`, `gemini` (API key property). **Cloud-only** → always set: cache enabled, a default image (+ hash), and loading/error Lottie animations so offline devices degrade gracefully |

## Heat-up and lifecycle

Local model generators expose init/heat-up options and (via `assistant`) live
policies. For kiosks: heat up on app start when RAM allows (first response
latency matters more than boot time); use `only-in-use` policies when several
AI features share a low-RAM device.
