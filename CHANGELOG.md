# Changelog

## Unreleased

- **app-templates 0.1.0** — new plugin with the `template-creator` skill, moved out of
  the CTOR desktop bundle so it can ship and update independently. CTOR builds that still
  bundle the skill skip the plugin copy at install time.

## 0.1.0 — 2026-07-27

Initial release of the official CTOR plugin marketplace.

- **document-essentials 0.1.0** — `pdf`, `docx`, `xlsx`, `pptx` skills with
  self-contained parse scripts (zero-dependency Word/spreadsheet/deck extraction;
  officeparser-based PDF text extraction).
- **ai-toolkit 0.1.0** — `ai-generators`, `ai-model-selection`, `ai-recipes`
  skills with generator/hardware matrices (including Buttress remote-inference
  offload guidance) and end-to-end feature recipes.
- **scene3d-studio 0.1.0** — `blender-pipeline`, `scene3d-authoring`,
  `scene3d-interactions` skills, headless Blender script templates, and an
  optional version-pinned Blender MCP server.
