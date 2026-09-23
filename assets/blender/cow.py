"""The cow. Origin at the feet (Z=0), facing -Y. Legs are LegFL/FR/BL/BR with
origins at the hips (rotation.x swing); Tail (origin at the base) swishes and
Head (origin at the neck) tips down to graze - driven by src/animals.ts."""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

C.reset_scene()

white = C.mat("white", 0.9)
black = C.mat("black", 0.9)
pink = C.mat("pink", 0.9)
horn = C.mat("horn", 0.85)

b = C.Build("Cow")
# chunky white body with black patches poking just through the surface
b.box(white, (0.62, 1.1, 0.55), loc=(0, 0.08, 0.75), bevel=0.08)
b.box(black, (0.65, 0.34, 0.3), loc=(0, 0.3, 0.86), bevel=0.03)
b.box(black, (0.65, 0.26, 0.26), loc=(0, -0.14, 0.64), bevel=0.03)
b.box(black, (0.4, 0.3, 0.58), loc=(0.1, 0.08, 0.76), bevel=0.03)
# udder with four teats
b.uvsphere(pink, 0.17, loc=(0, 0.3, 0.48), scale=(1, 1.1, 0.7), u=12, v=8)
for x in (-0.07, 0.07):
    for y in (0.24, 0.37):
        b.cylinder(pink, 0.018, 0.09, segments=6, loc=(x, y, 0.36))
b.obj()

# head: white with one black eye patch, wide pink muzzle, horns and side ears
head = C.Build("Head")
head.box(white, (0.38, 0.36, 0.34), loc=(0, -0.16, 0.02), bevel=0.06)
head.box(black, (0.1, 0.18, 0.18), loc=(0.16, -0.14, 0.09), bevel=0.02)
head.box(pink, (0.32, 0.16, 0.2), loc=(0, -0.36, -0.06), bevel=0.04)
for x in (-0.07, 0.07):
    head.uvsphere(black, 0.022, loc=(x, -0.445, -0.04), u=8, v=6)
for x in (-0.2, 0.2):
    head.uvsphere(black, 0.035, loc=(x, -0.2, 0.12), u=10, v=8)
for sgn in (-1, 1):
    head.cone(horn, 0.04, 0.015, 0.17, segments=8,
              loc=(sgn * 0.16, -0.08, 0.24), rot=(0, sgn * math.radians(40), 0))
    head.cone(white, 0.05, 0.012, 0.18, segments=8,
              loc=(sgn * 0.22, -0.08, 0.12), rot=(0, sgn * math.radians(75), 0))
head.obj(location=(0, -0.5, 1.0))

# rope tail with a tuft, hanging down the back
tail = C.Build("Tail")
tail.cylinder(black, 0.024, 0.42, segments=6, loc=(0, 0.06, -0.2), rot=(math.radians(190), 0, 0))
tail.uvsphere(black, 0.06, loc=(0, 0.13, -0.4), u=8, v=6)
tail.obj(location=(0, 0.64, 1.0))

# sturdy legs with black hooves
for name, x, y in (
    ("LegFL", -0.2, -0.32),
    ("LegFR", 0.2, -0.32),
    ("LegBL", -0.2, 0.42),
    ("LegBR", 0.2, 0.42),
):
    leg = C.Build(name)
    leg.cylinder(white, 0.08, 0.42, segments=8, loc=(0, 0, -0.24))
    leg.cylinder(black, 0.085, 0.12, segments=8, loc=(0, 0, -0.5))
    leg.obj(location=(x, y, 0.56))

C.export_glb("cow.glb")
