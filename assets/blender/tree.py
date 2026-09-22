"""Three cartoon tree variants, each one tile-sized, origin at the trunk base."""

import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402


def pine():
    b = C.Build("TreeA")
    b.cylinder(C.mat("trunk"), 0.13, 0.6, segments=7, loc=(0, 0, 0.3))
    b.cone(C.mat("grass_dark"), 0.75, 0.03, 1.9, segments=8, loc=(0, 0, 1.5))
    b.obj()


def puff():
    b = C.Build("TreeB")
    b.cylinder(C.mat("trunk"), 0.14, 0.8, segments=7, loc=(0, 0, 0.4))
    b.icosphere(C.mat("leaf"), 0.85, subdiv=1, loc=(0, 0, 1.45), scale=(1, 1, 0.85))
    b.obj()


def stacked():
    b = C.Build("TreeC")
    b.cylinder(C.mat("trunk"), 0.12, 0.7, segments=7, loc=(0, 0, 0.35))
    b.icosphere(C.mat("grass_dark"), 0.62, subdiv=1, loc=(0, 0, 1.1))
    b.icosphere(C.mat("grass_dark"), 0.45, subdiv=1, loc=(0, 0, 1.65))
    b.icosphere(C.mat("grass_dark"), 0.3, subdiv=1, loc=(0, 0, 2.05))
    b.obj()


for name, build in (("tree_a", pine), ("tree_b", puff), ("tree_c", stacked)):
    C.reset_scene()
    build()
    C.export_glb(f"{name}.glb")
