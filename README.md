# BRICKS CTOR Agent Skills

Official plugins for the [CTOR](https://bricks.tools) desktop agent, maintained by the BRICKS team.

**Built into CTOR starting with v2.25** — this marketplace ships with the app: it appears at the
bottom of the **Plugins** panel with a "Built-in" badge and refreshes automatically, so new plugins
and updates show up without re-adding anything. Open a plugin and pick the skills you want — every
skill is opt-in at install time.

On CTOR versions before v2.25, add it manually from
**Plugins → Add marketplace → `mybigday/bricks-ctor-agent-skills`**.

The repo ships both manifest flavors (`.bricks-plugin/` and `.claude-plugin/`), so it also works as
a [Claude Code plugin marketplace](https://code.claude.com/docs) for teams that use both tools:
`/plugin marketplace add mybigday/bricks-ctor-agent-skills`.

## Document Essentials

Bring your business files into your app. The agent parses **PDF menus and price lists**,
**Word documents**, **Excel/CSV sheets**, and **PowerPoint decks** on your machine, then imports
the content as Data entries, Property Bank values, slideshow media, or searchable knowledge for
RAG.

| Skill | What it does |
|---|---|
| `pdf` | Extract text from PDFs and route it into app content; wire runtime PDF ingestion |
| `docx` | Extract headings, lists, tables, and images from Word documents and import them as app data |
| `xlsx` | Parse spreadsheets (.xlsx/.csv/.tsv) into structured rows and import them as app data |
| `pptx` | Extract slide text, notes, and images; rebuild decks as signage slideshows |

All parse scripts run locally. The Word, spreadsheet, and deck parsers are self-contained (no
dependencies); the PDF parser runs the version-pinned `officeparser` CLI via bunx (cached
after first use).

## AI Features Toolkit

Everything the agent should know before adding AI to a BRICKS app. Pick the right generator
(local llama.cpp / MLX / NeuroPilot / Qualcomm QNN / ONNX / Apple Intelligence, or cloud
Anthropic/OpenAI-compatible) for the feature and the target device, size models against real
hardware limits (including Buttress LAN offload when devices are weak), and wire complete
patterns — with offline behavior spelled out for every recipe.

| Skill | What it does |
|---|---|
| `ai-generators` | Decision guide: which AI generator for which feature and platform |
| `ai-model-selection` | Model + hardware sizing: GGUF choice, quantization, RAM and acceleration |
| `ai-recipes` | End-to-end patterns: voice kiosk, document Q&A/RAG, live captions, generative media |

## Scene3D Studio

A full 3D content pipeline for screens. Create or adapt models with your local Blender install
(headless scripts included; optional live Blender MCP connection), export BRICKS-safe glTF, upload
assets to the project media box, compose the Scene3D brick, script interactions, and deploy.
Great for product showcases, exhibition demos, and attract loops. (tvOS: experimental.)

| Skill | What it does |
|---|---|
| `blender-pipeline` | Drive Blender headlessly to create, convert, inspect, and optimize models |
| `scene3d-authoring` | Upload assets and compose objects, lights, camera, environment, post-FX |
| `scene3d-interactions` | Per-frame scripts, input handling, raycast picking, mini-game patterns |

Requirements: [Blender](https://www.blender.org/) 3.6+ installed locally for `blender-pipeline`.
The optional Blender MCP server additionally needs [uv](https://docs.astral.sh/uv/) and the
[BlenderMCP addon](https://github.com/ahujasid/blender-mcp); it is version-pinned and stays
disabled unless you approve its exact command at install time.

## Compatibility & trust

- Built into CTOR desktop from v2.25; earlier versions with the plugin system can add it manually
  (see above).
- Skills run with your configured model; no extra accounts are required.
- Every script ships readable in this repo — nothing is downloaded at install time beyond the
  plugin content itself.
- MIT licensed. Issues and requests: https://github.com/mybigday/bricks-ctor-agent-skills/issues

## Development

```bash
# Validate all manifests, frontmatter, and dual-manifest sync
bun scripts/validate.mjs

# Try it in CTOR without publishing: Plugins → Add marketplace → Local folder → this repo
```

Authoring rules live in `scripts/validate.mjs` (name patterns, description length caps, reserved
skill names, `.bricks-plugin`/`.claude-plugin` parity). Bump the plugin `version` in **both**
manifest copies on any content change — updates are delivered on version bump.
