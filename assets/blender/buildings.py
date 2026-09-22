"""Strange little buildings. house_a/house_b/tower each fit ONE tile (~2 units,
origin at the base center); the barn is long and occupies TWO tiles along its
local Y axis (origin at the center of the whole footprint)."""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

r = math.radians


def crooked_house():
    b = C.Build("HouseA")
    wall = C.mat("wall")
    roof = C.mat("roof_red")
    # ground floor, slightly tilted; second floor bigger and twisted the other way
    b.box(wall, (1.3, 1.2, 1.0), loc=(0, 0, 0.5), rot=(0, r(2), r(-4)), bevel=0.05)
    b.box(wall, (1.5, 1.35, 0.7), loc=(0.04, 0, 1.25), rot=(0, r(-3), r(7)), bevel=0.05)
    # wonky pyramid roof + chimney
    b.cone(roof, 1.15, 0.05, 1.0, segments=4, loc=(0, 0, 2.1), rot=(r(4), 0, r(18)))
    b.cylinder(C.mat("stone"), 0.09, 0.5, segments=6, loc=(-0.45, 0.3, 2.25), rot=(r(-6), 0, 0))
    # door (front = -Y) and windows
    b.box(C.mat("trunk"), (0.42, 0.08, 0.62), loc=(0, -0.62, 0.31))
    b.box(C.mat("window"), (0.3, 0.08, 0.3), loc=(-0.4, -0.66, 1.25), rot=(0, 0, r(7)))
    b.box(C.mat("window"), (0.3, 0.08, 0.3), loc=(0.42, -0.66, 1.3), rot=(0, 0, r(7)))
    b.obj()


def mushroom_house():
    b = C.Build("HouseB")
    stem = C.mat("wall")
    cap = C.mat("mushroom")
    dot = C.mat("white", 0.6)
    b.cylinder(stem, 0.55, 1.1, segments=12, loc=(0, 0, 0.55))
    b.uvsphere(cap, 1.05, loc=(0, 0, 1.5), scale=(1, 1, 0.62))
    # white dots sitting on the cap
    for theta, phi in ((0, 28), (75, 48), (160, 35), (235, 50), (305, 30)):
        t, p = r(theta), r(phi)
        x = 1.0 * math.sin(p) * math.cos(t)
        y = 1.0 * math.sin(p) * math.sin(t)
        z = 1.5 + 0.62 * math.cos(p)
        b.uvsphere(dot, 0.16, loc=(x, y, z), scale=(1, 1, 0.5), u=10, v=8)
    # round door and a porthole window
    b.box(C.mat("trunk"), (0.36, 0.1, 0.58), loc=(0, -0.52, 0.29))
    b.uvsphere(C.mat("window"), 0.12, loc=(0.42, -0.36, 0.75), scale=(1, 0.4, 1), u=10, v=8)
    b.obj()


def wizard_tower():
    b = C.Build("Tower")
    stone = C.mat("stone")
    b.cylinder(stone, 0.58, 1.7, segments=10, loc=(0, 0, 0.85))
    b.cylinder(stone, 0.72, 0.45, segments=10, loc=(0, 0, 1.95))  # overhanging top
    b.cone(C.mat("roof_blue"), 0.85, 0.03, 1.25, segments=10, loc=(0, 0, 2.8))
    # door + tiny windows spiralling up
    b.box(C.mat("trunk"), (0.36, 0.12, 0.6), loc=(0, -0.54, 0.3))
    for ang, z in ((30, 0.9), (-50, 1.3), (10, 1.95)):
        t = r(ang)
        b.box(C.mat("window"), (0.16, 0.1, 0.22), loc=(0.56 * math.sin(t), -0.56 * math.cos(t), z), rot=(0, 0, -t))
    b.obj()


def barn():
    b = C.Build("Barn")
    red = C.mat("roof_red")
    b.box(red, (1.5, 3.3, 1.2), loc=(0, 0, 0.6), bevel=0.06)
    # rounded white roof: a squashed cylinder lying along Y
    b.cylinder(C.mat("white", 0.7), 0.85, 3.5, segments=12, loc=(0, 0, 1.25), rot=(r(90), 0, 0))
    # big doors on both ends + trim
    b.box(C.mat("trunk"), (0.7, 0.1, 0.85), loc=(0, -1.66, 0.43))
    b.box(C.mat("trunk"), (0.7, 0.1, 0.85), loc=(0, 1.66, 0.43))
    b.box(C.mat("window"), (0.34, 0.1, 0.34), loc=(0, -1.68, 1.25))
    b.obj()


for name, build in (
    ("house_a", crooked_house),
    ("house_b", mushroom_house),
    ("tower", wizard_tower),
    ("barn", barn),
):
    C.reset_scene()
    build()
    C.export_glb(f"{name}.glb")
