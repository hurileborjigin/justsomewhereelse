import assert from "node:assert/strict";
import { test } from "node:test";
import { Group, Scene, Vector3 } from "three";
import { BOX_SIZES, N, type BoxSize } from "../shared/protocol.ts";
import type { Assets } from "./assets.ts";
import { footprintCheck, footprintFor, footprintTiles } from "./footprint.ts";
import {
  SPAWN_TILES,
  TILE_COUNT,
  greatCircleDir,
  key,
  neighborInDirection,
  neighborsOf,
  spawnForward,
  tileCenter,
} from "./grid.ts";
import { GlobeWorld, RoomWorld, type World } from "./world.ts";

const fakeAssets = { room_house_a: new Group(), room_barn: new Group() } as unknown as Assets;
const galleryAssets = { room_hive: new Group() } as unknown as Assets;
const yes = () => true;

/** Row-major rectangle check: every tile touches its right and forward neighbor. */
function isRect(world: World, tiles: number[], cols: number) {
  const rows = tiles.length / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = tiles[r * cols + c];
      if (c + 1 < cols && !world.areNeighbors(k, tiles[r * cols + c + 1])) return false;
      if (r + 1 < rows && !world.areNeighbors(k, tiles[(r + 1) * cols + c])) return false;
    }
  }
  return true;
}

test("room: S and M from (2,2) facing the back wall", () => {
  const room = new RoomWorld("b0", "house_a", fakeAssets); // 6 x 5
  const fwd = new Vector3(0, 0, -1); // toward smaller j
  assert.deepEqual(footprintFor(room, room.key(2, 2), fwd, "s", yes), [room.key(2, 1)]);
  assert.deepEqual(footprintFor(room, room.key(2, 2), fwd, "m", yes), [
    room.key(2, 1),
    room.key(3, 1),
    room.key(2, 0),
    room.key(3, 0),
  ]);
});

test("room: walls and furniture stop a footprint", () => {
  const room = new RoomWorld("b0", "house_a", fakeAssets);
  const fwd = new Vector3(0, 0, -1);
  assert.equal(footprintFor(room, room.key(2, 0), fwd, "s", yes), null, "facing the wall");
  const free = (k: number) => !room.isBlockedFor(k, "donkey");
  // (1,1) is furniture in house_a: row 2 of an M from (1,3) lands on it
  assert.deepEqual(footprintFor(room, room.key(1, 3), fwd, "s", free), [room.key(1, 2)]);
  assert.equal(footprintFor(room, room.key(1, 3), fwd, "m", free), null);
});

test("room: L in the barn from (0,3) facing +X is 3 wide and 4 deep, centered", () => {
  const barn = new RoomWorld("b1", "barn", fakeAssets); // 6 x 8
  const got = footprintFor(barn, barn.key(0, 3), new Vector3(1, 0, 0), "l", yes);
  const want: number[] = [];
  for (let r = 1; r <= 4; r++) for (const c of [-1, 0, 1]) want.push(barn.key(r, 3 + c));
  assert.deepEqual(got, want);
  // (4,2) is furniture in the barn
  assert.equal(footprintFor(barn, barn.key(0, 3), new Vector3(1, 0, 0), "l", (k) => !barn.isBlockedFor(k, "donkey")), null);
});

test("gallery: footprintCheck applies the bay rule per tile", () => {
  const hive = new RoomWorld("hive", "hive", galleryAssets);
  const hold = (k: number) => hive.canHold(k);
  const westward = new Vector3(-1, 0, 0);
  // from the left aisle, an L box lands exactly in the first L bay (i 0..3, j 2..4)
  const lInL = footprintTiles(hive, hive.key(4, 3), westward, "l")!;
  assert.deepEqual(new Set(lInL.map((k) => hive.unkey(k)[0])), new Set([0, 1, 2, 3]));
  assert.deepEqual(new Set(lInL.map((k) => hive.unkey(k)[1])), new Set([2, 3, 4]));
  assert.deepEqual(footprintCheck(hive, lInL, "l", hold), lInL.map(() => true));
  assert.deepEqual(footprintFor(hive, hive.key(4, 3), westward, "l", hold), lInL);
  // a smaller box fits a bigger bay
  const mInL = footprintTiles(hive, hive.key(4, 3), westward, "m")!;
  assert.deepEqual(footprintCheck(hive, mInL, "m", hold), [true, true, true, true]);
  // an L box pushed over the S spine: shelves and pillars red, the aisle beyond green
  const lOverS = footprintTiles(hive, hive.key(11, 10), new Vector3(1, 0, 0), "l")!;
  const verdict = footprintCheck(hive, lOverS, "l", hold);
  lOverS.forEach((k, n) => assert.equal(verdict[n], hive.unkey(k)[0] >= 14, `tile ${hive.unkey(k)}`));
  assert.equal(footprintFor(hive, hive.key(11, 10), new Vector3(1, 0, 0), "l", hold), null);
  // open floor in the entrance hall: all green, and the caller's rule still counts
  const floor = footprintTiles(hive, hive.key(5, 41), new Vector3(0, 0, -1), "l")!;
  assert.deepEqual(footprintCheck(hive, floor, "l", hold), floor.map(() => true));
  const partner = floor[4];
  assert.deepEqual(
    footprintCheck(hive, floor, "l", (k) => k !== partner),
    floor.map((k) => k !== partner),
  );
});

test("footprintTiles ignores what stands on the tiles; footprintCheck reports it", () => {
  const room = new RoomWorld("b0", "house_a", fakeAssets);
  const fwd = new Vector3(0, 0, -1);
  const free = (k: number) => !room.isBlockedFor(k, "donkey");
  // (1,1) is furniture: the M from (1,3) still has its four tiles, one of them red
  const tiles = footprintTiles(room, room.key(1, 3), fwd, "m")!;
  assert.deepEqual(tiles, [room.key(1, 2), room.key(2, 2), room.key(1, 1), room.key(2, 1)]);
  assert.deepEqual(footprintCheck(room, tiles, "m", free), [true, true, false, true]);
  assert.equal(footprintTiles(room, room.key(2, 0), fwd, "s"), null, "no rectangle past the wall");
});

test("globe: all three sizes fit at the spawn and form rectangles", () => {
  const globe = new GlobeWorld(new Scene());
  const fwd = spawnForward(0);
  const s = footprintFor(globe, SPAWN_TILES[0], fwd, "s", yes)!;
  assert.deepEqual(s, [neighborInDirection(SPAWN_TILES[0], fwd)]);
  const m = footprintFor(globe, SPAWN_TILES[0], fwd, "m", yes)!;
  assert.equal(m.length, 4);
  assert.ok(isRect(globe, m, 2));
  const l = footprintFor(globe, SPAWN_TILES[0], fwd, "l", yes)!;
  assert.deepEqual(l, [663, 647, 631, 664, 648, 632, 665, 649, 633, 666, 650, 634]);
  assert.ok(isRect(globe, l, 3));
  assert.equal(new Set(l).size, 12);
});

test("globe: a free tile rule is honored", () => {
  const globe = new GlobeWorld(new Scene());
  const fwd = spawnForward(0);
  const front = neighborInDirection(SPAWN_TILES[0], fwd);
  assert.equal(footprintFor(globe, SPAWN_TILES[0], fwd, "s", (k) => k !== front), null);
});

test("globe survey: rectangles always close except right at the cube corners", () => {
  const globe = new GlobeWorld(new Scene());
  const corners: Vector3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(new Vector3(x, y, z).normalize());
  const tileAngle = Math.PI / 2 / N; // one tile of arc, roughly
  const dir = new Vector3();
  const survey = (size: BoxSize, maxFailDistTiles: number) => {
    const cols = BOX_SIZES[size].cols.length;
    let total = 0;
    let fails = 0;
    for (let k = 0; k < TILE_COUNT; k++) {
      for (const nb of neighborsOf(k)) {
        if (nb < 0) continue;
        total++;
        greatCircleDir(tileCenter(k), tileCenter(nb), dir);
        const fp = footprintFor(globe, k, dir, size, yes);
        if (!fp) {
          fails++;
          const dist = Math.min(...corners.map((c) => tileCenter(k).angleTo(c))) / tileAngle;
          assert.ok(dist < maxFailDistTiles, `${size} failed ${dist.toFixed(2)} tiles from a corner at tile ${k}`);
        } else {
          assert.equal(new Set(fp).size, fp.length, `duplicate tile in ${size} at ${k}`);
          assert.ok(isRect(globe, fp, cols), `${size} at ${k} is not a rectangle`);
        }
      }
    }
    return { total, fails };
  };
  assert.deepEqual(survey("m", 1.5), { total: 6144, fails: 48 });
  assert.deepEqual(survey("l", 3), { total: 6144, fails: 192 });
  // face centers never fail
  for (let f = 0; f < 6; f++) {
    const k = key(f, 7, 7);
    for (const nb of neighborsOf(k)) {
      greatCircleDir(tileCenter(k), tileCenter(nb), dir);
      assert.ok(footprintFor(globe, k, dir, "l", yes), `L should fit at the center of face ${f}`);
    }
  }
});
