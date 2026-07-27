# AI Features Toolkit

What the agent should know before adding AI to a BRICKS app. Three skills, each opt-in:

- **`ai-generators`** — the decision guide: which of the ~20 built-in AI generators fits the
  feature and the target platform (local llama.cpp / MLX / NeuroPilot / Qualcomm QNN / ONNX /
  Apple Intelligence, cloud Anthropic/OpenAI-compatible, Whisper STT, TTS, VAD, reranker,
  vectorStore, the assistant orchestrator, and the GenerativeMedia brick).
- **`ai-model-selection`** — model and hardware sizing: which GGUF, which quantization, RAM
  budgets, per-platform acceleration (Metal / OpenCL / Hexagon NPU / Vulkan / CUDA / WebGPU), and
  when a cloud model is the better call.
- **`ai-recipes`** — end-to-end wiring patterns: voice kiosk, document Q&A with the vector store,
  realtime captions, and generative-media signage — each with offline behavior spelled out.

Try prompts like:

- "Add a voice assistant to this kiosk that works offline"
- "Which model can this Android box actually run?"
- "Make the app answer questions from our product manual"

## Notes

- These skills guide the AI features **inside the app being built** — not the CTOR editor's own
  chat model (that's app settings).
- Offline-first: BRICKS launchers must keep working without network, so every recipe states what
  happens offline.
- Weak devices aren't a dead end: the GGML/MLX LLM and Whisper STT generators can offload to a
  workspace-bound **Buttress** GPU server on the LAN. The skills point at the built-in
  `bricks-ctor` skill's `references/buttress.md` for server setup and connection settings.
