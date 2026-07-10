# Recipe: Voice Kiosk

A kiosk the user talks to: ask about products, get spoken answers.

## Variant A (default): one `assistant` generator

The `assistant` generator orchestrates the whole pipeline — LLM + STT + TTS +
optional MCP tools + optional file search (RAG) — with auto-summary when the
context fills up.

**Components**

- `assistant` generator, configured with:
  - LLM slot → the chosen LLM generator (GGML/MLX/QNN/ONNX/Anthropic/OpenAI/
    NeuroPilot all accepted)
  - STT slot → a `speechInference` (Whisper GGML) generator
  - TTS slot → a `tts` (ONNX) or `openaiTts` generator
  - File search → a `vectorStore` generator (see the doc-qa recipe) when it
    should answer from documents; set citation count (default 3) and score
    threshold
  - Live policies → `only-in-use` on low-RAM devices; heat-up on init when
    RAM allows (first-response latency beats boot time on kiosks)
- `vadInference` generator when you want hands-free turn taking (otherwise a
  push-to-talk Touchable).

**State (Property Bank)**

`voice_state`: `idle | listening | thinking | speaking`, plus `last_user_text`,
`last_reply_text`. Drive mic animation, waveform, and reply display from these
only.

**Wiring**

1. Touch/VAD start → set `voice_state=listening`, start assistant audio input.
2. Assistant "generating" event → `thinking`; messages-update event → stream
   `last_reply_text`.
3. Assistant "finished" event → `speaking` while TTS plays, then `idle`.
4. Assistant error event → visible-but-graceful retry state; log it.

## Variant B: hand-wired pipeline

Use when the flow is not a conversation (single-shot commands, custom routing):
`vadInference` → `speechInference` transcript → data calculation builds the
prompt → LLM generator → response property → `tts` speaks. Same state machine.

## Offline behavior

All-local variant works fully offline after models are on the device. First
launch downloads models — show a "preparing" state until heat-up finishes
(assistant exposes a heatup-finished event). Cloud LLM variant: define the
offline path explicitly (hide the mic button and show static FAQ content when
unreachable).

## Verify

- Simulator: drive `voice_state` manually through all four states — check
  every UI state exists and no layout jumps.
- Device: real mic + speaker test; measure first-token latency with a
  realistic question; barge-in behavior (talking while it speaks) — decide
  interrupt vs ignore and wire it deliberately.
- Noisy-environment test if the kiosk is public: VAD threshold tuning matters
  more than model choice.
