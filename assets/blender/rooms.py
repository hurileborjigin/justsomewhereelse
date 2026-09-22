"""Building interiors - one cozy open-top room per building type.

Conventions (the contract with src/world.ts ROOM_SPECS):
- floor top at Z=0, room centered on the origin, door on the -Y wall
  (the exporter turns -Y into three.js +Z, where the exit tile sits)
- tile size is 2 units; prop positions below are chosen to match the
  `blocked` tile lists in ROOM_SPECS: blender (x, y) = (three x, -three z),
  tile (i,j) of a WxH room -> x=(i-(W-1)/2)*2, y=-(j-(H-1)/2)*2
- walls are single-sided panels/tubes facing INWARD, so the follow camera can
  sit outside the room and still see in (dollhouse view); no ceilings
- picture frames are separate objects named Frame1/Frame2 - future hooks for
  hanging photos and text once rooms become galleries/museums
"""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

r = math.radians
WALL_H = 2.6


def rect_shell(b, floor_mat, wall_mat, hx, hy, door_x):
    b.box(floor_mat, (2 * hx + 0.7, 2 * hy + 0.7, 0.35), loc=(0, 0, -0.175))
    b.panel(wall_mat, 2 * hx + 0.7, WALL_H, loc=(0, hy + 0.3, WALL_H / 2), rot=(r(90), 0, 0))
    b.panel(wall_mat, 2 * hx + 0.7, WALL_H, loc=(0, -hy - 0.3, WALL_H / 2), rot=(r(-90), 0, 0))
    b.panel(wall_mat, 2 * hy + 0.7, WALL_H, loc=(-hx - 0.3, 0, WALL_H / 2), rot=(r(90), 0, r(90)))
    b.panel(wall_mat, 2 * hy + 0.7, WALL_H, loc=(hx + 0.3, 0, WALL_H / 2), rot=(r(90), 0, r(-90)))
    door(b, door_x, hy + 0.27)


def round_shell(b, floor_mat, wall_mat, radius, segments=20):
    b.cylinder(floor_mat, radius + 0.5, 0.35, segments=segments, loc=(0, 0, -0.175))
    b.tube(wall_mat, radius + 0.25, WALL_H, segments=segments, loc=(0, 0, WALL_H / 2), inside=True)
    door(b, 0, radius + 0.2)


def door(b, x, wall_y):
    b.panel(C.mat("trunk"), 1.5, 2.1, loc=(x, -wall_y + 0.04, 1.05), rot=(r(-90), 0, 0))
    b.uvsphere(C.mat("bee_yellow"), 0.06, loc=(x + 0.55, -wall_y + 0.12, 1.0), u=8, v=6)


def frame(name, loc, facing_x):
    """A picture frame on an X wall; facing_x = +1 looks toward +X."""
    f = C.Build(name)
    f.box(C.mat("trunk"), (0.12, 1.4, 1.05), loc=(0, 0, 0))
    f.box(C.mat("white", 0.5), (0.12, 1.1, 0.78), loc=(facing_x * 0.04, 0, 0))
    f.obj(location=loc)


def table(b, x, y, top_mat):
    b.box(top_mat, (1.5, 1.5, 0.12), loc=(x, y, 0.72))
    for dx, dy in ((-0.6, -0.6), (0.6, -0.6), (-0.6, 0.6), (0.6, 0.6)):
        b.cylinder(C.mat("trunk"), 0.07, 0.7, segments=6, loc=(x + dx, y + dy, 0.35))


def house_a():  # crooked house: warm wooden room, 6x5 tiles
    b = C.Build("RoomA")
    rect_shell(b, C.mat("trunk"), C.mat("wall"), 6, 5, door_x=1)
    # table on tile (1,1) with bread and cheese
    table(b, -3, 2, C.mat("trunk"))
    b.uvsphere(C.mat("sand"), 0.28, loc=(-3.2, 2.1, 0.92), scale=(1, 1.5, 0.75), u=10, v=8)
    b.box(C.mat("bee_yellow"), (0.35, 0.3, 0.22), loc=(-2.6, 1.8, 0.9))
    # rug in the middle
    b.cylinder(C.mat("roof_red", 1.0), 1.6, 0.06, segments=14, loc=(1, 0, 0.03))
    b.obj()
    frame("Frame1", (-5.85, 1.6, 1.55), facing_x=1)
    frame("Frame2", (-5.85, -1.6, 1.55), facing_x=1)


def house_b():  # mushroom house: round white room with red dots
    b = C.Build("RoomB")
    round_shell(b, C.mat("sand"), C.mat("white", 0.85), 6.2)
    # red dots on the inside of the wall (skip the door side)
    for ang, z in ((30, 1.7), (90, 1.2), (150, 1.9), (210, 1.3), (330, 1.6)):
        t = r(ang)
        b.uvsphere(C.mat("mushroom"), 0.4, loc=(6.2 * math.cos(t), 6.2 * math.sin(t), z),
                   rot=(0, 0, t), scale=(0.25, 1, 0.9), u=10, v=8)
    # round table on the center tile with a little cake
    b.cylinder(C.mat("trunk"), 0.75, 0.75, segments=10, loc=(0, 0, 0.375))
    b.cylinder(C.mat("white", 0.6), 0.38, 0.28, segments=12, loc=(0, 0, 0.9))
    b.uvsphere(C.mat("mushroom"), 0.12, loc=(0, 0, 1.12), u=8, v=6)
    b.obj()


def tower():  # wizard tower: round stone room, shelves and a cauldron
    b = C.Build("RoomT")
    round_shell(b, C.mat("stone"), C.mat("stone"), 6.2)
    for x in (-2, 0, 2):  # bookshelves against the far (+Y) wall
        b.box(C.mat("trunk"), (1.7, 0.6, 2.2), loc=(x, 4.7, 1.1))
        b.box(C.mat("roof_blue"), (0.5, 0.25, 0.35), loc=(x - 0.35, 4.45, 1.5))
        b.box(C.mat("mushroom"), (0.4, 0.25, 0.3), loc=(x + 0.3, 4.45, 1.15))
    # cauldron on tile (2,1)
    b.uvsphere(C.mat("black", 0.6), 0.55, loc=(0, 2, 0.45), scale=(1, 1, 0.8), u=12, v=8)
    b.uvsphere(C.mat("leaf", 0.4), 0.42, loc=(0, 2, 0.72), scale=(1, 1, 0.15), u=12, v=8)
    b.obj()


def barn():  # barn hall: big red room with hay bales
    b = C.Build("RoomN")
    rect_shell(b, C.mat("sand"), C.mat("roof_red"), 6, 8, door_x=1)
    for x, y, spin in ((-3, 5, 15), (3, 3, -25), (-1, -3, 40)):  # hay on blocked tiles
        b.box(C.mat("bee_yellow", 1.0), (1.5, 1.5, 0.95), loc=(x, y, 0.48), rot=(0, 0, r(spin)), bevel=0.08)
    b.obj()
    frame("Frame1", (5.85, 2.2, 1.55), facing_x=-1)
    frame("Frame2", (5.85, -2.2, 1.55), facing_x=-1)


for name, build in (
    ("room_house_a", house_a),
    ("room_house_b", house_b),
    ("room_tower", tower),
    ("room_barn", barn),
):
    C.reset_scene()
    build()
    C.export_glb(f"{name}.glb")
