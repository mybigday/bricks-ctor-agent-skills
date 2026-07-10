"""new_scene.py — build a procedural scene from a JSON spec and export .glb.

Usage:
    blender -b -P new_scene.py -- --spec spec.json --out out/scene.glb

Spec format (all fields except `type` optional):
{
  "objects": [
    {
      "type": "cube|sphere|cylinder|cone|torus|plane|text",
      "name": "Body",
      "size": 1.0,              // cube/plane edge
      "radius": 0.5,            // sphere/cylinder/cone/torus major radius
      "minor_radius": 0.15,     // torus tube radius
      "depth": 1.0,             // cylinder/cone height
      "text": "OPEN",           // type=text only
      "extrude": 0.05,          // text depth
      "position": [0, 0, 0],    // Blender coords: Z is up here; the glTF
      "rotation_deg": [0, 0, 0],//   exporter converts to Y-up for Scene3D
      "scale": [1, 1, 1],
      "material": {
        "name": "Red",
        "base_color": "#E53E3E",
        "metallic": 0.0,
        "roughness": 0.5,
        "emission": "#000000",
        "emission_strength": 0.0
      }
    }
  ]
}

Materials with the same `name` are shared. Text objects are converted to mesh.
Prints `===JSON===` + { out, objects, triangles }. Blender 3.6+.
"""

import bpy
import json
import math
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


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_rgba(value, default=(0.8, 0.8, 0.8, 1.0)):
    if not value:
        return default
    s = value.lstrip("#")
    if len(s) not in (6, 8):
        return default
    r, g, b = (int(s[i : i + 2], 16) / 255 for i in (0, 2, 4))
    a = int(s[6:8], 16) / 255 if len(s) == 8 else 1.0
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), a)


def make_material(spec):
    name = spec.get("name") or "Material"
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if not bsdf:
        return mat
    bsdf.inputs["Base Color"].default_value = hex_to_rgba(spec.get("base_color"))
    bsdf.inputs["Metallic"].default_value = float(spec.get("metallic", 0.0))
    bsdf.inputs["Roughness"].default_value = float(spec.get("roughness", 0.5))
    emission = spec.get("emission")
    strength = float(spec.get("emission_strength", 0.0))
    if emission and strength > 0:
        # Input was renamed "Emission" -> "Emission Color" in Blender 4.0.
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = hex_to_rgba(emission)
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def add_object(spec):
    kind = spec.get("type")
    if kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=float(spec.get("size", 1.0)))
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=float(spec.get("radius", 0.5)))
        bpy.ops.object.shade_smooth()
    elif kind == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(
            radius=float(spec.get("radius", 0.5)), depth=float(spec.get("depth", 1.0))
        )
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(
            radius1=float(spec.get("radius", 0.5)), depth=float(spec.get("depth", 1.0))
        )
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(
            major_radius=float(spec.get("radius", 0.5)),
            minor_radius=float(spec.get("minor_radius", 0.15)),
        )
    elif kind == "plane":
        bpy.ops.mesh.primitive_plane_add(size=float(spec.get("size", 1.0)))
    elif kind == "text":
        bpy.ops.object.text_add()
        obj = bpy.context.active_object
        obj.data.body = str(spec.get("text", "TEXT"))
        obj.data.extrude = float(spec.get("extrude", 0.05))
        obj.data.align_x = "CENTER"
        bpy.ops.object.convert(target="MESH")
    else:
        raise SystemExit(f"Unknown object type: {kind}")

    obj = bpy.context.active_object
    if spec.get("name"):
        obj.name = spec["name"]
    obj.location = spec.get("position", [0, 0, 0])
    obj.rotation_euler = [math.radians(d) for d in spec.get("rotation_deg", [0, 0, 0])]
    obj.scale = spec.get("scale", [1, 1, 1])
    if spec.get("material"):
        obj.data.materials.append(make_material(spec["material"]))
    return obj


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
    spec_path, out = opts.get("spec"), opts.get("out")
    if not spec_path or not out:
        raise SystemExit("Missing --spec <spec.json> / --out <file.glb>")
    with open(spec_path) as f:
        spec = json.load(f)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    for obj_spec in spec.get("objects", []):
        add_object(obj_spec)

    export_glb(out)

    tris = 0
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            tris += len(obj.data.loop_triangles)
    print("===JSON===")
    print(json.dumps({"out": out, "objects": len(bpy.data.objects), "triangles": tris}))


main()
