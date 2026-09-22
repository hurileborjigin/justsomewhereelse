"""A grass tuft: a few tiny cones. Single mesh + single material on purpose -
the client draws all tufts as one InstancedMesh (one draw call)."""

import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

C.reset_scene()

b = C.Build("Grass")
green = C.mat("grass_dark")
#         x      y     tilt_x  tilt_y  height
blades = [
    (0.00, 0.00, 0.00, 0.00, 0.27),
    (0.07, 0.03, 0.15, 0.35, 0.20),
    (-0.06, 0.05, 0.20, -0.30, 0.17),
    (0.02, -0.07, -0.35, 0.15, 0.19),
]
for x, y, tx, ty, h in blades:
    b.cone(green, 0.05, 0.005, h, segments=5, loc=(x, y, h / 2), rot=(tx, ty, 0))
b.obj()

C.export_glb("grass.glb")
