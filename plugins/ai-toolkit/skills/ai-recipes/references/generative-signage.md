# Recipe: Generative Signage

AI-generated ambient visuals: seasonal backgrounds, daily hero images,
mood-matched screens.

## Components

- `GenerativeMedia` brick — prompt → image/video on screen:
  - Provider: `openai`, `freepik-classic`, `deepai`, or `gemini` (+ API key
    property)
  - Media type: image or video
  - **Cache: enabled** (non-negotiable for signage)
  - **Default image + hash: always set** — the offline/failure face of the
    feature
  - Loading Lottie + error Lottie: subtle, brand-neutral animations
- A data calculation (or scheduled event) that rotates the prompt.

## Prompt rotation pattern

Store `media_prompt` in the Property Bank. A data calculation composes it from
structured parts — base scene + time-of-day + season/campaign — rather than
free text, e.g. parts kept as Data entries so the operator can edit them
without redeploy (pair with the Data Bank for fleet-wide updates). Trigger
regeneration on a schedule (e.g. daily at open) — not per minute; generation
costs money and the cache exists for a reason.

## This feature is cloud-only — design for absence

- Offline/quota-exhausted/moderation-blocked all land on: cached last image →
  default image. Verify that chain by testing with network off.
- **Public-screen caution:** generated content is probabilistic. For
  unattended screens, prefer a reviewed rotation: generate N candidates into
  the media box during design/ops time, human-approve, and let the app rotate
  approved assets — reserve live generation for supervised or low-risk
  contexts.

## Verify

- Pull the network cable: default image appears, no error card, no spinner
  loop.
- Regeneration trigger fires on schedule exactly once (log it).
- Aspect ratio: request media at the screen's ratio; check no letterboxing on
  the target device.
- Cost sanity: prompts/day × devices — say the number to the user.
