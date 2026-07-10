---
name: blender-pipeline
description: Use when the user wants to create or modify 3D assets for a BRICKS app using Blender — product models, mascots, environments, 3D logos, exhibition pieces — or to convert existing models (FBX/OBJ/USD/.blend) into BRICKS-ready glTF. Drives the local Blender install headlessly (blender -b -P script.py) with bundled script templates for procedural scenes, format conversion, model inspection, optimization, and preview renders; optionally uses the Blender MCP server for live iterative modeling. Encodes BRICKS-safe export settings - .glb with embedded textures, NO Draco/KTX2/meshopt compression (the Scene3D loader does not support them), applied transforms, sane scale, and per-device polygon/texture budgets. Triggers on "make a 3D model", "create it in Blender", "convert this FBX", "optimize this model for devices". Requires Blender installed on this machine. Do NOT use for composing the in-app scene, lighting, or camera (use scene3d-authoring) or for scene behavior (use scene3d-interactions).
license: MIT
metadata:
  version: 0.1.0
  author: BRICKS
---

# Blender Pipeline

Create, convert, inspect, and optimize 3D assets with the user's local Blender,
producing BRICKS-safe `.glb` files for the Scene3D brick.

**Announce at start:** "I'm using the blender-pipeline skill to prepare the 3D
asset."

## Step 0: Locate Blender

Find the binary once and reuse the path (single commands only — no pipes or
chaining):

- macOS: `/Applications/Blender.app/Contents/MacOS/Blender`
- Linux: `blender` on PATH (or a `~/blender-*/blender` unpack)
- Windows: `C:\Program Files\Blender Foundation\Blender <ver>\blender.exe`

Verify with `<blender> --version` — the bundled scripts support Blender 3.6+.
If Blender is missing, stop and tell the user to install it (blender.org);
don't attempt package managers unprompted.

## Bundled scripts

Resolve paths against this skill directory. All run headless:
`<blender> -b -P <script.py> -- <args>`. Each prints a `===JSON===` line
followed by a machine-readable result.

| Script | Purpose | Typical call |
|---|---|---|
| `scripts/blender/inspect_model.py` | Stats before deciding anything: objects, triangles, materials, texture sizes, animation clips, node names, dimensions | `-- --in model.fbx` |
| `scripts/blender/import_export_glb.py` | Convert any supported format to BRICKS-safe GLB; optional transform apply + size normalize | `-- --in model.fbx --out out/model.glb --apply-transforms --max-dim 2` |
| `scripts/blender/new_scene.py` | Build a procedural scene (primitives + text + PBR materials) from a JSON spec | `-- --spec spec.json --out out/scene.glb` |
| `scripts/blender/optimize_model.py` | Decimate meshes, downscale textures, optionally join meshes; reports before/after | `-- --in in.glb --out out/opt.glb --ratio 0.5 --max-texture 2048` |
| `scripts/blender/preview_render.py` | Quick turntable-style still for the user to approve before uploading | `-- --in out/model.glb --out out/preview.png --size 800` |

## Workflow

1. **Inspect first** (`inspect_model.py`) whenever a file exists — decisions
   about optimization, node overrides, and animations all come from its
   output. Surface the JSON summary to the user (tris, textures, clips).
2. **Create or convert**:
   - New asset from description → write a spec JSON (documented at the top of
     `new_scene.py`) → `new_scene.py`. Keep it simple — primitives + good
     PBR materials + text go a long way for signage.
   - Existing asset → `import_export_glb.py` with `--apply-transforms` and,
     for product-viewer use, `--max-dim 2` (the Scene3D default camera sits
     at (3,3,5) looking at the origin, so a ~1–2 unit model frames well).
3. **Check the budget** (see
   [references/export-checklist.md](references/export-checklist.md) for the
   full checklist and per-device budgets). Over budget → `optimize_model.py`.
4. **Preview** (`preview_render.py`) and show the image to the user before
   uploading — a 10-second render saves a wrong-model round trip.
5. **Hand off** to `scene3d-authoring`: upload the `.glb`, wire it into the
   Scene3D brick. Pass along the inspect output — its `nodes` and `animations`
   lists are exactly what node overrides and `playAnimation` need.

## Export rules (already enforced by the scripts)

- `.glb` (single binary), textures embedded.
- **No Draco / KTX2 / meshopt** — the Scene3D loader cannot read them.
- Transforms applied; +Y up (exporter default); real-world-ish scale.
- Keep material count low; PBR metallic/roughness is what Scene3D renders.

## Live Blender MCP (optional)

If the plugin's `blender` MCP server is approved and running (Blender open,
BlenderMCP addon's socket server started), prefer it for **iterative** work —
"move the logo up a bit", material tweaks with visual feedback — then still
finish with the headless export script for a compliant `.glb`. When the MCP
server isn't available, everything above works without it; don't block on it.

## When Not To Use

- Composing the in-app scene (objects/lights/camera/effects) — `scene3d-authoring`.
- Scene behavior, input, animations at runtime — `scene3d-interactions`.
- 2D assets (icons, images) — the built-in imagegen skill or normal design flow.
- The user has no Blender and just needs a simple shape — Scene3D primitives
  (box/sphere/text…) need no asset at all; skip Blender entirely.
