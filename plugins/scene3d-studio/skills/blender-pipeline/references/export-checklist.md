# BRICKS glTF Export Checklist

The Scene3D brick loads glTF/GLB (plus USD/USDZ) with three.js loaders that
have **no Draco, KTX2, or meshopt support**. The bundled scripts export
compliant files; use this checklist when exporting manually from Blender's UI
(File → Export → glTF 2.0) or validating third-party assets.

## Must

- [ ] Format **glTF Binary (.glb)**, textures embedded.
- [ ] **Compression OFF** — do not tick Draco; no KTX2 texture pipeline.
- [ ] Transforms applied (rotation/scale) — unapplied scale breaks node
      overrides and normalization downstream.
- [ ] +Y up (Blender's glTF exporter default — don't override it).
- [ ] Reasonable origin: model centered at/above the origin, resting on Y=0
      when it should sit on the ground plane.
- [ ] Size: ~1–2 units max dimension for product-viewer scenes (default camera
      (3,3,5) → origin, fov 50). Environments can be larger by design.

## Should

- [ ] Textures ≤ 2048×2048 (signage GPUs; 1024 often enough), power-of-two.
- [ ] PBR metallic/roughness materials (what Scene3D renders); bake procedural
      Blender shader graphs to textures — node-graph tricks don't survive glTF.
- [ ] **Name things**: object/node names become the `nodes[]` override targets
      (`{ name, color, metalness, roughness, opacity, … }`), and animation
      clip names are what `playAnimation` takes. `Cube.003` helps nobody.
- [ ] One material per logical part; merge meshes that always move together
      (`optimize_model.py --join`).
- [ ] Animations: NLA tracks/actions become named clips; keep clips separated
      (e.g. `Idle`, `Open`, `Spin`) rather than one long timeline.

## Budgets (starting points — measure on the real device)

| Target | Scene triangle budget | Texture budget |
|---|---|---|
| Android signage box | ≤ 100k tris | ≤ 1024², few textures |
| Phone / tablet / Apple TV | ≤ 300k tris | ≤ 2048² |
| Desktop | ≤ 1M tris | 2048²+ |
| Web preview | keep to box-class budgets | single-threaded — worst case |

Post-FX (bloom/SSAO) and shadows cost more than geometry on weak GPUs — if a
scene struggles, disable SSAO and shadows before cutting the model.

## Formats

- Prefer `.glb` everywhere. `usdz`/`usd` load too (handy for iOS-sourced
  assets) but glb is the tested cross-platform path.
- Environment backgrounds are separate: equirectangular `.hdr`/`.exr` set on
  the brick's `backgroundImage` — not baked into the model file.
