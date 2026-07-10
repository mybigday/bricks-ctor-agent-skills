"""inspect_model.py — report a 3D file's stats as JSON (headless Blender).

Usage:
    blender -b -P inspect_model.py -- --in model.(glb|gltf|fbx|obj|stl|usd|usdz|blend)

Prints a line `===JSON===` followed by:
    { objects, meshes, triangles, vertices, materials: [names],
      images: [{name, width, height, packed}], animations: [{name, seconds}],
      armatures, dimensions: {x,y,z}, nodeNames: [...], warnings: [...] }

`nodeNames` are the targets for Scene3D `nodes[]` overrides; `animations`
names are what `playAnimation` takes. Works on Blender 3.6+.
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
            bpy.ops.wm.obj_import(filepath=path)  # Blender 3.2+
        except AttributeError:
            bpy.ops.import_scene.obj(filepath=path)  # pre-4.0 fallback
    elif ext == "stl":
        try:
            bpy.ops.wm.stl_import(filepath=path)  # Blender 4.x
        except AttributeError:
            bpy.ops.import_scene.stl(filepath=path)
    elif ext in ("usd", "usdz", "usdc", "usda"):
        bpy.ops.wm.usd_import(filepath=path)
    else:
        raise SystemExit(f"Unsupported input format: .{ext}")


def main():
    opts = cli_args()
    src = opts.get("in")
    if not src:
        raise SystemExit("Missing --in <file>")
    import_any(src)

    tris = verts = mesh_count = 0
    node_names = []
    warnings = []
    bbox_min = [float("inf")] * 3
    bbox_max = [float("-inf")] * 3

    for obj in bpy.data.objects:
        node_names.append(obj.name)
        if obj.type != "MESH":
            continue
        mesh_count += 1
        mesh = obj.data
        mesh.calc_loop_triangles()
        tris += len(mesh.loop_triangles)
        verts += len(mesh.vertices)
        if any(abs(s - 1.0) > 1e-4 for s in obj.scale):
            warnings.append(f"non-applied scale on '{obj.name}' — export with transforms applied")
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            for i in range(3):
                bbox_min[i] = min(bbox_min[i], w[i])
                bbox_max[i] = max(bbox_max[i], w[i])

    dims = (
        {"x": 0, "y": 0, "z": 0}
        if mesh_count == 0
        else {k: round(bbox_max[i] - bbox_min[i], 4) for i, k in enumerate("xyz")}
    )
    fps = bpy.context.scene.render.fps or 24
    animations = [
        {"name": a.name, "seconds": round((a.frame_range[1] - a.frame_range[0]) / fps, 2)}
        for a in bpy.data.actions
    ]
    images = [
        {"name": im.name, "width": im.size[0], "height": im.size[1], "packed": im.packed_file is not None}
        for im in bpy.data.images
        if im.size[0]
    ]
    for im in images:
        if max(im["width"], im["height"]) > 2048:
            warnings.append(
                f"texture '{im['name']}' is {im['width']}x{im['height']} — consider --max-texture 2048"
            )

    result = {
        "source": src,
        "objects": len(bpy.data.objects),
        "meshes": mesh_count,
        "triangles": tris,
        "vertices": verts,
        "materials": [m.name for m in bpy.data.materials],
        "images": images,
        "animations": animations,
        "armatures": sum(1 for o in bpy.data.objects if o.type == "ARMATURE"),
        "dimensions": dims,
        "nodeNames": node_names,
        "warnings": warnings,
    }
    print("===JSON===")
    print(json.dumps(result))


main()
