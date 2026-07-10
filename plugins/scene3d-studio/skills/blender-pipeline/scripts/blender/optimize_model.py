"""optimize_model.py — decimate meshes, downscale textures, optionally join.

Usage:
    blender -b -P optimize_model.py -- --in in.glb --out out/opt.glb \
        [--ratio 0.5] [--max-texture 2048] [--join]

Options:
    --ratio <f>        Decimate (collapse) ratio per mesh, 0..1 (default 0.5).
                       1.0 skips decimation.
    --max-texture <n>  Downscale any texture whose long edge exceeds n px.
    --join             Join all meshes into one object (fewer draw calls;
                       do NOT use when you need per-node overrides or clips).

Prints `===JSON===` + { out, trianglesBefore, trianglesAfter, texturesScaled }.
Blender 3.6+. Decimation is lossy — always preview the result.
"""

import bpy
import json
import sys


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


def count_tris():
    tris = 0
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            tris += len(obj.data.loop_triangles)
    return tris


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
        bpy.ops.export_scene.gltf(**kwargs)


def main():
    opts = cli_args()
    src, out = opts.get("in"), opts.get("out")
    if not src or not out:
        raise SystemExit("Missing --in <file> / --out <file.glb>")
    ratio = float(opts.get("ratio", 0.5))
    max_tex = int(opts["max-texture"]) if opts.get("max-texture") else None

    import_any(src)
    before = count_tris()

    if ratio < 1.0:
        for obj in bpy.data.objects:
            if obj.type != "MESH":
                continue
            bpy.context.view_layer.objects.active = obj
            mod = obj.modifiers.new(name="BricksDecimate", type="DECIMATE")
            mod.ratio = ratio
            bpy.ops.object.modifier_apply(modifier=mod.name)

    scaled = 0
    if max_tex:
        for im in bpy.data.images:
            w, h = im.size
            if not w or max(w, h) <= max_tex:
                continue
            factor = max_tex / max(w, h)
            im.scale(max(1, int(w * factor)), max(1, int(h * factor)))
            scaled += 1

    if opts.get("join"):
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        if len(meshes) > 1:
            bpy.ops.object.select_all(action="DESELECT")
            for o in meshes:
                o.select_set(True)
            bpy.context.view_layer.objects.active = meshes[0]
            bpy.ops.object.join()

    export_glb(out)
    print("===JSON===")
    print(
        json.dumps(
            {"out": out, "trianglesBefore": before, "trianglesAfter": count_tris(), "texturesScaled": scaled}
        )
    )


main()
