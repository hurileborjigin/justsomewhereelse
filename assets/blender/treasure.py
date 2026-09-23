"""Treasure chests in three sizes (S = one tile, M = 2x2, L = 3x4 tiles).

Origin at the base center, the front (lock side) faces -Y like every other
model. The lid is a separate object named `Lid` whose origin sits ON THE HINGE
(the back top edge of the body): the client opens it by rotating around local
X with a negative angle. Body dimensions are (width, depth, height) in units;
a tile is 2 units, so chests stay a little smaller than their footprint. The
base is flat at Z=0 and the body box keeps its size: src/treasures.ts sinks
each size into the globe by a measured amount that depends on it."""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402


def chest(name, w, d, h):
    body_h = h * 0.62
    lid_h = h - body_h
    wood = C.mat("chest")
    light = C.mat("chest_light")
    dark = C.mat("chest_dark")
    gold = C.mat("gold", 0.4)
    iron = C.mat("iron", 0.6)
    band_w = w * 0.08
    cap = min(w, d) * 0.07
    rivet = min(w, d) * 0.022
    bevel = min(w, d, body_h) * 0.06
    band_xs = (-w * 0.3, w * 0.3)

    b = C.Build(name)
    b.box(wood, (w, d, body_h), loc=(0, 0, body_h / 2), bevel=bevel)
    # a darker base plank so the chest reads as sitting on the ground
    b.box(dark, (w * 1.02, d * 1.02, h * 0.06), loc=(0, 0, h * 0.03))
    # plank seams: two thin dark lines running around the body
    for z in (body_h * 0.38, body_h * 0.7):
        b.box(dark, (w * 1.012, d * 1.012, body_h * 0.018), loc=(0, 0, z))
    # gold caps on the four upright corners
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(gold, (cap, cap, body_h * 1.01), loc=(sx * (w / 2 - cap * 0.3), sy * (d / 2 - cap * 0.3), body_h / 2), bevel=cap * 0.15)
    # two vertical bands around the body, riveted front and back
    for x in band_xs:
        b.box(gold, (band_w, d * 1.03, body_h * 1.01), loc=(x, 0, body_h / 2))
        for z in (body_h * 0.2, body_h * 0.52, body_h * 0.84):
            for sy in (-1, 1):
                b.uvsphere(iron, rivet, loc=(x, sy * (d / 2 + d * 0.016), z), u=8, v=6)
    # the lock: a shield-shaped gold escutcheon with a keyhole, on the front
    plate_w, plate_h = w * 0.18, body_h * 0.3
    front = -d / 2 - d * 0.015
    b.box(gold, (plate_w, d * 0.04, plate_h * 0.7), loc=(0, front, body_h * 0.8))
    b.cone(gold, plate_w * 0.5, plate_w * 0.08, plate_h * 0.5, segments=4,
           loc=(0, front, body_h * 0.8 - plate_h * 0.55), rot=(math.pi / 2, 0, 0))
    b.uvsphere(iron, min(w, d) * 0.035, loc=(0, front - d * 0.02, body_h * 0.84), u=8, v=6)
    b.box(iron, (min(w, d) * 0.03, d * 0.03, plate_h * 0.3), loc=(0, front - d * 0.02, body_h * 0.72))
    b.obj()

    # the lid, built relative to its hinge at (0, +d/2, body_h): a lighter
    # rounded top with gold bands, a gold rim along its front edge, and the
    # hasp that swings up with it
    lid = C.Build("Lid")
    lid.box(light, (w, d, lid_h), loc=(0, -d / 2, lid_h / 2), bevel=lid_h * 0.4)
    lid.box(gold, (w * 1.02, d * 0.06, lid_h * 0.22), loc=(0, -d + d * 0.03, lid_h * 0.11))
    for x in band_xs:
        lid.box(gold, (band_w, d * 1.03, lid_h * 1.02), loc=(x, -d / 2, lid_h / 2))
        for y in (-d * 0.2, -d * 0.5, -d * 0.8):
            lid.uvsphere(iron, rivet, loc=(x, y, lid_h * 1.01), u=8, v=6)
    for sx in (-1, 1):
        lid.box(gold, (cap, cap * 1.2, lid_h * 0.6), loc=(sx * (w / 2 - cap * 0.3), -d + cap * 0.35, lid_h * 0.3), bevel=cap * 0.15)
    lid.box(gold, (plate_w * 0.6, d * 0.05, lid_h * 0.9), loc=(0, -d - d * 0.02, lid_h * 0.45 - lid_h * 0.5))
    lid.obj(location=(0, d / 2, body_h))


for name, dims in (
    ("chest_s", (1.2, 0.9, 0.8)),
    ("chest_m", (3.0, 3.0, 1.6)),
    ("chest_l", (5.0, 7.0, 2.4)),
):
    C.reset_scene()
    chest("Chest" + name[-1].upper(), *dims)
    C.export_glb(f"{name}.glb")
