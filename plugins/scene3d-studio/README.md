# Scene3D Studio

A full 3D pipeline for BRICKS screens: create assets in Blender, export
BRICKS-safe glTF, compose and script the Scene3D brick, deploy. Three skills,
each opt-in:

- **`blender-pipeline`** — drive the local Blender install headlessly with bundled script
  templates: build procedural scenes, convert FBX/OBJ/USD/.blend to glTF, inspect models
  (tri counts, textures, animations), optimize for device budgets, and render quick previews.
- **`scene3d-authoring`** — upload assets to the project media box and compose the Scene3D brick:
  objects, node overrides, lights, camera and controls, HDR environments, tone mapping, post-FX,
  and glTF animation clips.
- **`scene3d-interactions`** — make scenes live: per-frame scripts, keyboard/pointer input,
  raycast picking wired to app events, and kinematic mini-game patterns (there is no physics
  engine).

Try prompts like:

- "Make a rotating 3D product showcase from `product.fbx`"
- "Build a simple 3D attract loop for the lobby screen"
- "Let visitors click parts of the model to see details"

## Requirements

- [Blender](https://www.blender.org/) 3.6+ installed locally (`blender-pipeline`). The headless
  scripts work with a stock install — no addons needed.
- **Optional** live Blender MCP server (`uvx blender-mcp==1.6.4`, disabled unless you approve the
  exact command at install): needs [uv](https://docs.astral.sh/uv/) plus the
  [BlenderMCP addon](https://github.com/ahujasid/blender-mcp) enabled inside Blender, with its
  socket server started. The skills work fully without it — it only adds live, iterative editing
  in a running Blender session.

## Platform notes

- Scene3D runs on iOS, Android, Desktop, and Web; **tvOS support is experimental**.
- The Scene3D loader reads glTF/GLB, USD/USDZ, and HDR/EXR environments — but **no Draco, KTX2,
  or meshopt compression**. The bundled export scripts already produce compliant files.
