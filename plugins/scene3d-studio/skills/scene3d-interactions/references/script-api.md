# Scene3D Script API Reference

## Per-frame `script` scope

Available identifiers inside the expression:

| Name | Shape | Notes |
|---|---|---|
| `time` | seconds since mount | monotonic |
| `dt` | seconds since last frame | frame-rate independent motion: `pos += v*dt` |
| `objects` | current objects state | read positions/rotations |
| `camera` | current camera state | read position/target |
| `variables` | the brick's `variables` prop merged with `__variables` persisted values | app → scene channel |
| `keys` | `{ [key]: truthy }` while held | enable via `eventScriptEvents`/interaction group |
| `pointer` | `{ x, y, down, type, touchCount }` | canvas-relative layout points |

Return a **mutation map**: `{ <objectId>: {position?, rotation?, scale?,
visible?, color?, nodes?}, __camera: {position?, target?, fov?},
__variables: {…} }`. Only include what changed — the map is applied as a diff
every frame.

**Expression vs statements:** pure expressions (object literal, ternary,
IIFE `(() => ({...}))()`) run per frame; statement-form scripts run once at
mount in the JS sandbox (setup). Native `frameRuntime`: `ui` (reanimated UI
runtime) or `js` (worklets thread); web/desktop always evaluate synchronously
on the JS thread.

## `eventScript`

Runs when an enabled key/pointer event fires (`eventScriptEvents`:
`none|all|keys|pointer`; `eventScriptKeys` allowlist by `pressedKey`, `code`,
or `keyCode`; `eventScriptKeyRepeat` + interval for hold-to-repeat, repeats
carry `event.repeat === true`). Receives `event` / `input` plus `time`,
`objects`, `camera`, `variables`; returns the same mutation map shape.

## Script members (imperative API)

Callable on the brick from Data Calculations (see the built-in `bricks-ctor`
skill for the sandbox call syntax); each has a matching `BRICK_SCENE_3D_*`
action for event-driven use.

| Member | Signature (options) | Returns |
|---|---|---|
| `addObject` | `{ id?, type*, url?, md5?, position?, rotation?, scale?, color?, text?, visible? }` — url+md5 required for gltf/usd/usdz | `{ id }` |
| `removeObject` | `{ id* }` | boolean |
| `updateObject` | `{ id*, position?, rotation?, scale?, visible?, color?, nodes? }` | boolean |
| `setCamera` | `{ position?, target?, fov?, animateMs? }` — animated when `animateMs > 0` | boolean |
| `lookAt` | `{ id* }` | boolean |
| `playAnimation` | `{ id*, name*, loop?, speed? }` | boolean |
| `stopAnimation` | `{ id*, name? }` | boolean |
| `setBackground` | `{ color?, hdrUrl?, md5? }` | boolean |
| `setControls` | `{ enabled?, autoRotate?, autoRotateSpeed? }` | boolean |
| `screenshot` | `{ format? 'png'\|'jpeg', quality? }` — **web/desktop only; native returns empty uri** | `{ uri }` |
| `getSceneState` | — | `{ objects, camera, lights }` |
| `raycast` | `{ x*, y* }` screen px | `{ objectId, point, distance }` or null |

`BRICK_SCENE_3D_RESET` (action) restores the declared `objects`/`lights`/
`camera` — the cleanest way to end a session/game.

## Events → app wiring

| Event | Fires | Payload highlights |
|---|---|---|
| `ON_OBJECT_CLICK` | tap/click hit (needs `enableRaycast`) | object id |
| `ON_OBJECT_HOVER` | hover enter/leave (pointer devices only) | object id |
| `ON_ANIMATION_END` | clip finished | object id, clip |
| `ON_FRAME` | periodic (`emitFrameEvents` + `frameEventInterval`) | keep interval ≥ 250 ms |
| `ON_LOAD` / `ON_LOAD_ERROR` | per asset | object id, duration |
| `ON_SCRIPT_ERROR` | script compile/init/frame failure | wire to a dev indicator |

Data flow summary: **app → scene** via the `variables` prop (next-frame
visibility) and actions/members; **scene → app** via events (state changes,
scores, selections land in the Property Bank through event handlers).
