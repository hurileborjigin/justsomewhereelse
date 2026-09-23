"""The horse. Origin at the feet (Z=0), facing -Y. Taller than the donkey with
an arched neck, dark mane and a flowing tail. Legs are LegFL/FR/BL/BR (hip
origins), Tail swishes, Head (origin at the top of the neck) reaches down to
graze - driven by src/animals.ts."""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

C.reset_scene()

brown = C.mat("horse_brown", 0.9)
dark = C.mat("horse_dark", 0.9)
white = C.mat("white", 0.9)
black = C.mat("black", 0.85)

b = C.Build("Horse")
# long body high off the ground
b.box(brown, (0.5, 1.15, 0.52), loc=(0, 0.12, 0.98), bevel=0.08)
# arched neck rising forward, with a dark mane ridge along its back
b.box(brown, (0.24, 0.3, 0.6), loc=(0, -0.42, 1.3), rot=(math.radians(30), 0, 0), bevel=0.05)
b.box(dark, (0.08, 0.12, 0.56), loc=(0, -0.3, 1.38), rot=(math.radians(30), 0, 0), bevel=0.02)
b.obj()

# long face with a white blaze, flared nostrils and pricked ears
head = C.Build("Head")
head.box(brown, (0.26, 0.28, 0.26), loc=(0, -0.04, 0.02), bevel=0.05)
head.box(brown, (0.18, 0.34, 0.18), loc=(0, -0.28, -0.06), rot=(math.radians(12), 0, 0), bevel=0.04)
head.box(white, (0.06, 0.3, 0.05), loc=(0, -0.28, 0.045), rot=(math.radians(12), 0, 0))
for x in (-0.055, 0.055):
    head.uvsphere(black, 0.02, loc=(x, -0.43, -0.09), u=8, v=6)
for x in (-0.135, 0.135):
    head.uvsphere(black, 0.035, loc=(x, -0.02, 0.07), u=10, v=8)
for sgn in (-1, 1):
    head.cone(brown, 0.045, 0.012, 0.16, segments=6,
              loc=(sgn * 0.08, 0.06, 0.17), rot=(0, sgn * math.radians(15), 0))
# forelock tuft between the ears
head.box(dark, (0.12, 0.1, 0.1), loc=(0, 0.06, 0.16), bevel=0.02)
head.obj(location=(0, -0.56, 1.58))

# full tail sweeping down from the rump
tail = C.Build("Tail")
tail.cone(dark, 0.085, 0.02, 0.6, segments=8, loc=(0, 0.06, -0.28), rot=(math.radians(190), 0, 0))
tail.obj(location=(0, 0.71, 1.18))

# long legs with dark hooves
for name, x, y in (
    ("LegFL", -0.17, -0.36),
    ("LegFR", 0.17, -0.36),
    ("LegBL", -0.17, 0.5),
    ("LegBR", 0.17, 0.5),
):
    leg = C.Build(name)
    leg.cylinder(brown, 0.068, 0.6, segments=8, loc=(0, 0, -0.32))
    leg.cylinder(dark, 0.075, 0.12, segments=8, loc=(0, 0, -0.68))
    leg.obj(location=(x, y, 0.74))

C.export_glb("horse.glb")
