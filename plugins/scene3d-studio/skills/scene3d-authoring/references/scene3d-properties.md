# Scene3D Property Reference

Distilled from the Scene3D brick definition. Shapes shown as the properties
panel / editing tools accept them. Defaults in parentheses.

## Objects

```
objects: [{
  id: string,                    // stable id — scripts/actions/events use it
  type: 'gltf'|'usd'|'usdz'|'box'|'sphere'|'plane'|'cylinder'|'cone'|'torus'|'text',
  url: string,                   // model URL (gltf/usd/usdz)
  md5: string,                   // REQUIRED with url — cache + offline preload key
  position: {x,y,z}, rotation: {x,y,z}, scale: {x,y,z},
  color: string,                 // primitives / tint
  text: string,                  // type 'text' only
  animation: string,             // autoplay clip name (gltf)
  visible: bool,
  castShadow: bool, receiveShadow: bool,
  nodes: [{                      // named-node overrides inside a loaded model
    name: string,
    visible?, position?, rotation?, scale?,
    color?, emissive?, emissiveIntensity?,
    metalness?, roughness?, opacity?
  }]
}]
```

## Lights

```
ambientColor, ambientIntensity   // flat ambient term
lights: [{
  type: 'directional'|'point'|'spot'|'hemisphere',
  color, intensity,
  position: {x,y,z}, target: {x,y,z},   // directional/spot aim at target
  castShadow: bool,
  distance, decay,                 // point/spot falloff
  angle, penumbra,                 // spot cone
  groundColor                      // hemisphere only (sky = color)
}]
```

## Camera & controls

```
cameraType: 'perspective'|'orthographic'   (perspective)
cameraPosition: {x,y,z}   ((3,3,5))
cameraTarget: {x,y,z}     ((0,0,0))
fov: 50   near: 0.1   far: 1000   zoom: 1
controls: 'none'|'orbit'|'pan-zoom'   (none)
autoRotate (false)   autoRotateSpeed (2)
enableDamping (true)
minDistance (0.5)  maxDistance (50)
minPolarAngle (0)  maxPolarAngle
```

## Background & environment

```
backgroundColor: string          // solid color when no image is set
backgroundImage: string          // equirect HDR/EXR/LDR URL — PBR image-based
backgroundImageHash: string      //   lighting + background; md5 like objects
backgroundBlur: 0..1             // blur when shown as background
envMapProjection / envIntensity / envRotation   // IBL controls
fog…                             // distance fog color/range group
```

## Ground (shadow catcher)

```
groundEnabled, groundColor, groundOpacity, groundY, groundSize
```

## Renderer & post-FX

```
antialias (true)   alpha (false)   shadows (false)
toneMapping: 'none'|'linear'|'reinhard'|'cineon'|'aces'|'agx'   (aces)
exposure (1)   colorSpace ('srgb')   pixelRatio (0 = auto)   frameLoop ('always')
bloom (off): bloomStrength / bloomThreshold (HDR chain — keep ≥1 for
             highlights-only glow) / bloomRadius
fxaa: bool   ssao: bool          // ssao + shadows are the expensive ones
```

## Actions (trigger from events), commands verified

`BRICK_SCENE_3D_LOOK_AT` (Object ID) · `BRICK_SCENE_3D_PLAY_ANIMATION`
(Object ID, Clip Name, Loop, Speed) · `BRICK_SCENE_3D_STOP_ANIMATION` ·
`BRICK_SCENE_3D_SET_BACKGROUND` (Color / HDR URL / HDR MD5) ·
`BRICK_SCENE_3D_SET_CONTROLS` (Enabled / Auto-Rotate / Speed) ·
`BRICK_SCENE_3D_SCREENSHOT` (png/jpeg, quality — **web/desktop only; native
emits an empty URI**) · `BRICK_SCENE_3D_RESET` (back to declared props) ·
plus object add/remove/update and camera commands mirroring the script
members (see `scene3d-interactions`' script API reference).

## Events

| Event | Payload highlights |
|---|---|
| `BRICK_SCENE_3D_ON_LOAD` | Object ID, Duration (ms) — per asset |
| `BRICK_SCENE_3D_ON_LOAD_ERROR` | Object ID — wire to a visible fallback |
| `BRICK_SCENE_3D_ON_OBJECT_CLICK` | needs `enableRaycast: true` |
| `BRICK_SCENE_3D_ON_OBJECT_HOVER` | pointer devices only |
| `BRICK_SCENE_3D_ON_ANIMATION_END` | clip finished |
| `BRICK_SCENE_3D_ON_FRAME` | gated by `emitFrameEvents`, throttled by `frameEventInterval` |
| `BRICK_SCENE_3D_ON_SCRIPT_ERROR` | inline script compile/init/frame failure |

## Look presets (starting points)

- **Product viewer**: hemisphere (sky white, ground grey, 0.6) + directional
  key (2.5, castShadow) · orbit controls, damping, distance clamp ·
  `groundEnabled` shadow catcher · aces tone mapping.
- **Ambient/hero scene**: HDR `backgroundImage` does the lighting
  (envIntensity ~1), backgroundBlur 0.3–0.6 for depth, minimal lights ·
  autoRotate slow (0.5) · optional bloom with emissive accents.
- **Dark stage**: backgroundColor near-black + 1–2 spots with penumbra ·
  ssao only on desktop-class devices.
