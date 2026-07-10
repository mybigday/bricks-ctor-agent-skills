# Recipe: Live Captions

Realtime transcription rendered on screen — events, reception desks,
accessibility displays.

## Components

- `realtimeTranscription` generator — the pipeline:
  - STT slot → `speechInference` (Whisper GGML; `base` default, `small` for
    accuracy on stronger devices; multilingual variant for mixed languages)
  - VAD slot → `vadInference` generator, VAD enabled
  - Audio input device ID (Web/Desktop: from device enumeration — expose a
    picker when several mics exist)
- Text/RichText brick for the transcript display.

## Tuning knobs (the actual UX)

| Property | Effect | Starting point |
|---|---|---|
| Audio slice duration | lower = faster updates, choppier text | 3–5 s |
| Min audio duration to start | filters coughs/noise | ~1 s |
| Transcribe processing interval | CPU budget vs freshness | default, then tune on device |
| Max slices kept in memory | history vs RAM | small for caption-style |

Latency and stability trade against each other — tune on the target device,
not in the web preview (single-threaded there).

## State & display

Properties: `caption_current` (live, mutable line) and `caption_history`
(committed lines). Display pattern: current line emphasized at the bottom,
history scrolling above, fade out lines older than ~30 s. Handle the
empty/silence state with a subtle "listening" indicator, not a frozen last
sentence.

## Offline behavior

Fully offline once Whisper + VAD models are on the device. First launch
downloads models — show a preparing state. No degrade path needed beyond a
mic-permission error state.

## Verify

- Real room test: distance to mic, cross-talk, background music — adjust VAD
  threshold and slice duration there, on the device.
- Language switch test if multilingual.
- Long-run test (30+ min): memory stays flat (slice cap works), text area
  doesn't overflow its layout.
