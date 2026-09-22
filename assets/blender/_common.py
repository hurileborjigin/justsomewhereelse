"""Shared helpers for the Tiny Planet Blender asset scripts.

Every script in this folder builds one asset with bmesh primitives and exports
it as .glb (run them all with `npm run models`). Conventions - this is the
contract with the web client (src/assets.ts, src/animate.ts):

- characters face Blender -Y (the glTF exporter turns that into three.js +Z)
- origins: base/feet at Z=0 (donkey, trees, grass); bee at body center
- animated parts are separate objects with meaningful names (WingL, LegFL, ...)
  whose object location is the joint pivot the client rotates around
- flat shading everywhere; a small palette of plain Principled materials
  (base color + roughness only - survives GLB export losslessly, no textures)
"""

import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

PALETTE = {
    "grass": "7ec850",
    "grass_2": "74bd4a",
    "grass_dark": "4e9b3f",
    "leaf": "5fb84e",
    "sand": "e8d29a",
    "dirt": "9c7a4f",
    "trunk": "8a5a3b",
    "bee_yellow": "f2c649",
    "black": "26221f",
    "donkey": "9b8f86",
    "donkey_dark": "7a6f66",
    "snout": "cfc4ba",
    "white": "f5f2ec",
    "water": "4fb3e8",
    "wall": "f4e7c8",
    "roof_red": "d96c5f",
    "roof_blue": "7b6fd9",
    "stone": "b8b2a8",
    "mushroom": "e0574f",
    "window": "9fd8f5",
}


def out_dir():
    argv = sys.argv
    if "--" in argv:
        rest = argv[argv.index("--") + 1 :]
        if "--out" in rest:
            return os.path.abspath(rest[rest.index("--out") + 1])
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", "public", "models"))


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def mat(name, roughness=0.9):
    """Cached flat-color Principled material from the palette."""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    # export single-sided (glTF doubleSided=false): room walls face inward so
    # the camera can look into interiors from outside (dollhouse view)
    m.use_backface_culling = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    hexcode = PALETTE[name]
    rgb = [int(hexcode[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    bsdf.inputs["Base Color"].default_value = (*[_srgb_to_linear(c) for c in rgb], 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return m


class Build:
    """Accumulates bmesh primitives into one flat-shaded multi-material mesh.

    Each part is built in its own temporary bmesh, gets its material index
    stamped on every face, and is then merged in - which keeps material
    bookkeeping correct no matter what bmesh operators do internally.
    Transforms are baked into the vertices, so the object transform stays
    identity except `location`, which becomes the glTF node's pivot point.
    """

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def _mat_index(self, material):
        if material in self.mats:
            return self.mats.index(material)
        self.mats.append(material)
        return len(self.mats) - 1

    @staticmethod
    def _matrix(loc, rot, scale):
        return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale))

    def _merge_part(self, tmp, material):
        idx = self._mat_index(material)
        for f in tmp.faces:
            f.material_index = idx
        carrier = bpy.data.meshes.new("_part")
        tmp.to_mesh(carrier)
        tmp.free()
        self.bm.from_mesh(carrier)
        bpy.data.meshes.remove(carrier)

    def uvsphere(self, material, r, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), u=16, v=12):
        tmp = bmesh.new()
        bmesh.ops.create_uvsphere(
            tmp, u_segments=u, v_segments=v, radius=r, matrix=self._matrix(loc, rot, scale)
        )
        self._merge_part(tmp, material)

    def icosphere(self, material, r, subdiv=1, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(
            tmp, subdivisions=subdiv, radius=r, matrix=self._matrix(loc, rot, scale)
        )
        self._merge_part(tmp, material)

    def cone(self, material, r1, r2, depth, segments=8, loc=(0, 0, 0), rot=(0, 0, 0)):
        tmp = bmesh.new()
        bmesh.ops.create_cone(
            tmp,
            cap_ends=True,
            cap_tris=False,
            segments=segments,
            radius1=r1,
            radius2=r2,
            depth=depth,
            matrix=self._matrix(loc, rot, (1, 1, 1)),
        )
        self._merge_part(tmp, material)

    def cylinder(self, material, r, depth, segments=8, loc=(0, 0, 0), rot=(0, 0, 0)):
        self.cone(material, r, r, depth, segments=segments, loc=loc, rot=rot)

    def box(self, material, dims, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0):
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0, matrix=self._matrix(loc, rot, dims))
        if bevel > 0:
            bmesh.ops.bevel(
                tmp,
                geom=list(tmp.verts) + list(tmp.edges),
                offset=bevel,
                offset_type="OFFSET",
                segments=2,
                profile=0.5,
                affect="EDGES",
            )
        self._merge_part(tmp, material)

    def panel(self, material, w, h, loc=(0, 0, 0), rot=(0, 0, 0)):
        """Single-sided rectangle (a grid facing local +Z). Used for room walls
        that face inward: from outside the camera sees straight through them,
        which is what makes interiors read like a dollhouse."""
        tmp = bmesh.new()
        bmesh.ops.create_grid(
            tmp, x_segments=1, y_segments=1, size=1.0,
            matrix=self._matrix(loc, rot, (w / 2, h / 2, 1)),
        )
        self._merge_part(tmp, material)

    def tube(self, material, r, depth, segments=16, loc=(0, 0, 0), inside=False):
        """Open cylinder shell; inside=True flips the normals inward (round
        room walls seen from within)."""
        tmp = bmesh.new()
        bmesh.ops.create_cone(
            tmp, cap_ends=False, cap_tris=False, segments=segments,
            radius1=r, radius2=r, depth=depth,
            matrix=self._matrix(loc, (0, 0, 0), (1, 1, 1)),
        )
        if inside:
            bmesh.ops.reverse_faces(tmp, faces=list(tmp.faces))
        self._merge_part(tmp, material)

    def obj(self, location=(0, 0, 0)):
        return obj_from_bm(self.name, self.bm, self.mats, location)


def obj_from_bm(name, bm, mats, location=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = False
    obj = bpy.data.objects.new(name, me)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return obj


def export_glb(filename):
    path = os.path.join(out_dir(), filename)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            export_apply=True,
            export_yup=True,
            export_animations=False,
        )
    except TypeError:
        # exporter option names occasionally change between Blender versions
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")
    print(f"exported {path}")
