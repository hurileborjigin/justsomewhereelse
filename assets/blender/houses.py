"""The two treasure houses: gloria's Hive and khurlee's Copper Hall.

Outside, each is a landmark two tiles long like the opera and the
Frauenkirche: origin at the footprint centre, long axis along Y, door on -Y.

Inside, both share one gallery layout, read from gallery.json (written by
`npm run models` from src/gallery.ts), in two skins. Room conventions as in
rooms.py: floor top at Z=0, room centred on the origin, door on the -Y wall,
single-sided walls facing inward, no ceiling, and tile (i, j) of a W x H room
at x=(i-(W-1)/2)*2, y=-(j-(H-1)/2)*2. Every bay gets a plinth PLINTH_H high
over its tiles and a blank plaque on its open side; every pillar tile gets a
pillar. Wall decoration protrudes little and has no back faces, so from
outside the camera still looks straight through the walls (dollhouse view).
"""

import json
import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

r = math.radians
HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "gallery.json"), encoding="utf8") as fh:
    LAYOUT = json.load(fh)

W, H = LAYOUT["w"], LAYOUT["h"]
PLINTH_H = LAYOUT["plinth"]
HX, HY = W, H  # half extents in units: a tile is 2 units
WALL_H = 6.0
WALL_OFF = 0.3  # the wall panels stand this far outside the last tile row
MARGIN = 0.12  # plinths stop this short of their tiles' edges
UP = Vector((0, 0, 1))
HEX = (0, 0, math.radians(30))  # turns a six-sided cylinder so its flat faces look along +-Y

# the open side of a bay, as a Blender direction (j grows toward -Y)
FACE_DIR = {"right": (1, 0), "left": (-1, 0), "up": (0, 1), "down": (0, -1)}


def tile_xy(i, j):
    return ((i - (W - 1) / 2) * 2, -(j - (H - 1) / 2) * 2)


def glow(name, strength):
    """A palette material that also glows in its own colour (lamps, windows)."""
    m = C.mat(name, 0.5)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Emission Color"].default_value = bsdf.inputs["Base Color"].default_value
    bsdf.inputs["Emission Strength"].default_value = strength
    return m


# --- geometry helpers --------------------------------------------------------


def frame_matrix(origin, normal):
    """Local X runs along the surface, local Y up, local Z along `normal`."""
    n = Vector(normal).normalized()
    x = UP.cross(n).normalized()
    m = Matrix.Identity(4)
    for row in range(3):
        m[row][0], m[row][1], m[row][2], m[row][3] = x[row], UP[row], n[row], origin[row]
    return m


def poly(b, material, pts, m, depth=0.0, back=False):
    """A flat polygon (counter-clockwise points in local XY) at local Z=depth,
    facing local +Z; with depth > 0 also its side walls down to Z=0, and the
    back cap only when asked (relief on a wall never needs one)."""
    tmp = bmesh.new()
    front = [tmp.verts.new(m @ Vector((x, y, depth))) for x, y in pts]
    if depth > 0:
        rear = [tmp.verts.new(m @ Vector((x, y, 0))) for x, y in pts]
        n = len(pts)
        for k in range(n):
            k1 = (k + 1) % n
            tmp.faces.new((rear[k], rear[k1], front[k1], front[k]))
        if back:
            tmp.faces.new(list(reversed(rear)))
    tmp.faces.new(front)
    b._merge_part(tmp, material)


def ngon(rad, n=6, cx=0.0, cy=0.0, start=0.0):
    return [
        (cx + rad * math.cos(start + 2 * math.pi * k / n), cy + rad * math.sin(start + 2 * math.pi * k / n))
        for k in range(n)
    ]


def arch_pts(w, h, segs=10):
    """A round-arched opening, base at local Y=0: straight sides, half-circle top."""
    hw = w / 2
    pts = [(-hw, 0.0), (hw, 0.0)]
    spring = h - hw
    for k in range(segs + 1):
        a = math.pi * k / segs
        pts.append((hw * math.cos(a), spring + hw * math.sin(a)))
    return pts


def annulus(b, material, m, r_out, r_in, segs=20, depth=0.0):
    """A flat ring facing local +Z, built as quads."""
    tmp = bmesh.new()
    outer = [tmp.verts.new(m @ Vector((x, y, depth))) for x, y in ngon(r_out, segs)]
    inner = [tmp.verts.new(m @ Vector((x, y, depth))) for x, y in ngon(r_in, segs)]
    for k in range(segs):
        k1 = (k + 1) % segs
        tmp.faces.new((inner[k], outer[k], outer[k1], inner[k1]))
    b._merge_part(tmp, material)


def rect(w, h, cx=0.0, cy=0.0):
    return [(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]


# --- the gallery room --------------------------------------------------------

WALLS = {
    # name: (origin of the inner face at floor level, inward normal, length)
    "far": ((0, HY + WALL_OFF, 0), (0, -1, 0), 2 * HX + 2 * WALL_OFF),
    "near": ((0, -HY - WALL_OFF, 0), (0, 1, 0), 2 * HX + 2 * WALL_OFF),
    "left": ((-HX - WALL_OFF, 0, 0), (1, 0, 0), 2 * HY + 2 * WALL_OFF),
    "right": ((HX + WALL_OFF, 0, 0), (-1, 0, 0), 2 * HY + 2 * WALL_OFF),
}


def wall_m(wall, s=0.0, z=0.0, d=0.0):
    """Frame on a wall's inner face: `s` along the wall (its local X), `z` up,
    `d` out into the room."""
    origin, normal, _ = WALLS[wall]
    base = frame_matrix(origin, normal)
    return base @ Matrix.Translation((s, z, d))


def s_of(wall, x, y):
    """The along-wall coordinate of a world point on that wall."""
    return {"far": x, "near": -x, "left": y, "right": -y}[wall]


def shell(b, floor_mat, wall_mat):
    b.box(floor_mat, (2 * HX + 0.7, 2 * HY + 0.7, 0.35), loc=(0, 0, -0.175))
    for wall, (_, _, length) in WALLS.items():
        poly(b, wall_mat, rect(length, WALL_H, 0, WALL_H / 2), wall_m(wall))


def band(b, material, z0, z1, d, walls=WALLS):
    """A flat horizontal strip around the walls (wainscot, rail, cornice)."""
    for wall in walls:
        length = WALLS[wall][2]
        poly(b, material, rect(length, z1 - z0, 0, (z0 + z1) / 2), wall_m(wall, d=d))


def door(b, frame_mat, leaf_mat, knob_mat, w=1.7, h=2.7):
    """The way out: a round-arched door on the near wall over the exit tile."""
    ex, _ = tile_xy(*LAYOUT["exit"])
    s = s_of("near", ex, 0)
    poly(b, frame_mat, arch_pts(w + 0.4, h + 0.2), wall_m("near", s, 0, 0.03))
    poly(b, leaf_mat, arch_pts(w, h), wall_m("near", s, 0, 0.05))
    # planks
    for k in (-1, 1):
        poly(b, frame_mat, rect(0.05, h - w / 2, k * w / 6, (h - w / 2) / 2), wall_m("near", s, 0, 0.06))
    b.uvsphere(knob_mat, 0.07, loc=(ex - 0.55, -HY - WALL_OFF + 0.14, 1.1), u=8, v=6)


def bay_rect(bay):
    iis = [t[0] for t in bay["tiles"]]
    jjs = [t[1] for t in bay["tiles"]]
    x0, y0 = tile_xy(min(iis), max(jjs))
    x1, y1 = tile_xy(max(iis), min(jjs))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    sx = (max(iis) - min(iis) + 1) * 2 - 2 * MARGIN
    sy = (max(jjs) - min(jjs) + 1) * 2 - 2 * MARGIN
    return cx, cy, sx, sy


def plinths(b, body_mat, trim_mat, plaque_mat, plaque_face_mat):
    """One plinth per bay, top exactly at PLINTH_H, with a trim band just under
    the top edge and a blank plaque low on the open side."""
    for bay in LAYOUT["bays"]:
        cx, cy, sx, sy = bay_rect(bay)
        b.box(body_mat, (sx, sy, PLINTH_H), loc=(cx, cy, PLINTH_H / 2))
        b.box(trim_mat, (sx + 0.06, sy + 0.06, 0.08), loc=(cx, cy, PLINTH_H - 0.05))
        b.box(trim_mat, (sx + 0.08, sy + 0.08, 0.06), loc=(cx, cy, 0.03))
        dx, dy = FACE_DIR[bay["faces"]]
        pw = 0.9 if bay["size"] != "s" else 0.6
        px = cx + dx * (sx / 2 + 0.02)
        py = cy + dy * (sy / 2 + 0.02)
        rot = (0, 0, r(90)) if dx else (0, 0, 0)
        b.box(plaque_mat, (pw, 0.05, 0.24), loc=(px, py, 0.24), rot=rot)
        b.box(plaque_face_mat, (pw - 0.1, 0.05, 0.15), loc=(px + dx * 0.015, py + dy * 0.015, 0.24), rot=rot)


# --- the Hive -----------------------------------------------------------------


def honeycomb(b, wall, s, z, cols, rows, cell, mats, glow_cells=(), skip=(), depth=0.12):
    """A cluster of flat-topped hexagonal cells in relief on a wall (flat
    when depth is 0, for the near wall the camera looks in through)."""
    dx = 1.5 * cell + 0.08
    dz = math.sqrt(3) * cell + 0.08
    for c in range(cols):
        for rr in range(rows):
            if (c, rr) in skip:
                continue
            u = s + (c - (cols - 1) / 2) * dx
            v = z + (rr - (rows - 1) / 2) * dz + (dz / 2 if c % 2 else 0)
            material = glow_cells[1] if (c, rr) in glow_cells[0] else mats[(c + rr) % len(mats)]
            poly(b, material, ngon(cell, 6), wall_m(wall, u, v, 0.02), depth=depth)


def hive_room():
    b = C.Build("RoomHive")
    honey = C.mat("honey", 0.6)
    light = C.mat("honey_light", 0.6)
    dark = C.mat("honey_dark", 0.7)
    stone = C.mat("honey_stone", 0.85)
    stone_dark = C.mat("honey_stone_dark", 0.85)
    gold = C.mat("gold", 0.35)
    amber = glow("amber", 1.6)
    shell(b, C.mat("honey_floor", 0.8), C.mat("honey_wall", 0.9))
    # wainscot, a gold rail and a honey cornice
    band(b, dark, 0, 1.4, 0.01)
    band(b, gold, 1.4, 1.52, 0.015)
    band(b, dark, WALL_H - 0.5, WALL_H, 0.01)
    band(b, gold, WALL_H - 0.62, WALL_H - 0.5, 0.015)
    # a honey runner up the middle aisle from the door
    ex, _ = tile_xy(*LAYOUT["exit"])
    runner_x = ex + 1  # the aisle is the exit column and the one to its right
    b.box(dark, (3.2, 2 * HY - 1.2, 0.03), loc=(runner_x, 0, 0.015))
    b.box(honey, (2.6, 2 * HY - 1.8, 0.035), loc=(runner_x, 0, 0.0175))
    for k in range(-19, 20, 2):  # hexagon inlays along the runner
        b.cylinder(light, 0.5, 0.04, segments=6, loc=(runner_x, k * 2.0, 0.02))
    # honeycomb relief above every wall bay, lamps between them
    cells = [honey, light]
    for bay in (bay for bay in LAYOUT["bays"] if bay["size"] == "l"):
        cx, cy, _, _ = bay_rect(bay)
        wall = "left" if cx < 0 else "right"
        seed = bay["id"]
        glowing = {((seed * 3) % 5, (seed * 2) % 3), ((seed + 2) % 5, (seed + 1) % 3)}
        honeycomb(b, wall, s_of(wall, cx, cy), 3.6, 5, 3, 0.42, cells, (glowing, amber), skip={(0, 2), (4, 2)})
    # lamps on the pillar rows along both long walls, and at the entrance hall
    lamp_ys = sorted({tile_xy(i, j)[1] for i, j in LAYOUT["pillars"] if i == 0})
    lamp_ys += [tile_xy(0, 38)[1], tile_xy(0, 1)[1]]
    for wall in ("left", "right"):
        for y in lamp_ys:
            sconce(b, wall, s_of(wall, 0, y), 3.3, gold, amber, dark)
    # the far wall: a great honeycomb crest in the middle, lamps and smaller
    # combs across the rest
    honeycomb(b, "far", 0, 3.6, 9, 4, 0.5, cells, ({(4, 1), (3, 2), (5, 1), (4, 2)}, amber),
              skip={(0, 3), (8, 3), (0, 0), (8, 0)})
    for s in (-14, 14):
        honeycomb(b, "far", s, 3.6, 5, 3, 0.42, cells, ({(2, 1)}, amber), skip={(0, 2), (4, 2)})
    for s in (-19, -8, 8, 19):
        sconce(b, "far", s, 3.3, gold, amber, dark)
    # near wall: flat honeycomb either side of the door (no relief and no
    # lamps, so nothing shows when the camera looks in through this wall)
    for s in (-10, 10):
        honeycomb(b, "near", s, 3.6, 5, 3, 0.42, cells, (set(), amber), skip={(0, 2), (4, 2)}, depth=0)
    door(b, gold, C.mat("honey_dark", 0.8), gold)

    plinths(b, stone, stone_dark, gold, C.mat("honey_light", 0.5))
    for run in pillar_runs():
        (x0, y), (x1, _) = tile_xy(*run[0]), tile_xy(*run[-1])
        divider(b, x0, x1, y, 1.0 if len(run) > 2 else 0.7, stone, stone_dark, gold)
        if len(run) > 2:  # a grand column at each end of the row
            for x in (x0, x1):
                b.cylinder(stone_dark, 0.62, 0.3, segments=6, loc=(x, y, 0.15))
                b.cylinder(stone, 0.44, 2.4, segments=6, loc=(x, y, 1.5))
                b.cylinder(dark, 0.47, 0.1, segments=6, loc=(x, y, 1.0))
                b.cylinder(gold, 0.6, 0.18, segments=6, loc=(x, y, 2.79))
                b.cylinder(stone, 0.5, 0.12, segments=6, loc=(x, y, 2.94))
        else:  # between the small shelves, lantern posts
            for i, j in run:
                x, _ = tile_xy(i, j)
                b.cylinder(stone_dark, 0.42, 0.24, segments=6, loc=(x, y, 0.12))
                b.cylinder(stone, 0.2, 1.3, segments=6, loc=(x, y, 0.85))
                b.cylinder(gold, 0.26, 0.08, segments=6, loc=(x, y, 1.52))
                b.cylinder(amber, 0.2, 0.34, segments=6, loc=(x, y, 1.73))
                b.cone(gold, 0.27, 0.04, 0.2, segments=6, loc=(x, y, 2.0))
    b.obj()


def pillar_runs():
    """Pillar tiles grouped into rows of neighbours along X."""
    runs = []
    for i, j in sorted(map(tuple, LAYOUT["pillars"]), key=lambda t: (t[1], t[0])):
        if runs and runs[-1][-1][1] == j and runs[-1][-1][0] == i - 1:
            runs[-1].append((i, j))
        else:
            runs.append([(i, j)])
    return runs


def divider(b, x0, x1, y, h, body, base, cap):
    """A low screen along a row of pillar tiles."""
    length = x1 - x0 + 1.2
    cx = (x0 + x1) / 2
    b.box(base, (length + 0.1, 0.62, 0.16), loc=(cx, y, 0.08))
    b.box(body, (length, 0.44, h), loc=(cx, y, h / 2))
    b.box(cap, (length + 0.08, 0.56, 0.08), loc=(cx, y, h + 0.04))


def sconce(b, wall, s, z, metal, light_mat, dark):
    """A wall lamp: a little bracket and a glowing hexagonal lantern."""
    _, normal, _ = WALLS[wall]
    base = wall_m(wall, s, z, 0) @ Vector((0, 0, 0))
    n = Vector(normal)
    poly(b, dark, ngon(0.28, 6, start=r(90)), wall_m(wall, s, z, 0.01), depth=0.05)
    b.cylinder(metal, 0.05, 0.4, segments=6, loc=base + n * 0.2, rot=(r(90), 0, math.atan2(n.y, n.x) + r(90)))
    lamp = base + n * 0.42 + Vector((0, 0, 0.1))
    b.cylinder(light_mat, 0.2, 0.42, segments=6, loc=lamp)
    b.cone(metal, 0.26, 0.05, 0.18, segments=6, loc=lamp + Vector((0, 0, 0.3)))
    b.cylinder(metal, 0.22, 0.06, segments=6, loc=lamp - Vector((0, 0, 0.24)))


# --- the Copper Hall ----------------------------------------------------------


def round_window(b, wall, s, z, rad, copper, glass, dark):
    poly(b, dark, ngon(rad * 1.25, 24), wall_m(wall, s, z, 0.01))
    annulus(b, copper, wall_m(wall, s, z, 0.03), rad * 1.15, rad, segs=24)
    poly(b, glass, ngon(rad, 24), wall_m(wall, s, z, 0.02))
    poly(b, copper, rect(0.1, 2 * rad), wall_m(wall, s, z, 0.035))
    poly(b, copper, rect(2 * rad, 0.1), wall_m(wall, s, z, 0.035))


def hall_room():
    b = C.Build("RoomHall")
    brick = C.mat("dark_brick", 0.95)
    brick2 = C.mat("dark_brick_2", 0.95)
    slate = C.mat("slate", 0.8)
    slate_l = C.mat("slate_light", 0.8)
    copper = C.mat("copper", 0.45)
    copper_d = C.mat("copper_dark", 0.5)
    glass = glow("window_glow", 1.2)
    shell(b, C.mat("slate_dark", 0.8), brick)
    # darker brick wainscot, copper rail, copper cornice; brick courses between
    band(b, brick2, 0, 1.3, 0.01)
    band(b, copper, 1.3, 1.42, 0.015)
    for z in (2.2, 3.0, 4.7):
        band(b, brick2, z, z + 0.06, 0.012)
    band(b, copper_d, WALL_H - 0.45, WALL_H, 0.01)
    band(b, copper, WALL_H - 0.57, WALL_H - 0.45, 0.015)
    # a lighter slate runner up the middle aisle, edged in copper
    ex, _ = tile_xy(*LAYOUT["exit"])
    runner_x = ex + 1
    b.box(copper_d, (3.2, 2 * HY - 1.2, 0.03), loc=(runner_x, 0, 0.015))
    b.box(slate_l, (2.9, 2 * HY - 1.5, 0.035), loc=(runner_x, 0, 0.0175))
    # brick pilasters on the pillar rows, round windows above every wall bay
    pil_ys = sorted({tile_xy(i, j)[1] for i, j in LAYOUT["pillars"] if i == 0})
    for wall in ("left", "right"):
        for y in pil_ys + [tile_xy(0, 38)[1], tile_xy(0, 1)[1]]:
            s = s_of(wall, 0, y)
            poly(b, brick2, rect(1.0, WALL_H - 0.6, 0, (WALL_H - 0.6) / 2), wall_m(wall, s, 0, 0.01), depth=0.2)
            poly(b, copper, rect(1.2, 0.18, 0, WALL_H - 0.7), wall_m(wall, s, 0, 0.01), depth=0.26)
        for bay in LAYOUT["bays"]:
            if bay["size"] != "l":
                continue
            cx, cy, _, _ = bay_rect(bay)
            if (cx < 0) != (wall == "left"):
                continue
            round_window(b, wall, s_of(wall, cx, cy), 3.7, 1.0, copper, glass, brick2)
    # the far wall: a great round window in the middle, smaller ones beside
    round_window(b, "far", 0, 3.5, 1.7, copper, glass, brick2)
    for s in (-12, -6, 6, 12):
        round_window(b, "far", s, 3.7, 0.9, copper, glass, brick2)
    for s in (-17.4, -3, 3, 17.4):
        poly(b, brick2, rect(1.0, WALL_H - 0.6, 0, (WALL_H - 0.6) / 2), wall_m("far", s, 0, 0.01), depth=0.2)
        poly(b, copper, rect(1.2, 0.18, 0, WALL_H - 0.7), wall_m("far", s, 0, 0.01), depth=0.26)
    # near wall: flat round windows either side of the door
    for s in (-10, 10):
        round_window(b, "near", s, 3.7, 0.9, copper, glass, brick2)
    door(b, copper_d, C.mat("timber", 0.85), copper)

    plinths(b, slate, copper, copper_d, slate_l)
    for run in pillar_runs():
        (x0, y), (x1, _) = tile_xy(*run[0]), tile_xy(*run[-1])
        divider(b, x0, x1, y, 1.0 if len(run) > 2 else 0.7, brick, slate, copper)
        if len(run) > 2:  # a brick pier at each end of the row
            for x in (x0, x1):
                b.box(slate, (1.2, 1.2, 0.25), loc=(x, y, 0.125))
                b.box(brick, (0.86, 0.86, 2.5), loc=(x, y, 1.5))
                b.box(brick2, (0.9, 0.9, 0.08), loc=(x, y, 1.1))
                b.box(copper, (1.1, 1.1, 0.16), loc=(x, y, 2.8))
                b.box(slate, (1.0, 1.0, 0.1), loc=(x, y, 2.93))
        else:  # between the small shelves, short brick posts with copper caps
            for i, j in run:
                x, _ = tile_xy(i, j)
                b.box(slate, (0.8, 0.8, 0.2), loc=(x, y, 0.1))
                b.box(brick, (0.52, 0.52, 1.4), loc=(x, y, 0.8))
                b.box(copper, (0.66, 0.66, 0.1), loc=(x, y, 1.55))
                b.uvsphere(copper, 0.18, loc=(x, y, 1.72), u=8, v=6)
    b.obj()


# --- outsides -----------------------------------------------------------------


def hex_windows(b, centre, apothem, angle, z, cell, frame_mat, glass, single=False):
    """Three honeycomb windows (or one) on one face of a hexagonal wall."""
    n = Vector((math.cos(angle), math.sin(angle), 0))
    origin = Vector(centre) + n * apothem
    m = frame_matrix(origin, n)
    # pointy-topped cells whose frames just touch, two below and one above
    fr = cell * 1.25
    half_w = math.sqrt(3) / 2 * fr
    spots = ((0, 0),) if single else ((-half_w, 0), (half_w, 0), (0, 1.5 * fr))
    for u, v in spots:
        pts = ngon(cell, 6, start=r(30))
        poly(b, frame_mat, ngon(fr, 6, start=r(30), cx=u, cy=z + v), m, depth=0.02)
        poly(b, glass, [(x + u, y + z + v) for x, y in pts], m, depth=0.035)


def hive():
    b = C.Build("Hive")
    honey = C.mat("honey", 0.6)
    light = C.mat("honey_light", 0.6)
    dark = C.mat("honey_dark", 0.7)
    stone = C.mat("honey_stone", 0.85)
    gold = C.mat("gold", 0.35)
    amber = glow("amber", 1.4)
    # a honey-stone podium with steps to the door
    b.box(stone, (1.9, 3.3, 0.16), loc=(0, 0.2, 0.08), bevel=0.03)
    for k, y in enumerate((-1.52, -1.68)):
        b.box(stone, (0.9, 0.18, 0.16 - k * 0.07), loc=(0, y, (0.16 - k * 0.07) / 2))
    # the tall hexagonal pavilion, banded like a skep
    ty, tr, th = 0.65, 0.9, 2.1
    b.cylinder(honey, tr, th, segments=6, rot=HEX, loc=(0, ty, 0.16 + th / 2))
    for z in (0.45, 1.89):
        b.cylinder(dark, tr + 0.03, 0.07, segments=6, rot=HEX, loc=(0, ty, 0.16 + z))
    b.cylinder(light, tr + 0.1, 0.12, segments=6, rot=HEX, loc=(0, ty, 0.16 + th + 0.06))
    # hexagonal dome: a six-sided sphere so its ribs meet the walls' corners
    b.uvsphere(gold, tr * 0.92, loc=(0, ty, 0.16 + th + 0.1), rot=HEX, scale=(1, 1, 0.9), u=6, v=8)
    dome_r, dome_z = tr * 0.92, 0.16 + th + 0.1
    for lat in (22.5, 45):  # skep coils on the dome, on its latitude rings
        b.cylinder(dark, dome_r * math.cos(r(lat)) + 0.02, 0.05, segments=6, rot=HEX,
                   loc=(0, ty, dome_z + 0.9 * dome_r * math.sin(r(lat))))
    top = dome_z + dome_r * 0.9
    b.cylinder(dark, 0.05, 0.22, segments=6, rot=HEX, loc=(0, ty, top + 0.08))
    bee_finial(b, (0, ty, top + 0.3))
    ap = tr * math.cos(r(30))
    for k in range(6):
        ang = r(30 + 60 * k)
        if abs(math.sin(ang) + 1) < 1e-6:  # the vestibule covers the front face
            hex_windows(b, (0, ty, 0), ap, ang, 1.86, 0.12, dark, amber, single=True)
        else:
            hex_windows(b, (0, ty, 0), ap, ang, 1.2, 0.16, dark, amber)
    # the vestibule: a smaller hexagon in front with its own little dome
    vy, vr, vh = -0.72, 0.6, 1.05
    b.cylinder(honey, vr, vh, segments=6, rot=HEX, loc=(0, vy, 0.16 + vh / 2))
    b.cylinder(dark, vr + 0.03, 0.06, segments=6, rot=HEX, loc=(0, vy, 0.16 + 0.45))
    b.cylinder(light, vr + 0.08, 0.1, segments=6, rot=HEX, loc=(0, vy, 0.16 + vh + 0.05))
    b.uvsphere(gold, vr * 0.88, loc=(0, vy, 0.16 + vh + 0.08), rot=HEX, scale=(1, 1, 0.8), u=6, v=8)
    vtop = 0.16 + vh + 0.08 + vr * 0.88 * 0.8
    b.uvsphere(dark, 0.06, loc=(0, vy, vtop + 0.04), u=8, v=6)
    vap = vr * math.cos(r(30))
    # round arched door on the vestibule's front face
    fm = frame_matrix(Vector((0, vy, 0.16)) + Vector((0, -1, 0)) * vap, (0, -1, 0))
    poly(b, dark, arch_pts(0.5, 0.8), fm, depth=0.04)
    poly(b, C.mat("trunk", 0.8), arch_pts(0.38, 0.72), fm, depth=0.06)
    b.uvsphere(gold, 0.03, loc=(0.1, vy - vap - 0.06, 0.16 + 0.34), u=8, v=6)
    # small honeycomb windows on the vestibule's side faces
    for ang in (r(210), r(330)):
        hex_windows(b, (0, vy, 0), vap, ang, 0.84, 0.09, dark, amber)
    b.obj()


def bee_finial(b, loc):
    x, y, z = loc
    b.uvsphere(C.mat("bee_yellow", 0.6), 0.12, loc=(x, y, z), scale=(0.8, 1.2, 0.8), u=10, v=8)
    b.cylinder(C.mat("black", 0.7), 0.1, 0.05, segments=10, loc=(x, y + 0.03, z), rot=(r(90), 0, 0))
    for sx in (-1, 1):
        b.uvsphere(C.mat("white", 0.4), 0.08, loc=(x + sx * 0.08, y + 0.02, z + 0.1),
                   rot=(0, sx * r(30), 0), scale=(1, 0.6, 0.3), u=8, v=6)


def hall():
    b = C.Build("Hall")
    brick = C.mat("dark_brick", 0.95)
    brick2 = C.mat("dark_brick_2", 0.95)
    copper = C.mat("copper", 0.45)
    copper_d = C.mat("copper_dark", 0.5)
    stone = C.mat("slate_light", 0.85)
    glass = glow("window_glow", 1.3)
    bw, bl, bh, base = 1.5, 3.3, 1.2, 0.14
    b.box(stone, (1.8, 3.7, base), loc=(0, 0, base / 2), bevel=0.03)
    for k, y in enumerate((-1.93, -2.08)):
        b.box(stone, (0.8, 0.16, base - k * 0.06), loc=(0, y, (base - k * 0.06) / 2))
    b.box(brick, (bw, bl, bh), loc=(0, 0, base + bh / 2))
    # plinth course and buttresses
    b.box(brick2, (bw + 0.06, bl + 0.06, 0.14), loc=(0, 0, base + 0.07))
    for y in (-1.6, -0.55, 0.55, 1.6):
        for x in (-1, 1):
            b.box(brick2, (0.12, 0.2, bh - 0.05), loc=(x * (bw / 2 + 0.05), y, base + (bh - 0.05) / 2))
    # round windows between the buttresses, three a side
    for y in (-1.08, 0, 1.08):
        for x in (-1, 1):
            loc = (x * (bw / 2 + 0.01), y, base + 0.7)
            b.cylinder(copper, 0.2, 0.05, segments=16, loc=loc, rot=(0, r(90), 0))
            b.cylinder(glass, 0.15, 0.07, segments=16, loc=loc, rot=(0, r(90), 0))
    # brick gables and a green copper roof
    eave = base + bh
    rise = 0.72
    tri = [(-bw / 2, 0), (bw / 2, 0), (0, rise)]
    poly(b, brick, tri, frame_matrix(Vector((0, bl / 2, eave)), (0, -1, 0)), depth=bl, back=True)
    half = bw / 2 + 0.14
    slope = math.atan2(rise, bw / 2)
    slab = math.hypot(half, rise * half / (bw / 2)) + 0.02
    for sx in (-1, 1):
        cx = sx * half / 2
        cz = eave + rise - (rise * half / (bw / 2)) / 2 + 0.03
        b.box(copper, (slab, bl + 0.3, 0.07), loc=(cx, 0, cz), rot=(0, sx * slope, 0))
        b.box(copper_d, (0.06, bl + 0.32, 0.06), loc=(sx * (half - 0.02), 0, eave + rise * (1 - half / (bw / 2))))
    b.cylinder(copper_d, 0.06, bl + 0.34, segments=8, loc=(0, 0, eave + rise + 0.06), rot=(r(90), 0, 0))
    # an oculus in each gable
    for sy in (-1, 1):
        loc = (0, sy * (bl / 2 + 0.01), eave + 0.26)
        b.cylinder(copper, 0.18, 0.05, segments=16, loc=loc, rot=(r(90), 0, 0))
        b.cylinder(glass, 0.13, 0.07, segments=16, loc=loc, rot=(r(90), 0, 0))
    # the cupola on the ridge
    cy, ctop = 0.35, eave + rise
    b.box(brick, (0.42, 0.42, 0.42), loc=(0, cy, ctop + 0.1))
    b.box(copper_d, (0.5, 0.5, 0.05), loc=(0, cy, ctop + 0.33))
    for k in range(4):
        a = r(90 * k)
        n = Vector((math.cos(a), math.sin(a), 0))
        fm = frame_matrix(Vector((0, cy, ctop + 0.02)) + n * 0.211, n)
        poly(b, glass, arch_pts(0.14, 0.24, segs=6), fm, depth=0.01)
    b.uvsphere(copper, 0.25, loc=(0, cy, ctop + 0.35), scale=(1, 1, 1.1), u=8, v=8)
    b.cylinder(copper_d, 0.025, 0.3, segments=6, loc=(0, cy, ctop + 0.72))
    b.uvsphere(C.mat("gold", 0.35), 0.05, loc=(0, cy, ctop + 0.89), u=8, v=6)
    # arched timber door on the -Y gable, copper-framed, with two lanterns
    fm = frame_matrix(Vector((0, -bl / 2, base)), (0, -1, 0))
    poly(b, copper_d, arch_pts(0.62, 0.92), fm, depth=0.03)
    poly(b, C.mat("timber", 0.85), arch_pts(0.48, 0.84), fm, depth=0.05)
    for x in (-0.08, 0.08):
        poly(b, brick2, rect(0.02, 0.6, x, 0.3), fm, depth=0.06)
    for x in (-0.46, 0.46):
        b.box(copper_d, (0.12, 0.12, 0.03), loc=(x, -bl / 2 - 0.08, base + 0.95))
        b.cylinder(glass, 0.05, 0.14, segments=6, loc=(x, -bl / 2 - 0.08, base + 0.86))
        b.cone(copper_d, 0.08, 0.01, 0.08, segments=6, loc=(x, -bl / 2 - 0.08, base + 0.97))
    b.obj()


for name, build in (
    ("hive", hive),
    ("hall", hall),
    ("room_hive", hive_room),
    ("room_hall", hall_room),
):
    C.reset_scene()
    build()
    C.export_glb(f"{name}.glb")
