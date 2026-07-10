---
name: scene3d-authoring
description: Use when adding or editing a 3D scene in a BRICKS app with the Scene3D brick — product viewers, showcases, menus with 3D flair, ambient scenes. Covers uploading .glb/.gltf/.usdz assets to the project media box (md5-addressed, preloaded for offline), declaring objects with transforms and per-node material overrides, lights (directional/point/spot/hemisphere), camera and orbit/pan-zoom controls, HDR/EXR environment backgrounds, tone mapping, bloom/FXAA/SSAO post-effects, and playing glTF animation clips. Ends with verifying in the simulator and deploying to devices (tvOS support is experimental). Triggers on "add a 3D scene", "show this model in the app", "3D product viewer", "set up lighting / camera / background". For creating the 3D assets themselves use blender-pipeline; for behavior, input, and games use scene3d-interactions.
license: MIT
metadata:
  version: 0.1.0
  author: BRICKS
---

# Scene3D Authoring

Compose the Scene3D brick: assets in, objects/lights/camera/effects declared,
verified in the simulator. The exact property shapes live in
[references/scene3d-properties.md](references/scene3d-properties.md).

**Announce at start:** "I'm using the scene3d-authoring skill to build the 3D
scene."

## Step 1: Get assets into the project

- Model files (`.glb` preferred; `.gltf`/`.usd`/`.usdz` also load): upload
  with `media_upload_files` (if the media tools are unavailable, ask the user
  to upload via the Controller UI). Keep the returned **url and md5**.
- Environment backgrounds: equirectangular `.hdr`/`.exr` (or LDR image),
  uploaded the same way.
- **md5 is not optional.** Every `objects[]` entry with a `url` needs its
  `md5` — it keys the asset cache and lets Preload rewrite remote URLs to
  local files so scenes work offline. A missing md5 = a scene that breaks on
  disconnected devices.
- Primitives (`box`, `sphere`, `plane`, `cylinder`, `cone`, `torus`, `text`)
  need no asset at all — reach for them before Blender when a simple shape
  does the job.

## Step 2: Declare the scene

Edit the brick's properties via the project editing tools (`edit_entry` /
`edit_canvas_items`). Give every object a **stable, meaningful `id`** — ids
are how scripts, actions, and events refer to objects later.

Composition order that works:

1. **Objects** — `{ id, type, url, md5, position, rotation, scale }`. One
   hero object at the origin for viewers; use `nodes[]` overrides to retint
   or hide named parts inside a loaded model (names come from
   `blender-pipeline`'s inspect output).
2. **Lighting** — start from a look preset (reference doc): viewer =
   hemisphere ambient + one directional key with shadows; ambient scene =
   HDR environment doing the lighting (`backgroundImage` + env intensity)
   with lights minimal.
3. **Camera + controls** — perspective, default position `(3,3,5)` target
   origin frames a ~1–2-unit model. Product viewer: `controls: 'orbit'`,
   damping on, min/max distance clamped, `autoRotate` for attract.
   Non-interactive signage: `controls: 'none'`.
4. **Renderer + post-FX** — defaults (`toneMapping: 'aces'`, exposure 1) are
   good. Add `bloom` only with emissive content (keep `bloomThreshold ≥ 1`
   so only highlights glow); `ssao` and `shadows` are the expensive toggles —
   budget them per device class.
5. **Animations** — glTF clips play by clip name (from the inspect output):
   set an object's `animation` property for autoplay, or trigger the
   play/stop animation actions at runtime (loop, speed).

## Step 3: Verify

1. Compile the project (`compile`), fix schema errors.
2. Simulator: check load events fire (wire `BRICK_SCENE_3D_ON_LOAD_ERROR` to
   a visible fallback during development — a missing asset otherwise renders
   as nothing), framing at the app's real aspect ratio, and materials under
   your lighting (metals go black without an environment or enough light —
   add `backgroundImage` or a hemisphere light).
3. Watch performance while previewing: if it stutters, disable SSAO/shadows
   first, then reduce texture/poly budgets (`blender-pipeline` optimize).

## Step 4: Deploy

Deploy through the normal project flow (the built-in `bricks-cli` skill
covers deploy and on-device inspection). Assets preload for offline use via
their md5s — first boot after deploy needs network to fill the cache.
**tvOS is experimental** for Scene3D: verify on the actual device before
promising it.

## When Not To Use

- Creating/converting/optimizing the 3D asset files — `blender-pipeline`.
- Runtime behavior: input, per-frame motion, picking, game logic —
  `scene3d-interactions`.
- Flat 2D content that doesn't need a 3D renderer — regular bricks are
  cheaper on every device.
