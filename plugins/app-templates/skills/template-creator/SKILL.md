---
name: template-creator
description: Use when the user wants to extract a reusable template (prompt) from an existing BRICKS application. Analyzes the project's design, data flow, and key features, then produces a concise 5-10 item requirement list that can be used as a prompt to recreate a similar application. Triggers on "create template", "extract template", "generate template", "make a template from this app".
license: MIT
metadata:
  version: 0.1.0
  author: BRICKS
---

# Template Creator

Extract the essence of an existing BRICKS application into a reusable prompt template.

A **template** is a concise list of 5-10 requirements that captures what an application does and how it works — written so that someone (human or AI) can use it as a prompt to build a new application with the same design intent.

**Announce at start:** "I'm using the template-creator skill to analyze this project and generate a template."

## What a Template Is

- A plain-language list of requirements describing the application
- Focused on **design** (visual style, layout, color scheme, component structure) and **data flow** (state shape, how user input transforms state, what triggers what)
- Written from the user's perspective — what the app does, not how the SDK implements it
- Short enough to use directly as a prompt, detailed enough to reproduce the design intent

## What a Template Is NOT

- Not code or pseudocode
- Not a technical spec referencing framework internals (no "subspaces", "canvases", "bricks", "generators", "data calculations", "property bank", etc.)
- Not a step-by-step implementation plan
- Not exhaustive — capture the 5-10 most important points, not every detail

## The Process

### Step 1: Read the Project

Read the application's source files to understand:

- **Visual design**: Layout structure, color palette, typography, visual style (e.g., flat, brutalist, minimal)
- **Components**: What UI elements exist and their roles (buttons, displays, inputs, lists, etc.)
- **State model**: What data the app tracks and in what shape
- **Data flow**: How user actions update state and how state changes reflect in the UI
- **Key behaviors**: Core logic, edge cases, error handling

Focus on files that define the UI layout, data definitions, and calculation/logic scripts.

### Step 2: Identify Key Points

Distill the application into its essential characteristics. Prioritize:

1. **Overall purpose** — what the app is and its visual style (1 item)
2. **Layout and component structure** — how the UI is organized (1-2 items)
3. **Visual design details** — colors, typography, styling patterns (1-2 items)
4. **State model** — what data is tracked and its shape (1 item)
5. **Data flow and interactions** — how input drives state changes and UI updates (1-2 items)
6. **Important behaviors** — edge cases, validation, error handling (1-2 items)

### Step 3: Write the Template

Write a numbered list of 5-10 requirements. Each requirement should be:

- One clear sentence or short paragraph
- Self-contained and understandable without context
- Descriptive (what and why), not prescriptive (not how to implement)

Format:

```markdown
# [App Name] Template

1. [Overall purpose and visual style]
2. [Layout / component structure]
3. ...
```

### Step 4: Present and Refine

Show the template to the user. Ask:

**"Here's the template I extracted. Want to adjust anything before saving?"**

The user may edit, add, remove, or reword items. Iterate until they're satisfied.

### Step 5: Save

Save the final template to `template.md` in the project root (or wherever the user specifies).

## Guidelines

- **Be concise.** Each item should earn its place. If two items can merge without losing clarity, merge them.
- **Use plain language.** Write as if describing the app to a designer or product manager, not a framework developer.
- **Preserve design intent.** Colors, spacing ratios, visual style, and interaction patterns matter — these are often the hardest to reverse-engineer.
- **Capture data shape explicitly.** State structure is the backbone of the app — describe what fields exist and their purpose.
- **Name concrete values.** Say "#FF6B4A coral red" not "a warm color". Say "4x5 grid" not "a grid layout". Specificity makes templates reproducible.

## Example

For a calculator application, a good template might look like:

```markdown
# Calculator Template

1. A calculator app with neo-brutalist visual style: bold 1px shadows on every element, warm off-white (#F5F0E6) background, high-contrast color blocks
2. Display area at the top — dark background (#1A1A1A) with right-aligned white monospace text showing the current value
3. 4-column button grid below the display: row 1 (AC, DEL, %, ÷), row 2 (7, 8, 9, ×), row 3 (4, 5, 6, −), row 4 (1, 2, 3, +), row 5 (wide 0, ., =)
4. Button color coding: numbers in cream (#FEFCF6), operators in coral (#FF6B4A), equals in teal (#00D4AA), function keys in gray (#8E8E93)
5. State tracks four values: display string, first operand, current operator, and a "waiting for next operand" flag
6. Pressing a number appends to display (max 12 chars); pressing an operator stores the current value and operator, then waits for the next number
7. Equals computes the result using stored operand and operator; chained operations (1 + 2 + 3 =) compute intermediate results before applying the new operator
8. Edge cases: division by zero shows "Error", only one decimal point per number, DEL removes last character (shows "0" if empty), AC resets all state
```
