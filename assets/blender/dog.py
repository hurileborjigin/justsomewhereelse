"""The dog. Origin at the feet (Z=0), facing -Y. Brown with a white chest,
snout and socks, floppy ears and a happy upright tail. Legs are LegFL/FR/BL/BR
(hip origins); EarL/EarR flop (origins where they attach); Tail wags fast
(origin at the base) - driven by src/animals.ts."""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

C.reset_scene()

brown = C.mat("dog_brown", 0.9)
dark = C.mat("dog_dark", 0.9)
white = C.mat("white", 0.9)
black = C.mat("black", 0.85)
pink = C.mat("pink", 0.9)

b = C.Build("Dog")
# body with a white chest/belly patch poking through the front
b.box(brown, (0.3, 0.6, 0.3), loc=(0, 0.06, 0.4), bevel=0.06)
b.box(white, (0.26, 0.34, 0.28), loc=(0, -0.12, 0.36), bevel=0.04)
# head with white snout, black nose, forward puppy eyes and a wee tongue
b.box(brown, (0.3, 0.26, 0.28), loc=(0, -0.32, 0.62), bevel=0.05)
b.box(white, (0.16, 0.16, 0.14), loc=(0, -0.48, 0.55), bevel=0.03)
b.uvsphere(black, 0.035, loc=(0, -0.56, 0.58), u=10, v=8)
b.box(pink, (0.07, 0.1, 0.02), loc=(0, -0.53, 0.47), rot=(math.radians(-15), 0, 0))
for x in (-0.09, 0.09):
    b.uvsphere(black, 0.032, loc=(x, -0.45, 0.68), u=10, v=8)
b.obj()

# floppy ears hanging down the sides of the head
for name, sgn in (("EarL", -1), ("EarR", 1)):
    ear = C.Build(name)
    ear.box(dark, (0.09, 0.05, 0.2), loc=(sgn * 0.05, 0, -0.08),
            rot=(0, sgn * math.radians(25), 0), bevel=0.015)
    ear.obj(location=(sgn * 0.11, -0.3, 0.76))

# upright wagging tail with a white tip
tail = C.Build("Tail")
tail.cylinder(brown, 0.035, 0.26, segments=8, loc=(0, 0.055, 0.1), rot=(math.radians(-35), 0, 0))
tail.uvsphere(white, 0.05, loc=(0, 0.13, 0.21), u=8, v=6)
tail.obj(location=(0, 0.34, 0.5))

# little legs with white socks
for name, x, y in (
    ("LegFL", -0.1, -0.16),
    ("LegFR", 0.1, -0.16),
    ("LegBL", -0.1, 0.24),
    ("LegBR", 0.1, 0.24),
):
    leg = C.Build(name)
    leg.cylinder(brown, 0.045, 0.26, segments=8, loc=(0, 0, -0.12))
    leg.cylinder(white, 0.05, 0.06, segments=8, loc=(0, 0, -0.235))
    leg.obj(location=(x, y, 0.26))

C.export_glb("dog.glb")
