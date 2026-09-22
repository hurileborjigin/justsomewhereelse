"""Fit a downloaded Blender room scene to a Tiny Planet interior and export it.

Usage:
  BLENDER --background "<file>.blend" --python scripts/fit_room.py -- \
      --out public/models/room_house_a.glb --width 12 --depth 10 \
      [--rotz 0] [--drop "Ceiling,Gibson board"] [--floor floor]

What it does:
- deletes cameras, lights, hidden objects and anything named in --drop
- re-links broken external textures by basename from the .blend's folder
- finds the floor object (--floor name fragment, else largest flat mesh),
  centers the scene on it and puts the floor top at Z=0
- uniformly scales so the floor fits the requested width x depth (in game
  units; one tile = 2), optionally rotates around Z first
- exports a GLB (Y-up, textures embedded)

The walkable grid is NOT taken from the model - set the room's w/h/blocked
in ROOM_SPECS (src/world.ts) to match what you imported.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


OUT = arg("--out", "public/models/room_import.glb")
WIDTH = float(arg("--width", "12"))
DEPTH = float(arg("--depth", "10"))
ROTZ = math.radians(float(arg("--rotz", "0")))
DROP = [s.strip().lower() for s in (arg("--drop", "") or "").split(",") if s.strip()]
FLOOR_HINT = (arg("--floor", "floor") or "floor").lower()
# --tex "object hint=image.jpg,other hint=pic.png": force a fresh textured
# material onto objects (rescues rooms whose original materials didn't survive)
TEX = [p.split("=", 1) for p in (arg("--tex", "") or "").split(",") if "=" in p]
# --quad "hint=w,h,cx,cy,cz[,axis]": rebuild an object (or create one if the
# hint matches nothing) as a clean upright quad of w x h at that center
# (post-fit Blender coords). axis = which way it faces: -y (default, toward
# the door), +y, -x or +x. Handy for backdrops, posters and screens.
QUAD = [p.split("=", 1) for p in (arg("--quad", "") or "").split(";") if "=" in p]

blend_dir = os.path.dirname(bpy.data.filepath)

# --- 1. clean up -------------------------------------------------------------
doomed = []
for o in list(bpy.data.objects):
    name = o.name.lower()
    if o.type in ("CAMERA", "LIGHT", "LIGHT_PROBE", "SPEAKER"):
        doomed.append(o)
    elif o.hide_render or o.hide_viewport:
        doomed.append(o)
    elif any(d in name for d in DROP):
        doomed.append(o)
for o in doomed:
    bpy.data.objects.remove(o, do_unlink=True)
print(f"fit_room: removed {len(doomed)} objects")

# --- 2. rescue external textures by basename ---------------------------------
rescued = missing = 0
for img in bpy.data.images:
    if img.packed_file or not img.filepath:
        continue
    try:
        ok = os.path.exists(bpy.path.abspath(img.filepath))
    except Exception:
        ok = False
    if ok:
        continue
    base = os.path.basename(img.filepath.replace("\\", "/"))
    candidate = os.path.join(blend_dir, base)
    if base and os.path.exists(candidate):
        img.filepath = candidate
        try:
            img.reload()
            rescued += 1
        except Exception:
            missing += 1
    else:
        missing += 1
print(f"fit_room: textures rescued={rescued} still-missing={missing}")

def apply_quads():
    for hint, spec in QUAD:
        hint = hint.strip().lower()
        parts = spec.split(",")
        w, h, cx, cy, cz = [float(v) for v in parts[:5]]
        axis = parts[5].strip().lower() if len(parts) > 5 else "-y"
        if axis in ("-y", "+y"):
            sy = 1 if axis == "-y" else -1
            verts = [
                (cx - sy * w / 2, cy, cz - h / 2),
                (cx + sy * w / 2, cy, cz - h / 2),
                (cx + sy * w / 2, cy, cz + h / 2),
                (cx - sy * w / 2, cy, cz + h / 2),
            ]
        else:  # -x / +x
            sx = 1 if axis == "-x" else -1
            verts = [
                (cx, cy - sx * w / 2, cz - h / 2),
                (cx, cy - sx * w / 2, cz + h / 2),
                (cx, cy + sx * w / 2, cz + h / 2),
                (cx, cy + sx * w / 2, cz - h / 2),
            ]
        uvs = ((0, 0), (1, 0), (1, 1), (0, 1)) if axis in ("-y", "+y") else ((1, 0), (1, 1), (0, 1), (0, 0))
        me = bpy.data.meshes.new(f"quad_{hint}")
        me.from_pydata(verts, [], [(0, 1, 2, 3)])
        uv = me.uv_layers.new()
        for i, coord in enumerate(uvs):
            uv.data[i].uv = coord
        targets = [o for o in bpy.data.objects if o.type == "MESH" and hint in o.name.lower()]
        if targets:
            for o in targets:
                o.parent = None
                o.data = me
                o.matrix_world = Matrix.Identity(4)
                print(f"fit_room: rebuilt {o.name} as a {w}x{h} quad at ({cx},{cy},{cz}) facing {axis}")
        else:
            o = bpy.data.objects.new(hint, me)
            bpy.context.scene.collection.objects.link(o)
            print(f"fit_room: created quad object {hint} {w}x{h} at ({cx},{cy},{cz}) facing {axis}")


def apply_tex():
    for hint, image_name in TEX:
        hint = hint.strip().lower()
        image_name = image_name.strip()
        glow = image_name.endswith("@glow")  # self-lit, e.g. TV screens
        if glow:
            image_name = image_name[: -len("@glow")]
        path = os.path.join(blend_dir, image_name)
        targets = [o for o in bpy.data.objects if o.type == "MESH" and hint in o.name.lower()]
        if not targets or not os.path.exists(path):
            print(f"fit_room: --tex skipped ({hint} -> {image_name})")
            continue
        img = bpy.data.images.load(path, check_existing=True)
        m = bpy.data.materials.new(f"tex_{hint}")
        m.use_nodes = True
        m.use_backface_culling = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = 0.85
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = img
        m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if glow:
            m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.0
        for o in targets:
            if not o.data.uv_layers:
                # simple projected UVs so the texture shows at all
                o.data.uv_layers.new()
            o.data.materials.clear()
            o.data.materials.append(m)
        print(f"fit_room: textured {[o.name for o in targets]} with {image_name.strip()}")

# --- 3. find the floor and compute the fit -----------------------------------
meshes = [o for o in bpy.data.objects if o.type == "MESH"]


def world_bbox(objects):
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for o in objects:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector(map(min, mins, w))
            maxs = Vector(map(max, maxs, w))
    return mins, maxs


floor = next((o for o in meshes if FLOOR_HINT in o.name.lower()), None)
if floor is None:
    flat = [o for o in meshes if o.dimensions.z < 0.2 * max(o.dimensions.x, o.dimensions.y, 0.01)]
    floor = max(flat or meshes, key=lambda o: o.dimensions.x * o.dimensions.y)
print(f"fit_room: floor object = {floor.name}")

fmin, fmax = world_bbox([floor])
center = Vector(((fmin.x + fmax.x) / 2, (fmin.y + fmax.y) / 2, fmax.z))
floor_w = max(fmax.x - fmin.x, 0.01)
floor_d = max(fmax.y - fmin.y, 0.01)
if abs(ROTZ) > 1.3:  # quarter-turn swaps the floor's axes
    floor_w, floor_d = floor_d, floor_w
scale = min(WIDTH / floor_w, DEPTH / floor_d)
print(f"fit_room: floor {floor_w:.2f} x {floor_d:.2f} -> scale {scale:.2f}")

M = Matrix.Diagonal((scale, scale, scale, 1)) @ Matrix.Rotation(ROTZ, 4, "Z") @ Matrix.Translation(-center)
for o in bpy.data.objects:
    if o.parent is None:
        o.matrix_world = M @ o.matrix_world

# quads are placed in post-fit coordinates; textures go on last so they also
# cover rebuilt geometry
apply_quads()
apply_tex()

# --- 4. export ---------------------------------------------------------------
out = os.path.abspath(OUT)
os.makedirs(os.path.dirname(out), exist_ok=True)
try:
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_animations=False,
    )
except TypeError:
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB")
mins, maxs = world_bbox([o for o in bpy.data.objects if o.type == "MESH"])
print(
    f"fit_room: exported {out}\n"
    f"fit_room: final bounds x[{mins.x:.1f},{maxs.x:.1f}] y[{mins.y:.1f},{maxs.y:.1f}] z[{mins.z:.1f},{maxs.z:.1f}]"
)
