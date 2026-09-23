"""The sheep. Origin at the feet (Z=0), facing -Y. Legs are LegFL/FR/BL/BR
(hip origins), Tail is a wool puff that wiggles, Head (origin at the neck,
dark face under a wool cap) tips down to graze - driven by src/animals.ts."""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

C.reset_scene()

wool = C.mat("wool", 0.95)
face = C.mat("sheep_face", 0.9)
white = C.mat("white", 0.9)

b = C.Build("Sheep")
# cloud body: a squashed sphere plus lumpy bumps all around
b.uvsphere(wool, 0.34, loc=(0, 0.05, 0.52), scale=(1.0, 1.25, 0.9), u=10, v=8)
for r, loc in (
    (0.16, (0.2, -0.2, 0.68)),
    (0.15, (-0.22, 0.05, 0.62)),
    (0.15, (0.12, 0.28, 0.66)),
    (0.14, (-0.1, -0.3, 0.55)),
    (0.16, (0.0, 0.02, 0.78)),
    (0.14, (0.2, 0.15, 0.5)),
    (0.14, (-0.16, -0.1, 0.72)),
):
    b.uvsphere(wool, r, loc=loc, u=8, v=6)
b.obj()

# dark face with white eyes, side-drooping ears and a wool cap on top
head = C.Build("Head")
head.box(face, (0.2, 0.24, 0.26), loc=(0, -0.1, -0.02), bevel=0.05)
head.uvsphere(wool, 0.15, loc=(0, -0.03, 0.12), scale=(1.15, 1.0, 0.85), u=8, v=6)
for x in (-0.085, 0.085):
    head.uvsphere(white, 0.028, loc=(x, -0.215, 0.03), u=8, v=6)
for sgn in (-1, 1):
    head.cone(face, 0.035, 0.012, 0.14, segments=6,
              loc=(sgn * 0.14, -0.06, 0.05), rot=(0, sgn * math.radians(80), 0))
head.obj(location=(0, -0.34, 0.66))

# stubby wool-puff tail
tail = C.Build("Tail")
tail.uvsphere(wool, 0.09, loc=(0, 0.03, 0), u=8, v=6)
tail.obj(location=(0, 0.45, 0.62))

# thin dark legs under the fluff
for name, x, y in (
    ("LegFL", -0.13, -0.22),
    ("LegFR", 0.13, -0.22),
    ("LegBL", -0.13, 0.28),
    ("LegBR", 0.13, 0.28),
):
    leg = C.Build(name)
    leg.cylinder(face, 0.04, 0.3, segments=8, loc=(0, 0, -0.145))
    leg.obj(location=(x, y, 0.3))

C.export_glb("sheep.glb")
