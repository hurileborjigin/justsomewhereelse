"""The tile planet: an equal-angle spherified cube, 6 x N x N square tiles.

The vertex mapping here MUST stay identical to src/grid.ts (tileCenter/tileAt),
so the squares you see are exactly the squares the game logic uses. Every tile
is inset + raised into a little block, checkerboarded in two greens with a few
sand patches; the inset rims read as dirt between tiles.
"""

import math
import os
import random
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

R = 20.0  # keep in sync with R in shared/protocol.ts
N = 16  # keep in sync with N in shared/protocol.ts
A = math.pi / 4
INSET_THICKNESS = 0.05
INSET_DEPTH = 0.06  # SURFACE in shared/protocol.ts = R + this

C.reset_scene()

bm = bmesh.new()
bmesh.ops.create_cube(bm, size=2.0)
bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=N - 1, use_grid_fill=True)

mats = [C.mat("grass"), C.mat("grass_2"), C.mat("sand"), C.mat("dirt")]
DIRT = 3

# --- tile colors, computed on the flat cube (before spherifying) -------------
bm.faces.ensure_lookup_table()


def tile_ij(face):
    c = face.calc_center_median()
    d = max(range(3), key=lambda k: abs(c[k]))
    p, q = (k for k in range(3) if k != d)
    i = min(N - 1, max(0, int((c[p] + 1) / 2 * N)))
    j = min(N - 1, max(0, int((c[q] + 1) / 2 * N)))
    return i, j


for f in bm.faces:
    i, j = tile_ij(f)
    f.material_index = (i + j) % 2

rng = random.Random(42)
for seed_face in rng.sample(list(bm.faces), 9):
    patch = {seed_face}
    for e in seed_face.edges:
        patch.update(e.link_faces)
    for f in patch:
        if rng.random() < 0.85:
            f.material_index = 2

# --- spherify: equal-angle cube-sphere, same formula as src/grid.ts ----------
for v in bm.verts:
    co = v.co
    d = max(range(3), key=lambda k: abs(co[k]))
    mapped = Vector((0.0, 0.0, 0.0))
    for k in range(3):
        mapped[k] = co[k] if k == d else math.tan(A * co[k])
    v.co = mapped.normalized() * R

# --- raise each tile into a little block -------------------------------------
bmesh.ops.inset_individual(
    bm, faces=list(bm.faces), thickness=INSET_THICKNESS, depth=INSET_DEPTH, use_even_offset=True
)
# side-wall faces (normal roughly tangent to the sphere) become dirt rims;
# raised tile tops keep their color because their normals stay radial
bm.normal_update()
for f in bm.faces:
    center = f.calc_center_median()
    if center.length > 0 and f.normal.dot(center.normalized()) < 0.7:
        f.material_index = DIRT

C.obj_from_bm("Globe", bm, mats)
C.export_glb("globe.glb")
