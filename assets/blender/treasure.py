"""Treasure chests in three sizes (S = one tile, M = 2x2, L = 3x4 tiles).

Origin at the base center, the front (lock side) faces -Y like every other
model. The lid is a separate object named `Lid` whose origin sits ON THE HINGE
(the back top edge of the body): the client opens it by rotating around local
X with a negative angle. Body dimensions are (width, depth, height) in units;
a tile is 2 units, so chests stay a little smaller than their footprint."""

import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402


def chest(name, w, d, h):
    body_h = h * 0.62
    lid_h = h - body_h
    wood = C.mat("chest")
    dark = C.mat("chest_dark")
    gold = C.mat("gold", 0.45)
    iron = C.mat("iron", 0.6)
    band_w = w * 0.08
    bevel = min(w, d, body_h) * 0.06

    b = C.Build(name)
    b.box(wood, (w, d, body_h), loc=(0, 0, body_h / 2), bevel=bevel)
    # a darker base plank so the chest reads as sitting on the ground
    b.box(dark, (w * 1.02, d * 1.02, h * 0.06), loc=(0, 0, h * 0.03))
    # two vertical bands around the body
    for x in (-w * 0.28, w * 0.28):
        b.box(gold, (band_w, d * 1.03, body_h * 1.01), loc=(x, 0, body_h / 2))
    # lock plate + keyhole knob on the front
    b.box(gold, (w * 0.16, d * 0.04, body_h * 0.28), loc=(0, -d / 2 - d * 0.015, body_h * 0.78))
    b.uvsphere(iron, min(w, d) * 0.04, loc=(0, -d / 2 - d * 0.04, body_h * 0.7), u=8, v=6)
    b.obj()

    # the lid, built relative to its hinge at (0, +d/2, body_h)
    lid = C.Build("Lid")
    lid.box(wood, (w, d, lid_h), loc=(0, -d / 2, lid_h / 2), bevel=lid_h * 0.4)
    for x in (-w * 0.28, w * 0.28):
        lid.box(gold, (band_w, d * 1.03, lid_h * 1.02), loc=(x, -d / 2, lid_h / 2))
    lid.obj(location=(0, d / 2, body_h))


for name, dims in (
    ("chest_s", (1.2, 0.9, 0.8)),
    ("chest_m", (3.0, 3.0, 1.6)),
    ("chest_l", (5.0, 7.0, 2.4)),
):
    C.reset_scene()
    chest("Chest" + name[-1].upper(), *dims)
    C.export_glb(f"{name}.glb")
