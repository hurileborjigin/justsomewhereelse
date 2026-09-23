"""The cat. Origin at the feet (Z=0), facing -Y. An orange tabby: stripes on
the back, white muzzle and paws, green eyes, pink nose, pointy pyramid ears
and a curved upright tail. Legs are LegFL/FR/BL/BR (hip origins); EarL/EarR
flick; Tail sways (origin at the base) - driven by src/animals.ts."""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

C.reset_scene()

orange = C.mat("cat_orange", 0.9)
stripe = C.mat("cat_stripe", 0.9)
white = C.mat("white", 0.9)
green = C.mat("cat_eye", 0.6)
pink = C.mat("pink", 0.9)

b = C.Build("Cat")
# slinky body with tabby stripes poking through the back
b.box(orange, (0.22, 0.48, 0.22), loc=(0, 0.05, 0.3), bevel=0.05)
b.box(stripe, (0.24, 0.06, 0.16), loc=(0, -0.06, 0.34))
b.box(stripe, (0.24, 0.06, 0.16), loc=(0, 0.08, 0.34))
b.box(stripe, (0.24, 0.06, 0.15), loc=(0, 0.2, 0.33))
b.box(white, (0.18, 0.1, 0.18), loc=(0, -0.17, 0.26), bevel=0.02)
# wide little head: white muzzle, pink nose, green eyes, head stripes
b.box(orange, (0.26, 0.2, 0.22), loc=(0, -0.26, 0.5), bevel=0.05)
b.box(white, (0.12, 0.07, 0.09), loc=(0, -0.375, 0.46), bevel=0.015)
b.cone(pink, 0.022, 0.004, 0.04, segments=6, loc=(0, -0.4, 0.5), rot=(math.radians(90), 0, 0))
for x in (-0.075, 0.075):
    b.uvsphere(green, 0.03, loc=(x, -0.355, 0.54), u=10, v=8)
for x in (-0.05, 0.05):
    b.box(stripe, (0.03, 0.12, 0.05), loc=(x, -0.22, 0.6))
b.obj()

# pointy pyramid ears
for name, sgn in (("EarL", -1), ("EarR", 1)):
    ear = C.Build(name)
    ear.cone(orange, 0.05, 0.006, 0.13, segments=4, loc=(0, 0, 0.05),
             rot=(0, sgn * math.radians(18), math.radians(45)))
    ear.obj(location=(sgn * 0.09, -0.26, 0.6))

# tall tail with a dark curled tip
tail = C.Build("Tail")
tail.cylinder(orange, 0.024, 0.3, segments=6, loc=(0, 0.03, 0.13), rot=(math.radians(-12), 0, 0))
tail.cylinder(stripe, 0.02, 0.12, segments=6, loc=(0, -0.01, 0.31), rot=(math.radians(20), 0, 0))
tail.obj(location=(0, 0.28, 0.36))

# dainty legs with white paws
for name, x, y in (
    ("LegFL", -0.075, -0.12),
    ("LegFR", 0.075, -0.12),
    ("LegBL", -0.075, 0.2),
    ("LegBR", 0.075, 0.2),
):
    leg = C.Build(name)
    leg.cylinder(orange, 0.03, 0.19, segments=8, loc=(0, 0, -0.085))
    leg.cylinder(white, 0.036, 0.055, segments=8, loc=(0, 0, -0.165))
    leg.obj(location=(x, y, 0.19))

C.export_glb("cat.glb")
