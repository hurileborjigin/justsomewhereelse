"""The dedicated landmarks: her Sydney Opera House, and his Mongolian ger and
Munich Frauenkirche. Doors face Blender -Y like every other building; the
opera and the Frauenkirche are two tiles long (axis along Y, like the barn)."""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

r = math.radians


def opera():
    b = C.Build("Opera")
    sail = C.mat("white", 0.35)
    # the forecourt / podium
    b.box(C.mat("sand", 0.9), (1.8, 3.6, 0.3), loc=(0, 0, 0.15), bevel=0.05)
    # main shell group: a row of tall leaning sails, tallest at the back
    for y, s, lean in ((1.2, 1.0, 24), (0.3, 0.82, 26), (-0.5, 0.66, 28)):
        b.uvsphere(sail, s, loc=(-0.3, y, 0.1), rot=(r(-lean), 0, 0), scale=(0.5, 0.26, 1.9), u=14, v=10)
    # the mouth sail facing the other way
    b.uvsphere(sail, 0.55, loc=(-0.3, -1.3, 0.08), rot=(r(24), 0, 0), scale=(0.48, 0.28, 1.5), u=14, v=10)
    # smaller side group
    for y, s, lean in ((0.45, 0.6, 26), (-0.35, 0.48, 28)):
        b.uvsphere(sail, s, loc=(0.6, y, 0.08), rot=(r(-lean), 0, 0), scale=(0.42, 0.26, 1.6), u=12, v=8)
    b.uvsphere(sail, 0.36, loc=(0.6, -0.95, 0.06), rot=(r(22), 0, 0), scale=(0.4, 0.28, 1.2), u=12, v=8)
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
