// The first free bay in a treasure house, the way a player would have placed
// the box: smallest bay that fits, then the one nearest the door.

import { Group, Vector3 } from "three";
import type { BoxSize, Vec3 } from "../shared/protocol.ts";
import type { Assets } from "./assets.ts";
import { footprintFor } from "./footprint.ts";
import { GALLERY, GALLERY_W, bayAt, type Bay } from "./gallery.ts";
import { RoomWorld } from "./world.ts";

const FACINGS = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];
const RANK: Record<BoxSize, number> = { s: 0, m: 1, l: 2 };

let hall: RoomWorld | null = null;

function room(): RoomWorld {
  hall ??= new RoomWorld("hive", "hive", { room_hive: new Group() } as unknown as Assets);
  return hall;
}

const INTO: Record<Bay["faces"], Vec3> = {
  right: [-1, 0, 0],
  left: [1, 0, 0],
  down: [0, 0, -1],
  up: [0, 0, 1],
};

type Spot = { rank: number; depth: number; aisle: number; tileDepth: number; open: number; id: number; tiles: number[]; fwd: Vec3 };

function better(a: Spot, b: Spot): boolean {
  return (
    a.rank < b.rank ||
    (a.rank === b.rank && a.depth < b.depth) ||
    (a.rank === b.rank && a.depth === b.depth && a.aisle < b.aisle) ||
    (a.rank === b.rank && a.depth === b.depth && a.aisle === b.aisle && a.tileDepth < b.tileDepth) ||
    (a.rank === b.rank && a.depth === b.depth && a.aisle === b.aisle && a.tileDepth === b.tileDepth && a.open < b.open) ||
    (a.rank === b.rank && a.depth === b.depth && a.aisle === b.aisle && a.tileDepth === b.tileDepth && a.open === b.open && a.id < b.id)
  );
}

/** Tiles and facing for `size` in a treasure house, or null when no bay fits. */
export function homeSpot(size: BoxSize, taken: ReadonlySet<number>): { tiles: number[]; fwd: Vec3 } | null {
  const world = room();
  const [ei, ej] = GALLERY.exit;
  let best: Spot | null = null;
  for (let k = 0; k < GALLERY_W * GALLERY.h; k++) {
    if (world.isBlockedFor(k, "donkey") || k === world.exitTile) continue;
    for (const facing of FACINGS) {
      const tiles = footprintFor(world, k, facing, size, (t) => world.canHold(t) && !taken.has(t));
      if (!tiles) continue;
      const coords = tiles.map((t) => world.unkey(t));
      const bay = bayAt(coords[0][0], coords[0][1]);
      if (!bay || RANK[bay.size] < RANK[size]) continue;
      if (!coords.every(([i, j]) => bayAt(i, j) === bay)) continue;
      const fwd: Vec3 = [facing.x, facing.y, facing.z];
      const want = INTO[bay.faces];
      const cand: Spot = {
        rank: RANK[bay.size],
        depth: ej - Math.max(...bay.tiles.map(([, j]) => j)),
        aisle: Math.min(...bay.tiles.map(([i]) => Math.abs(i - ei))),
        tileDepth: ej - Math.max(...coords.map(([, j]) => j)),
        open: fwd[0] === want[0] && fwd[1] === want[1] && fwd[2] === want[2] ? 0 : 1,
        id: bay.id,
        tiles,
        fwd,
      };
      if (!best || better(cand, best)) best = cand;
    }
  }
  return best ? { tiles: best.tiles, fwd: best.fwd } : null;
}
