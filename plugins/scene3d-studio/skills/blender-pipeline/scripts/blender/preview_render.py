"""preview_render.py — quick still render of a model for user approval.

Usage:
    blender -b -P preview_render.py -- --in model.glb --out out/preview.png \
        [--size 800] [--azimuth 30] [--elevation 20] [--engine workbench|eevee]

Frames the model automatically (camera on a sphere around the bounding box),
adds a sun + soft world light, renders a square PNG. Workbench engine is the
default: fast and reliable on headless machines with no GPU context; use
eevee for materials/emission checks when the machine allows it.

Prints `===JSON===` + { out, size }. Blender 3.6+.
"""

import bpy
import json
import math
import sys

from mathutils import Vector


def cli_args():
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    out = {}
    i = 0
    while i < len(args):
        key = args[i].lstrip("-")
        if i + 1 < len(args) and not args[i + 1].startswith("--"):
            out[key] = args[i + 1]
            i += 2
        else:
            out[key] = True
            i += 1
    return out


def import_any(path):
    ext = path.lower().rsplit(".", 1)[-1]
    if ext == "blend":
        bpy.ops.wm.open_mainfile(filepath=path)
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext in ("glb", "gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == "fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == "obj":
        try:
            bpy.ops.wm.obj_import(filepath=path)
        except AttributeError:
            bpy.ops.import_scene.obj(filepath=path)
    elif ext in ("usd", "usdz", "usdc", "usda"):
        bpy.ops.wm.usd_import(filepath=path)
    else:
        raise SystemExit(f"Unsupported input format: .{ext}")


def scene_bounds():
    lo = Vector((float("inf"),) * 3)
    hi = Vector((float("-inf"),) * 3)
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    if lo.x == float("inf"):
        return Vector((0, 0, 0)), 1.0
    center = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.001)
    return center, radius


def main():
    opts = cli_args()
    src, out = opts.get("in"), opts.get("out")
    if not src or not out:
        raise SystemExit("Missing --in <file> / --out <file.png>")
    size = int(opts.get("size", 800))
    azim = math.radians(float(opts.get("azimuth", 30)))
    elev = math.radians(float(opts.get("elevation", 20)))

    import_any(src)
    center, radius = scene_bounds()

    dist = radius * 2.4
    cam_pos = center + Vector(
        (dist * math.cos(elev) * math.sin(azim), -dist * math.cos(elev) * math.cos(azim), dist * math.sin(elev))
    )
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.location = cam_pos
    # Aim at the model center via a track-to constraint on an empty.
    target = bpy.data.objects.new("PreviewTarget", None)
    target.location = center
    bpy.context.scene.collection.objects.link(target)
    con = cam.constraints.new(type="TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"

    sun_data = bpy.data.lights.new("PreviewSun", type="SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("PreviewSun", sun_data)
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.context.scene.collection.objects.link(sun)

    world = bpy.data.worlds.new("PreviewWorld") if not bpy.context.scene.world else bpy.context.scene.world
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.9, 0.9, 0.92, 1.0)
        bg.inputs[1].default_value = 0.7

    scene = bpy.context.scene
    if opts.get("engine") == "eevee":
        for name in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
            try:
                scene.render.engine = name
                break
            except TypeError:
                continue
    else:
        scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.filepath = out
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)

    print("===JSON===")
    print(json.dumps({"out": out, "size": size}))


main()
