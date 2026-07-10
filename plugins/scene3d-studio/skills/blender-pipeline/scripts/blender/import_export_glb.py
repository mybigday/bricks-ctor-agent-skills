"""import_export_glb.py — convert any supported 3D file to a BRICKS-safe .glb.

Usage:
    blender -b -P import_export_glb.py -- --in model.fbx --out out/model.glb \
        [--apply-transforms] [--scale 0.01] [--max-dim 2]

Options:
    --apply-transforms  Apply rotation & scale on all mesh objects (recommended).
    --scale <f>         Uniform pre-scale (e.g. 0.01 for cm-authored FBX).
    --max-dim <f>       After scaling, uniformly normalize so the largest
                        bounding-box dimension equals this (2 frames well in
                        Scene3D's default camera).

Export is always: GLB, embedded textures, +Y up, modifiers applied,
animations included, NO Draco/KTX2 (Scene3D loader requirement).
Prints `===JSON===` + { out, triangles, dimensions }. Blender 3.6+.
"""

import bpy
import json
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
    elif ext == "stl":
        try:
            bpy.ops.wm.stl_import(filepath=path)
        except AttributeError:
            bpy.ops.import_scene.stl(filepath=path)
    elif ext in ("usd", "usdz", "usdc", "usda"):
        bpy.ops.wm.usd_import(filepath=path)
    else:
        raise SystemExit(f"Unsupported input format: .{ext}")


def scene_bbox():
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    if lo[0] == float("inf"):
        return [0, 0, 0]
    return [hi[i] - lo[i] for i in range(3)]


def root_objects():
    return [o for o in bpy.data.objects if o.parent is None]


def apply_uniform_scale(factor):
    for obj in root_objects():
        obj.scale = tuple(s * factor for s in obj.scale)


def apply_transforms():
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if obj.type in ("MESH", "EMPTY", "CURVE", "FONT"):
            obj.select_set(True)
    if bpy.context.selected_objects:
        bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def export_glb(path):
    kwargs = dict(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_animations=True,
        export_yup=True,
    )
    try:
        bpy.ops.export_scene.gltf(export_draco_mesh_compression_enable=False, **kwargs)
    except TypeError:
        # Builds without the Draco option compiled in never emit Draco anyway.
        bpy.ops.export_scene.gltf(**kwargs)


def main():
    opts = cli_args()
    src, out = opts.get("in"), opts.get("out")
    if not src or not out:
        raise SystemExit("Missing --in <file> / --out <file.glb>")
    import_any(src)

    if opts.get("scale"):
        apply_uniform_scale(float(opts["scale"]))
    if opts.get("max-dim"):
        dims = scene_bbox()
        biggest = max(dims) or 1.0
        apply_uniform_scale(float(opts["max-dim"]) / biggest)
    if opts.get("apply-transforms"):
        apply_transforms()

    export_glb(out)

    tris = 0
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            tris += len(obj.data.loop_triangles)
    dims = scene_bbox()
    print("===JSON===")
    print(json.dumps({"out": out, "triangles": tris, "dimensions": {k: round(dims[i], 4) for i, k in enumerate("xyz")}}))


main()
