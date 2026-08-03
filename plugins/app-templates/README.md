# App Templates

Capture what an app *is* so you can build it again. One skill, opt-in:

- **`template-creator`** — reads an existing BRICKS project (layout, colors, typography, state
  shape, data flow, edge cases) and distills it into a numbered list of 5-10 plain-language
  requirements — short enough to paste back as a prompt, specific enough to reproduce the design
  intent. Saved as `template.md` in the project.

Try prompts like:

- "Create a template from this app"
- "Extract a template I can reuse for the other store's kiosk"
- "Make a template from this project, but describe the layout more loosely"

## Notes

- The output is a **prompt**, not code or a spec — it names concrete values (`#FF6B4A`, `4x5 grid`)
  and stays clear of framework internals, so it reads the same to a designer, a teammate, or
  another agent.
- The agent shows the template before saving; edit, reorder, or drop items until it matches what
  you actually want reproduced.
- Previously shipped as a built-in CTOR skill; it now lives here so it can be updated
  independently of the app. On older CTOR builds that still bundle it, the install screen skips
  this skill as a reserved name — the built-in copy keeps working.
