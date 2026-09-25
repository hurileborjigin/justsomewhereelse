import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, Group, Mesh, Scene, Vector3 } from "three";
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
  // the hall camera looks down more steeply than anywhere else, over the pillar rows
  assert.ok(hive.lookDown > new RoomWorld("b0", "house_a", fakeAssets).lookDown);
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

test("tileCorners: the top a box stands on, on the floor, a plinth, or a raised globe tile", () => {
  const corners = () => [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  const room = new RoomWorld("b0", "house_a", fakeAssets);
  const k = room.key(2, 2);
  const mid = room.tilePos(k, 0, new Vector3());
  const c = room.tileCorners(k, corners());
  for (const p of c) {
    assert.equal(p.y, 0);
    assert.equal(Math.abs(p.x - mid.x), 1);
    assert.equal(Math.abs(p.z - mid.z), 1);
  }
  assert.equal(c[0].distanceTo(c[2]), Math.hypot(2, 2), "in order around the tile: 0 and 2 are opposite");

  const hive = new RoomWorld("hive", "hive", galleryAssets);
  const [bi, bj] = GALLERY.bays[0].tiles[0];
  assert.ok(hive.tileCorners(hive.key(bi, bj), corners()).every((p) => p.y === PLINTH_H), "on a bay: the plinth top");

  const globe = new GlobeWorld(new Scene());
  const t = SPAWN_TILES[0];
  const g = globe.tileCorners(t, corners());
  const center = g.reduce((s, p) => s.add(p), new Vector3()).divideScalar(4);
  const up = globe.tilePos(t, 0, new Vector3());
  assert.ok(center.angleTo(up) < 1e-3, "centered on the tile");
  // the flat top between the corners dips a little below the raised tile center the characters stand on
  assert.ok(up.length() - center.length() > 0 && up.length() - center.length() < 0.08, `${up.length() - center.length()}`);
  const r = g[0].distanceTo(center);
  for (const p of g) assert.ok(Math.abs(p.distanceTo(center) - r) < 0.05, "a near-square quad");
});

test("gallery: a modelled wall hides once the camera is past it by a margin and shows only once back inside by it", () => {
  // the near (door) wall, 0.4 thick, its outer face at z = 42.4
  const wall = new Mesh(new BoxGeometry(40, 6, 0.4));
  wall.name = "Hall_wall_near";
  wall.position.set(0, 3, 42.2);
  const room = new Group();
  room.add(wall);
  const hall = new RoomWorld("hall", "hall", { room_hall: room } as unknown as Assets);
  const shown = (z: number) => {
    hall.faceCamera(new Vector3(0, 20, z));
    return hall.wallsShown().near;
  };
  assert.equal(shown(40), true, "inside the hall");
  assert.equal(shown(42.5), true, "just past the outer face: still drawn");
  assert.equal(shown(42.8), false, "past it by more than the margin: hidden");
  assert.equal(shown(42.5), false, "stays hidden while hovering near the face");
  assert.equal(shown(42.2), false, "back inside, but not yet by the margin");
  assert.equal(shown(42.0), true, "inside by more than the margin: drawn again");
});
