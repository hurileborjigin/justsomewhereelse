"""The donkey. Origin at the feet (Z=0), facing -Y. Legs are separate nodes
LegFL/FR/BL/BR with origins at the hips (the client swings rotation.x while
walking); ears are EarL/EarR with origins at the base (rotation.z wiggle)."""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

C.reset_scene()

grey = C.mat("donkey", 0.9)
dark = C.mat("donkey_dark", 0.9)
snout = C.mat("snout", 0.9)
black = C.mat("black", 0.85)

b = C.Build("Donkey")
# body
b.box(grey, (0.5, 0.95, 0.45), loc=(0, 0.06, 0.62), bevel=0.07)
# head, tilted slightly forward-down
b.box(grey, (0.34, 0.42, 0.4), loc=(0, -0.52, 0.95), rot=(math.radians(12), 0, 0), bevel=0.06)
# lighter snout
b.box(snout, (0.26, 0.24, 0.22), loc=(0, -0.68, 0.84), rot=(math.radians(12), 0, 0), bevel=0.05)
# eyes on the sides of the head
for x in (-0.165, 0.165):
    b.uvsphere(black, 0.035, loc=(x, -0.58, 1.02), u=10, v=8)
# dark mane ridge along the neck
b.box(dark, (0.09, 0.34, 0.14), loc=(0, -0.36, 1.10), rot=(math.radians(35), 0, 0), bevel=0.02)
# tail hanging down-back, with a tuft
b.cylinder(dark, 0.028, 0.34, segments=6, loc=(0, 0.60, 0.60), rot=(math.radians(205), 0, 0))
b.uvsphere(dark, 0.07, loc=(0, 0.69, 0.41), u=10, v=8)
b.obj()

# legs: named nodes, origin at the hip, feet reaching Z=0
for name, x, y in (
    ("LegFL", -0.16, -0.30),
    ("LegFR", 0.16, -0.30),
    ("LegBL", -0.16, 0.34),
    ("LegBR", 0.16, 0.34),
):
    leg = C.Build(name)
    leg.cylinder(dark, 0.075, 0.48, segments=8, loc=(0, 0, -0.22))
    leg.obj(location=(x, y, 0.46))

# ears: named nodes, origin at the base, tipping outward
for name, sgn in (("EarL", -1), ("EarR", 1)):
    ear = C.Build(name)
    ear.cone(grey, 0.065, 0.012, 0.34, segments=6, loc=(0, 0, 0.17), rot=(0, sgn * math.radians(20), 0))
    ear.obj(location=(sgn * 0.11, -0.50, 1.16))

C.export_glb("donkey.glb")
