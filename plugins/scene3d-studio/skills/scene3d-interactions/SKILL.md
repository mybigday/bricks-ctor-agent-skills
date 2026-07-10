---
name: scene3d-interactions
description: Use when making a Scene3D brick interactive — spin/inspect product viewers, click-to-explore demos, kiosk attract loops, or simple 3D mini-games. Covers the per-frame script (a pure expression evaluated every frame with time, dt, objects, camera, variables, keys, pointer in scope, returning a mutation map; statement-form scripts run once at mount), eventScript for key and pointer handling, raycast picking wired to BRICKS events and actions, and the imperative scriptMember API (addObject, removeObject, updateObject, setCamera, lookAt, playAnimation, stopAnimation, setBackground, setControls, screenshot, getSceneState, raycast). Includes movement and kinematics patterns — there is no physics engine, so no collisions or rigid bodies — plus performance budgets and connecting scene events to app state in the Property Bank. Triggers on "make it interactive", "clickable 3D objects", "rotate on touch", "simple 3D game", "attract loop". For static scene setup use scene3d-authoring.
license: MIT
metadata:
  version: 0.1.0
  author: BRICKS
---

# Scene3D Interactions

Make a composed scene behave: motion, input, picking, and game loops. Exact
signatures live in [references/script-api.md](references/script-api.md);
ready-made patterns in [references/patterns.md](references/patterns.md).

**Announce at start:** "I'm using the scene3d-interactions skill to wire the
scene behavior."

## The three control layers — pick deliberately

1. **Per-frame `script`** — continuous motion that lives entirely inside the
   scene (spin, bob, follow-pointer). It must be a **pure expression** (an
   object literal or IIFE) — expressions run every frame on the worklet
   thread with `time, dt, objects, camera, variables, keys, pointer` in scope
   and return a **mutation map**. A statement-form script instead runs ONCE
   at mount (setup only) — the #1 authoring mistake is writing statements and
   expecting per-frame execution.
2. **`eventScript`** — react to keys/pointer without app round-trips.
   Enable via `eventScriptEvents` (`keys`/`pointer`/`all`), optionally
   allowlist keys with `eventScriptKeys`, and use key-repeat props for
   hold-to-move. Receives `event`/`input` plus the scene scope; returns the
   same mutation-map shape.
3. **App-level control** — the scene talks to the rest of the app:
   - **Out:** brick events (`ON_OBJECT_CLICK`, `ON_ANIMATION_END`,
     `ON_FRAME`, `ON_LOAD/_ERROR`) → BRICKS event handlers → Property Bank
     state, navigation, sounds.
   - **In:** brick actions (`BRICK_SCENE_3D_*`) triggered by events, or the
     scriptMember functions called from Data Calculations (the built-in
     `bricks-ctor` skill documents the data-calc sandbox and how to call
     brick members). Feed dynamic values into the per-frame script via the
     brick's `variables` property — updates flow in on the next frame.

Rule of thumb: motion → layer 1; twitch input → layer 2; anything that
changes app state (score, selection, navigation) → layer 3. Keep game state
either in `__variables` (scene-internal) or the Property Bank (app-visible) —
never split one piece of state across both.

## Mutation map essentials

```js
// Per-frame expression: spin one object, remember elapsed time
{
  spinner: { rotation: { x: 0, y: time * 0.8, z: 0 } },
  __camera: { position: { x: 3, y: 3, z: 5 } },       // optional camera drive
  __variables: { t: (variables.t || 0) + dt }          // persists across frames
}
```

- Keys are object **ids** from the scene declaration, plus `__camera` and
  `__variables`.
- `keys` is a map of currently-held keys; `pointer` is
  `{ x, y, down, type, touchCount }`.
- Wire `BRICK_SCENE_3D_ON_SCRIPT_ERROR` to a visible dev-time indicator —
  script failures are otherwise silent stillness.
- Native `frameRuntime` (`ui` vs `js`) tunes which thread evaluates the
  expression; leave default unless profiling says otherwise.

## Picking

Set `enableRaycast: true` → clicks/taps emit `ON_OBJECT_CLICK` with the
object id (hover works on pointer devices only — never make hover the only
path on touch kiosks). For custom hit-testing (e.g. from a screen overlay),
the `raycast(x, y)` script member returns `{ objectId, point, distance }` or
null.

## No physics engine

There are no rigid bodies or collisions. Fake what the experience needs:
distance checks between object positions (sphere-vs-sphere), clamped
positions for walls, manual gravity (`vy += g*dt`) for arcs. Keep gameplay in
the "kiosk game" class — catchers, whack-a-mole, spinners, quizzes — and it
will feel right; don't attempt physics-heavy genres.

## Performance budget

Per-frame scripts run every frame on the device: keep the expression small
(no allocation-heavy loops over hundreds of objects), prefer `playAnimation`
clips over scripted joint motion, throttle `ON_FRAME` events
(`frameEventInterval` ≥ 250 ms — they cross into app event handling), and
test on the weakest target device. `screenshot` is web/desktop only (native
returns an empty URI) — don't build features on it for device fleets.

## Verify

Simulator first: walk every interaction (click each pickable object, hold
keys, idle for the attract timer) and watch for script errors. Then on
device: touch behavior (tap vs drag on orbit controls), frame rate during the
busiest moment, and input latency. The `bricks-cli` skill covers deploy and
on-device inspection.

## When Not To Use

- Static scene composition (objects/lights/camera) — `scene3d-authoring`.
- Asset creation/optimization — `blender-pipeline`.
- Physics-dependent gameplay — out of scope; redesign kinematically or use a
  different approach.
