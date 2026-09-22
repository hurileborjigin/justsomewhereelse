"""The dedicated landmarks: her Sydney Opera House, and his Mongolian ger and
Munich Frauenkirche. Doors face Blender -Y like every other building; the
opera and the Frauenkirche are two tiles long (axis along Y, like the barn)."""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

import bmesh  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402

r = math.radians


def sail(b, material, radius, loc, lean_deg, half_angle=42, scale=(0.72, 1.0, 1.3)):
    """One opera shell: a spherical lune (slice of a sphere between two
    meridian planes), which is what the real sails are - a curved shell
    rising to a sharp point. Double-sided so the open cut never see-throughs.
    Built with poles on Z, bulging toward -Y, tip leaning forward by lean_deg.
    """
    tmp = bmesh.new()
    bmesh.ops.create_uvsphere(tmp, u_segments=24, v_segments=16, radius=radius)
    doomed = []
    for f in tmp.faces:
        c = f.calc_center_median()
        az = math.degrees(math.atan2(c.x, -c.y))  # 0 = facing -Y
        if abs(az) > half_angle:
            doomed.append(f)
    bmesh.ops.delete(tmp, geom=doomed, context="FACES")
    dup = bmesh.ops.duplicate(tmp, geom=list(tmp.faces))
    inner = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMFace)]
    bmesh.ops.reverse_faces(tmp, faces=inner)
    m = Matrix.LocRotScale(Vector(loc), Euler((r(lean_deg), 0, 0)), Vector(scale))
    bmesh.ops.transform(tmp, matrix=m, verts=list(tmp.verts))
    b._merge_part(tmp, material)


def opera():
    b = C.Build("Opera")
    # the sails get their own softly self-lit white so the green ground bounce
    # never muddies them - they should gleam like the real thing
    white = C.mat("white", 0.3)
    if not white.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value:
        bsdf = white.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Emission Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 0.22
    # the stepped podium
    b.box(C.mat("sand", 0.9), (1.8, 3.7, 0.26), loc=(0, 0, 0.13), bevel=0.04)
    b.box(C.mat("sand", 0.9), (1.7, 3.3, 0.18), loc=(0, 0.15, 0.35), bevel=0.03)
    for i, y in enumerate((-1.62, -1.78)):  # entrance steps toward the door
        b.box(C.mat("sand", 0.9), (1.2, 0.18, 0.2 - i * 0.08), loc=(0, y, (0.2 - i * 0.08) / 2))
    # one grand row of broad nested shells, tallest at the back
    for y, s, lean in ((1.35, 1.2, 14), (0.45, 1.0, 21), (-0.45, 0.8, 28)):
        sail(b, white, s, (-0.05, y, 0.4), lean, scale=(1.0, 1.0, 1.25))
    # the mouth shell, leaning the other way
    sail(b, white, 0.58, (-0.05, -1.35, 0.4), -28, scale=(1.0, 1.0, 1.15))
    # the little restaurant shells off to the side
    sail(b, white, 0.42, (0.62, -0.7, 0.38), 20, scale=(0.8, 1.0, 1.1))
    sail(b, white, 0.3, (0.62, -1.15, 0.36), -24, scale=(0.8, 1.0, 1.0))
    b.obj()


def ger():
    b = C.Build("Ger")
    white = C.mat("white", 0.9)
    orange = C.mat("ger_orange", 0.8)
    # felt wall with lattice bands
    b.cylinder(white, 0.95, 0.62, segments=14, loc=(0, 0, 0.31))
    b.cylinder(orange, 0.965, 0.05, segments=14, loc=(0, 0, 0.15))
    b.cylinder(orange, 0.965, 0.05, segments=14, loc=(0, 0, 0.5))
    # shallow roof + toono (the crown)
    b.cone(white, 1.08, 0.16, 0.5, segments=14, loc=(0, 0, 0.87))
    b.cylinder(orange, 0.17, 0.12, segments=10, loc=(0, 0, 1.16))
    # painted door on -Y
    b.box(C.mat("trunk"), (0.62, 0.08, 0.8), loc=(0, -0.91, 0.4))
    b.box(orange, (0.48, 0.1, 0.66), loc=(0, -0.92, 0.38))
    b.obj()


def frauenkirche():
    b = C.Build("Frauenkirche")
    brick = C.mat("brick", 0.95)
    copper = C.mat("copper", 0.5)
    # nave with a steep red roof (a box on its edge)
    b.box(brick, (1.15, 3.0, 1.3), loc=(0, 0.25, 0.65), bevel=0.04)
    b.box(C.mat("roof_red"), (0.95, 3.1, 0.95), loc=(0, 0.25, 1.45), rot=(0, r(45), 0))
    # the two towers with their verdigris onion domes
    for x in (-0.45, 0.45):
        b.cylinder(brick, 0.33, 2.3, segments=10, loc=(x, -1.25, 1.15))
        b.uvsphere(copper, 0.4, loc=(x, -1.25, 2.5), scale=(1, 1, 1.2), u=12, v=10)
        b.cylinder(copper, 0.035, 0.3, segments=6, loc=(x, -1.25, 3.05))
        b.uvsphere(copper, 0.06, loc=(x, -1.25, 3.2), u=8, v=6)
    # portal between the towers + rose window
    b.box(C.mat("trunk"), (0.5, 0.1, 0.9), loc=(0, -1.52, 0.45))
    b.uvsphere(C.mat("window", 0.4), 0.22, loc=(0, -1.28, 1.55), scale=(1, 0.3, 1), u=12, v=8)
    b.obj()


for name, build in (("opera", opera), ("ger", ger), ("frauenkirche", frauenkirche)):
    C.reset_scene()
    build()
    C.export_glb(f"{name}.glb")
