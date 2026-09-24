import assert from "node:assert/strict";
import { test } from "node:test";
import { Group, Scene, Vector3 } from "three";
import type { Assets } from "./assets.ts";
import { footprintCheck, footprintTiles } from "./footprint.ts";
import { GALLERY, GALLERY_H, GALLERY_W, PLINTH_H, bayAt, isPillar } from "./gallery.ts";
import { SPAWN_TILES, TILE_COUNT, isFree, neighborsOf } from "./grid.ts";
import { GlobeWorld, ROOM_SPECS, RoomWorld, nearestFreeTile } from "./world.ts";

// RoomWorld only clones the room model; an empty Group is enough here.
const fakeAssets = { room_house_a: new Group() } as unknown as Assets;

test("globe: neighbors drop the -1 entries and setBlocked toggles walkability", () => {
  const globe = new GlobeWorld(new Scene());
  const k = SPAWN_TILES[0];
  assert.deepEqual(globe.neighbors(k), neighborsOf(k).filter((n) => n >= 0));
  assert.equal(globe.isBlockedFor(k, "donkey"), false);
  globe.setBlocked([k], true);
  assert.equal(globe.isBlockedFor(k, "donkey"), true);
  assert.equal(globe.isBlockedFor(k, "bee"), true, "boxes stop flyers too");
  assert.equal(isFree(k), false, "scatter placement sees the box");
  globe.setBlocked([k], false);
  assert.equal(globe.isBlockedFor(k, "donkey"), false);
});

test("room: neighbors stay inside the grid and boxes never unblock furniture", () => {
  const room = new RoomWorld("b0", "house_a", fakeAssets);
  const { w } = ROOM_SPECS.house_a;
  const corner = room.key(0, 0);
  assert.deepEqual(room.neighbors(corner).sort(), [room.key(1, 0), room.key(0, 1)].sort());
  assert.equal(room.neighbors(room.key(2, 2)).length, 4);
  const furniture = room.key(1, 1); // blocked in ROOM_SPECS.house_a
  assert.equal(room.isBlockedFor(furniture, "donkey"), true);
  room.setBlocked([furniture, room.key(2, 2)], true);
  room.setBlocked([furniture, room.key(2, 2)], false);
  assert.equal(room.isBlockedFor(furniture, "donkey"), true, "furniture survives a box being picked up");
  assert.equal(room.isBlockedFor(room.key(2, 2), "donkey"), false);
  assert.equal(w, 6);
});

test("hasTile: only keys that exist in the world", () => {
  const globe = new GlobeWorld(new Scene());
  assert.equal(globe.hasTile(0), true);
  assert.equal(globe.hasTile(TILE_COUNT - 1), true);
  assert.equal(globe.hasTile(TILE_COUNT), false);
  assert.equal(globe.hasTile(-1), false);
  assert.equal(globe.hasTile(1.5), false);
  const room = new RoomWorld("b0", "house_a", fakeAssets);
  const { w, h } = ROOM_SPECS.house_a;
  assert.equal(room.hasTile(w * h - 1), true);
  assert.equal(room.hasTile(w * h), false);
  assert.equal(room.hasTile(-1), false);
});

test("nearestFreeTile steps out of a box that appeared under a sleeping player", () => {
  const globe = new GlobeWorld(new Scene());
  const k = SPAWN_TILES[1];
  assert.equal(nearestFreeTile(globe, k, "donkey"), k, "free tiles stay put");
  const ring = globe.neighbors(k);
  globe.setBlocked([k, ...ring], true);
  const out = nearestFreeTile(globe, k, "donkey");
  assert.notEqual(out, k);
  assert.equal(globe.isBlockedFor(out, "donkey"), false);
  assert.ok(ring.some((n) => globe.neighbors(n).includes(out)), "two rings out at most");
  globe.setBlocked([k, ...ring], false);
});

// ---- the treasure halls ---------------------------------------------------------

const galleryAssets = { room_hive: new Group(), room_hall: new Group() } as unknown as Assets;
const FACINGS = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];

test("gallery: bays hold boxes on plinths but are never walked on; pillars hold nothing", () => {
  const hive = new RoomWorld("hive", "hive", galleryAssets);
  assert.equal(hive.gallery, true);
  assert.equal(hive.zoomMax, 6);
  assert.equal(new RoomWorld("b0", "house_a", fakeAssets).zoomMax, 2.2);
  assert.equal(hive.exitTile, hive.key(...GALLERY.exit));
  const bay = hive.key(0, 2); // an L bay against the left wall
  const pillar = hive.key(0, 5);
  const aisle = hive.key(4, 10);
  assert.ok(bayAt(0, 2) && isPillar(0, 5) && !bayAt(4, 10) && !isPillar(4, 10));
  assert.equal(hive.isBlockedFor(bay, "donkey"), true);
  assert.equal(hive.canHold(bay), true);
  assert.equal(hive.floorHeight(bay), PLINTH_H);
  assert.equal(hive.isBlockedFor(pillar, "donkey"), true);
  assert.equal(hive.canHold(pillar), false);
  assert.equal(hive.floorHeight(pillar), 0);
  assert.equal(hive.isBlockedFor(aisle, "donkey"), false);
  assert.equal(hive.canHold(aisle), true);
  assert.equal(hive.floorHeight(aisle), 0);
  hive.setBlocked([bay, aisle], true);
  assert.equal(hive.canHold(bay), false, "a box on the bay takes it");
  assert.equal(hive.canHold(aisle), false);
  hive.setBlocked([bay, aisle], false);
  assert.equal(hive.canHold(bay), true);
  assert.equal(hive.isBlockedFor(bay, "donkey"), true, "the plinth stays unwalkable after the box leaves");
  // an ordinary room has no plinths: its furniture holds nothing
  const house = new RoomWorld("b0", "house_a", fakeAssets);
  assert.equal(house.canHold(house.key(1, 1)), false);
  assert.equal(house.floorHeight(house.key(1, 1)), 0);
});

test("nearestFreeTile: a player saved on an L bay's wall-side tile restores onto the aisle", () => {
  const hive = new RoomWorld("hive", "hive", galleryAssets);
  // the middle row of the second L bay against the left wall, four tiles from the aisle
  const wallSide = hive.key(0, 7);
  assert.equal(bayAt(0, 7)?.size, "l");
  assert.deepEqual(hive.unkey(nearestFreeTile(hive, wallSide, "donkey")), [4, 7], "the aisle tile across from it");
  // boxes on the aisle beside the bay: the nearest open tile is five steps away, inside the search depth
  const boxes = [hive.key(4, 6), hive.key(4, 7), hive.key(4, 8)];
  hive.setBlocked(boxes, true);
  assert.deepEqual(hive.unkey(nearestFreeTile(hive, wallSide, "donkey")), [5, 7]);
  hive.setBlocked(boxes, false);
});

test("globe: canHold is exactly the donkey's walkability", () => {
  const globe = new GlobeWorld(new Scene());
  globe.setBlocked([SPAWN_TILES[0]], true);
  for (let k = 0; k < TILE_COUNT; k++) {
    assert.equal(globe.canHold(k), !globe.isBlockedFor(k, "donkey"));
    assert.equal(globe.floorHeight(k), 0);
  }
  assert.equal(globe.canHold(SPAWN_TILES[0]), false, "a box takes its tile");
  globe.setBlocked([SPAWN_TILES[0]], false);
});

test("gallery: every bay is exactly the footprint of its size from some aisle tile", () => {
  for (const kind of ["hive", "hall"] as const) {
    const room = new RoomWorld(kind, kind, galleryAssets);
    const free = (k: number) => room.canHold(k);
    for (const bay of GALLERY.bays) {
      const want = bay.tiles.map(([i, j]) => room.key(i, j)).sort((a, b) => a - b);
      let found = false;
      for (let k = 0; k < GALLERY_W * GALLERY_H && !found; k++) {
        if (room.isBlockedFor(k, "donkey") || k === room.exitTile) continue;
        for (const fwd of FACINGS) {
          const tiles = footprintTiles(room, k, fwd, bay.size);
          if (!tiles || [...tiles].sort((a, b) => a - b).join() !== want.join()) continue;
          assert.ok(footprintCheck(room, tiles, bay.size, free).every(Boolean), `bay ${bay.id} fits but is refused`);
          found = true;
          break;
        }
      }
      assert.ok(found, `${kind}: no aisle tile places a ${bay.size} box exactly into bay ${bay.id}`);
    }
  }
});
