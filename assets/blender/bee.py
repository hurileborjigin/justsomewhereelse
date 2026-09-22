"""The bee. Origin at the body center (the client keeps it hovering above the
tiles). Wings are separate nodes named WingL/WingR with their origin at the
wing root - the client flutters them by setting rotation.z every frame."""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

C.reset_scene()

yellow = C.mat("bee_yellow", 0.85)
black = C.mat("black", 0.85)
white = C.mat("white", 0.4)

BODY_R = 0.18
ELONG = 1.5  # body stretched along Y (front is -Y)
HALF = BODY_R * ELONG

b = C.Build("Bee")
b.uvsphere(yellow, BODY_R, scale=(1, ELONG, 0.95))

# stripes toward the tail: thin squashed spheres slightly proud of the body
for y in (0.09, 0.18):
    t = y / HALF
    cross = BODY_R * math.sqrt(max(0.0, 1 - t * t))
    b.uvsphere(black, cross + 0.012, loc=(0, y, 0), scale=(1, 0.22, 0.95))

# eyes on the upper front
for x in (-0.09, 0.09):
    b.uvsphere(black, 0.032, loc=(x, -0.155, 0.10), u=10, v=8)

# antennae poking out the top front
for x in (-0.05, 0.05):
    b.cylinder(black, 0.008, 0.16, segments=6, loc=(x, -0.14, 0.19), rot=(0.55, 0, 0))

b.obj()

# wings: named nodes, origin at the root, extending sideways (+/-X)
for name, sgn in (("WingL", 1), ("WingR", -1)):
    w = C.Build(name)
    w.uvsphere(white, 1.0, loc=(sgn * 0.11, 0, 0.02), scale=(0.13, 0.075, 0.018), u=12, v=8)
    w.obj(location=(sgn * 0.05, 0.03, 0.15))

C.export_glb("bee.glb")
