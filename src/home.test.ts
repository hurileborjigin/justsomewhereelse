import assert from "node:assert/strict";
import { test } from "node:test";
import { Group, Vector3 } from "three";
import type { Assets } from "./assets.ts";
import { footprintFor } from "./footprint.ts";
import { GALLERY, GALLERY_W } from "./gallery.ts";
import { homeSpot } from "./home.ts";
import { RoomWorld } from "./world.ts";

const room = new RoomWorld("hive", "hive", { room_hive: new Group() } as unknown as Assets);
const FACINGS = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];
const key = (i: number, j: number) => j * GALLERY_W + i;
const exit = GALLERY.exit;

function nearestBay(size: "s" | "m" | "l") {
  let best = GALLERY.bays.filter((b) => b.size === size)[0];
  let bestD = Infinity;
  for (const bay of GALLERY.bays) {
    if (bay.size !== size) continue;
    const d = Math.min(...bay.tiles.map(([i, j]) => Math.abs(i - exit[0]) + Math.abs(j - exit[1])));
    if (d < bestD) {
      best = bay;
      bestD = d;
    }
  }
  return best;
}

test("an empty room takes the S shelf nearest the door, the way a player would place it", () => {
  const spot = homeSpot("s", new Set());
  assert.ok(spot);
  const bay = nearestBay("s");
  assert.deepEqual(spot.tiles, bay.tiles.map(([i, j]) => key(i, j)));
  const placed = footprintFor(room, key(8, 38), new Vector3(0, 0, -1), "s", (k) => room.canHold(k));
  assert.deepEqual(spot.tiles, placed);
  assert.deepEqual(spot.fwd, [0, 0, -1]);
});

test("a taken shelf yields the next S shelf, still nearest the door", () => {
  const first = homeSpot("s", new Set())!;
  const spot = homeSpot("s", new Set(first.tiles));
  assert.ok(spot);
  assert.deepEqual(spot.tiles, [key(13, 37)]);
  assert.ok(footprintFor(room, key(13, 38), new Vector3(0, 0, -1), "s", (k) => room.canHold(k) && !first.tiles.includes(k)));
});

test("when every S shelf is taken, a small box uses the M bay nearest the door", () => {
  const taken = new Set(GALLERY.bays.filter((b) => b.size === "s").flatMap((b) => b.tiles.map(([i, j]) => key(i, j))));
  const spot = homeSpot("s", taken);
  assert.ok(spot);
  const bay = nearestBay("m");
  const inBay = spot.tiles.every((t) => bay.tiles.some(([i, j]) => key(i, j) === t));
  assert.equal(inBay, true);
  assert.deepEqual(spot.tiles, [key(9, 36)]);
  assert.deepEqual(spot.fwd, [-1, 0, 0]);
});

test("a large box takes the L bay nearest the door, and a full room refuses", () => {
  const spot = homeSpot("l", new Set());
  assert.ok(spot);
  const bay = nearestBay("l");
  assert.deepEqual([...spot.tiles].sort((a, b) => a - b), bay.tiles.map(([i, j]) => key(i, j)).sort((a, b) => a - b));
  let legal = false;
  for (let k = 0; k < GALLERY_W * 42 && !legal; k++) {
    for (const fwd of FACINGS) {
      const tiles = footprintFor(room, k, fwd, "l", (t) => room.canHold(t));
      if (tiles && [...tiles].sort((a, b) => a - b).join() === [...spot.tiles].sort((a, b) => a - b).join()) legal = true;
    }
  }
  assert.equal(legal, true);
  const full = new Set(GALLERY.bays.flatMap((b) => b.tiles.map(([i, j]) => key(i, j))));
  assert.equal(homeSpot("l", full), null);
  assert.equal(homeSpot("s", full), null);
});
