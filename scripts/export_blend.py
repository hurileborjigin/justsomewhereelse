"""Export the currently opened .blend as <name>.glb.

Used by scripts/models.mjs for hand-made models dropped into
assets/blender/blends/ - so your own Blender creations join the same pipeline.
"""

import os
import sys

import bpy

argv = sys.argv
rest = argv[argv.index("--") + 1 :] if "--" in argv else []
out = rest[rest.index("--out") + 1] if "--out" in rest else "public/models"
name = os.path.splitext(os.path.basename(bpy.data.filepath))[0] or "model"
path = os.path.join(os.path.abspath(out), name + ".glb")
os.makedirs(os.path.dirname(path), exist_ok=True)
try:
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_apply=True, export_yup=True
    )
except TypeError:
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")
print(f"exported {path}")
