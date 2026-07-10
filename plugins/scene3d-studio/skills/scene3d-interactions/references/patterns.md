# Scene3D Interaction Patterns

Three proven shapes, smallest first. All state names are suggestions — keep
them consistent with the app's Property Bank conventions.

## 1. Attract loop (signage default)

Idle eye-candy that resets after interaction.

- Scene: `controls: 'orbit'`, `autoRotate: true`, slow speed (0.5–1).
- Interaction pauses attract: on `ON_OBJECT_CLICK` (or any app touch event),
  trigger `BRICK_SCENE_3D_SET_CONTROLS` `{ autoRotate: false }` and start an
  idle timer in app state.
- Idle timeout (e.g. 45 s): trigger `SET_CONTROLS` `{ autoRotate: true }` and
  `BRICK_SCENE_3D_RESET` if the visitor moved the camera. Optionally
  `setCamera` with `animateMs` for a smooth glide home instead of a hard
  reset.
- Ambient motion belongs in the per-frame script, e.g. a gentle bob:

```js
{ hero: { position: { x: 0, y: 0.1 + Math.sin(time * 0.8) * 0.05, z: 0 } } }
```

## 2. Product inspector (click-to-explore)

Named parts of one model reveal details.

- Authoring: model with **named nodes** (from Blender); `enableRaycast: true`.
- `ON_OBJECT_CLICK` → event handler stores the picked id in Property Bank
  (`selected_part`) → an info panel brick shows the matching Data entry
  (title, copy, price). Model and content stay in sync because both key off
  the node/object name.
- Focus feedback, two independent levels:
  - Camera: `lookAt { id }` or `setCamera { target, animateMs: 600 }`.
  - Highlight: `updateObject { id, nodes: [{ name, emissive: '#3355ff',
    emissiveIntensity: 1.5 }] }`; clear by setting intensity 0 on deselect.
- Touch kiosks: no hover — make everything reachable by tap, and add a
  visible "tap the product" hint in the idle state.

## 3. Kiosk mini-game (kinematic)

Example: whack-a-mole — the shape generalizes to catchers and quizzes.

- **Scene-internal state** in `__variables` (positions, timers); **app
  state** (score, game phase) in the Property Bank via events. One direction
  each; never both for the same value.
- Spawning: N mole objects declared upfront (ids `mole_0…mole_5`), toggled
  with `visible` — cheaper and simpler than `addObject`/`removeObject` per
  round. Reserve add/remove for genuinely dynamic content.
- Round logic as a per-frame **expression** (IIFE):

```js
(() => {
  const t = (variables.t || 0) + dt
  const up = Math.floor(t / 1.2) % 6          // which mole is up this beat
  const map = { __variables: { t } }
  for (let i = 0; i < 6; i++)
    map['mole_' + i] = { position: { x: (i % 3) - 1, y: i === up ? 0.25 : -0.3, z: Math.floor(i / 3) - 0.5 } }
  return map
})()
```

- Scoring: `enableRaycast: true`; `ON_OBJECT_CLICK` handler checks the id,
  increments `score` in the Property Bank, plays a feedback animation
  (`playAnimation` on the mole) or sound via app actions.
- Game phases (`idle → playing → results`) live in the Property Bank; use
  the `variables` prop to tell the scene the phase (e.g. freeze motion when
  not `playing`), and `BRICK_SCENE_3D_RESET` on game end.
- Difficulty/time limits: drive from `variables` so operators can tune
  without editing the script.

### Kinematic collision cookbook

- Hit = distance check: `dx*dx + dz*dz < r*r` between two object positions.
- Walls = clamp: `Math.max(-2, Math.min(2, x))`.
- Gravity/arcs: keep `vy` in `__variables`, `vy -= 9.8 * dt`, add to y.
- Anything needing stacking, bouncing between many bodies, or ragdolls —
  redesign; there is no physics engine.

## Shared cautions

- Hover exists only on pointer devices; design for tap-first.
- `screenshot` is web/desktop only — no photo-booth features on device fleets.
- Keep per-frame expressions allocation-light; ~dozens of mutated objects per
  frame is fine, hundreds is not (test on the weakest device).
- Wire `ON_SCRIPT_ERROR` somewhere visible during development.
