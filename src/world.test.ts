import assert from "node:assert/strict";
import { test } from "node:test";
import { Group, Scene } from "three";
import type { Assets } from "./assets.ts";
import { SPAWN_TILES, isFree, neighborsOf } from "./grid.ts";
import { GlobeWorld, ROOM_SPECS, RoomWorld } from "./world.ts";

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
