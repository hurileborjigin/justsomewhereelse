"""The tile planet: an equal-angle spherified cube, 6 x N x N square tiles.

The vertex mapping AND the face->tile addressing here MUST stay identical to
src/grid.ts (FACES / tileCenter / tileAt), so the squares you see are exactly
the squares the game logic uses - the lake below is placed by (face, i, j)
coordinates shared with shared/protocol.ts. Land tiles are inset + raised into
little blocks (checkerboard greens, sand patches, dirt rims); lake tiles are
inset + SUNKEN and blue, with a sand beach around them.
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

# keep in sync with LAKE in shared/protocol.ts
LAKE = {(2, 3, 3), (2, 4, 3), (2, 5, 3), (2, 3, 4), (2, 4, 4), (2, 5, 4), (2, 4, 5), (2, 5, 5)}

# keep in sync with FACES in src/grid.ts: (normal, a-axis, b-axis) per face
FACES = [
    ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
    ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    ((0, 1, 0), (1, 0, 0), (0, 0, -1)),
    ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
    ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    ((0, 0, -1), (-1, 0, 0), (0, 1, 0)),
]

C.reset_scene()

bm = bmesh.new()
bmesh.ops.create_cube(bm, size=2.0)
bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=N - 1, use_grid_fill=True)

mats = [C.mat("grass"), C.mat("grass_2"), C.mat("sand"), C.mat("dirt"), C.mat("water", 0.2)]
SAND = 2
DIRT = 3
WATER = 4

# --- tile addressing on the flat cube (before spherifying) -------------------
bm.faces.ensure_lookup_table()


def tile_fij(face):
    c = face.calc_center_median()
    ax, ay, az = abs(c.x), abs(c.y), abs(c.z)
    if ax >= ay and ax >= az:
        f = 0 if c.x >= 0 else 1
    elif ay >= ax and ay >= az:
        f = 2 if c.y >= 0 else 3
    else:
        f = 4 if c.z >= 0 else 5
    _, a, b = FACES[f]
    u = c.x * a[0] + c.y * a[1] + c.z * a[2]
    v = c.x * b[0] + c.y * b[1] + c.z * b[2]
    i = min(N - 1, max(0, int((u + 1) / 2 * N)))
    j = min(N - 1, max(0, int((v + 1) / 2 * N)))
    return f, i, j


# checkerboard base
for f in bm.faces:
    ff, i, j = tile_fij(f)
    f.material_index = (i + j) % 2

# a few seeded sand patches (cosmetic)
rng = random.Random(42)
for seed_face in rng.sample(list(bm.faces), 9):
    patch = {seed_face}
    for e in seed_face.edges:
        patch.update(e.link_faces)
    for f in patch:
        if rng.random() < 0.85:
            f.material_index = SAND

# the lake, with a sandy beach on every land tile touching it
lake_faces = [f for f in bm.faces if tile_fij(f) in LAKE]
for f in lake_faces:
    f.material_index = WATER
for f in lake_faces:
    for e in f.edges:
        for nb in e.link_faces:
            if nb.material_index != WATER:
                nb.material_index = SAND

# --- spherify: equal-angle cube-sphere, same formula as src/grid.ts ----------
for v in bm.verts:
    co = v.co
    d = max(range(3), key=lambda k: abs(co[k]))
    mapped = Vector((0.0, 0.0, 0.0))
    for k in range(3):
        mapped[k] = co[k] if k == d else math.tan(A * co[k])
    v.co = mapped.normalized() * R

# --- raise land tiles into little blocks, sink the lake ----------------------
land = [f for f in bm.faces if f.material_index != WATER]
lake = [f for f in bm.faces if f.material_index == WATER]
bmesh.ops.inset_individual(bm, faces=land, thickness=0.05, depth=0.06, use_even_offset=True)
bmesh.ops.inset_individual(bm, faces=lake, thickness=0.04, depth=-0.05, use_even_offset=True)

# side-wall faces (normal roughly tangent to the sphere) become dirt rims;
# tile tops keep their color because their normals stay radial
bm.normal_update()
for f in bm.faces:
    if f.material_index == WATER:
        continue
    center = f.calc_center_median()
    if center.length > 0 and f.normal.dot(center.normalized()) < 0.7:
        f.material_index = DIRT

C.obj_from_bm("Globe", bm, mats)
C.export_glb("globe.glb")
