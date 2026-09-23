"""The Highland cow: a stocky ginger coo under a long shaggy coat, a golden
fringe hanging over the eyes, and wide horns that sweep out and up. Origin at
the feet (Z=0), facing -Y. Legs are LegFL/FR/BL/BR with origins at the hips
(rotation.x swing); Tail (origin at the base) swishes and Head (origin at the
neck) tips down to graze - driven by src/animals.ts."""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

C.reset_scene()

coat = C.mat("highland", 0.95)
under = C.mat("highland_dark", 0.95)
fringe = C.mat("highland_fringe", 0.9)
muzzle = C.mat("muzzle", 0.9)
horn = C.mat("horn", 0.8)
horn_tip = C.mat("horn_tip", 0.8)
black = C.mat("black", 0.9)

r = math.radians

b = C.Build("Cow")
# a low, stocky body, heavy over the shoulders and the rump
b.box(coat, (0.7, 1.15, 0.58), loc=(0, 0.06, 0.72), bevel=0.1)
b.uvsphere(coat, 0.3, loc=(0, -0.32, 0.9), scale=(1.05, 1.0, 0.8), u=12, v=8)
b.uvsphere(coat, 0.27, loc=(0, 0.42, 0.86), scale=(1.1, 0.9, 0.75), u=12, v=8)
# the long coat: rows of hanging tufts along both flanks, darker underneath,
# so the shag reads even in flat shading
for i, y in enumerate((-0.48, -0.29, -0.1, 0.09, 0.28, 0.47)):
    for sgn in (-1, 1):
        dark_row = i % 2 == 0
        b.uvsphere(under if dark_row else coat, 0.13,
                   loc=(sgn * 0.33, y, 0.48 if dark_row else 0.52),
                   scale=(0.7, 0.95, 1.35), u=8, v=6)
        b.uvsphere(coat, 0.12, loc=(sgn * 0.35, y + 0.09, 0.72), scale=(0.7, 0.9, 1.1), u=8, v=6)
# chest and rump tufts
for x in (-0.16, 0.0, 0.16):
    b.uvsphere(under, 0.12, loc=(x, -0.6, 0.5), scale=(0.9, 0.7, 1.3), u=8, v=6)
    b.uvsphere(coat, 0.12, loc=(x, 0.62, 0.52), scale=(0.9, 0.7, 1.3), u=8, v=6)
# a shaggy ridge along the back
for y in (-0.42, -0.16, 0.1, 0.36):
    b.uvsphere(coat, 0.14, loc=(0, y, 0.99), scale=(1.5, 1.0, 0.65), u=8, v=6)
b.obj()

# head: broad face under a heavy golden fringe, dark muzzle, small ears, big horns
head = C.Build("Head")
head.box(coat, (0.42, 0.4, 0.36), loc=(0, -0.16, 0.0), bevel=0.06)
head.box(muzzle, (0.32, 0.18, 0.2), loc=(0, -0.38, -0.1), bevel=0.05)
for x in (-0.08, 0.08):
    head.uvsphere(black, 0.026, loc=(x, -0.475, -0.08), u=8, v=6)
# the eyes hide under the fringe, the way a Highland cow's do
for x in (-0.09, 0.09):
    head.uvsphere(black, 0.024, loc=(x, -0.33, 0.0), u=8, v=6)
# the dossan: two rows of long strands falling over the forehead and eyes
for x in (-0.17, -0.085, 0.0, 0.085, 0.17):
    head.uvsphere(fringe, 0.1, loc=(x, -0.32, -0.02), scale=(0.95, 0.75, 2.1), u=8, v=6)
for x in (-0.13, -0.045, 0.045, 0.13):
    head.uvsphere(fringe, 0.1, loc=(x, -0.24, 0.13), scale=(1.0, 0.8, 1.35), u=8, v=6)
head.uvsphere(fringe, 0.16, loc=(0, -0.12, 0.2), scale=(1.4, 1.0, 0.75), u=10, v=8)
# small ears poking out beside the fringe
for sgn in (-1, 1):
    head.cone(coat, 0.05, 0.015, 0.16, segments=8,
              loc=(sgn * 0.24, -0.1, 0.12), rot=(r(10), sgn * r(80), 0))
    head.uvsphere(fringe, 0.06, loc=(sgn * 0.22, -0.16, 0.16), scale=(0.9, 0.7, 1.2), u=8, v=6)


def make_horn(sgn):
    """Three tapered segments: out to the side, then forward and up, then the tip curls up."""
    p = [sgn * 0.2, -0.1, 0.16]
    steps = (
        (0.18, 0.05, 0.04, 15, 78, horn),
        (0.16, 0.04, 0.03, 10, 55, horn),
        (0.18, 0.03, 0.012, 5, 12, horn_tip),
    )
    for length, r1, r2, tilt_x, tilt_y, material in steps:
        tx, ty = r(tilt_x), r(tilt_y)
        d = (math.cos(tx) * math.sin(ty) * sgn, -math.sin(tx), math.cos(tx) * math.cos(ty))
        center = tuple(p[i] + d[i] * length / 2 for i in range(3))
        head.cone(material, r1, r2, length, segments=8, loc=center, rot=(tx, sgn * ty, 0))
        p = [p[i] + d[i] * length for i in range(3)]


for sgn in (-1, 1):
    make_horn(sgn)
head.obj(location=(0, -0.5, 1.0))

# long tail with a big tuft, hanging down the back
tail = C.Build("Tail")
tail.cylinder(coat, 0.03, 0.44, segments=6, loc=(0, 0.06, -0.21), rot=(r(190), 0, 0))
tail.uvsphere(fringe, 0.09, loc=(0, 0.13, -0.44), scale=(1, 1, 1.4), u=8, v=6)
tail.obj(location=(0, 0.66, 0.98))

# short sturdy legs with fur boots and dark hooves
for name, x, y in (
    ("LegFL", -0.22, -0.34),
    ("LegFR", 0.22, -0.34),
    ("LegBL", -0.22, 0.44),
    ("LegBR", 0.22, 0.44),
):
    leg = C.Build(name)
    leg.uvsphere(under, 0.13, loc=(0, 0, -0.08), scale=(1, 1, 0.9), u=8, v=6)
    leg.cylinder(coat, 0.085, 0.4, segments=8, loc=(0, 0, -0.26))
    leg.cylinder(black, 0.09, 0.12, segments=8, loc=(0, 0, -0.5))
    leg.obj(location=(x, y, 0.56))

C.export_glb("cow.glb")
