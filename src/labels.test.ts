import assert from "node:assert/strict";
import { test } from "node:test";
import { Group, PerspectiveCamera, Vector3 } from "three";
import type { Assets } from "./assets.ts";
import { GALLERY } from "./gallery.ts";
import { farness, labelAnchor } from "./labels.ts";
import { RoomWorld, type World } from "./world.ts";

// labelAnchor only reads world.up() and world.labelRange; a minimal stand-in is enough here.
const roomUp: Pick<World, "up" | "labelRange"> = { up: (_pos, out) => out.set(0, 1, 0), labelRange: 40 };
const globeUp: Pick<World, "up" | "labelRange"> = { up: (pos, out) => out.copy(pos).normalize(), labelRange: 40 };
const W = 1000;
const H = 800;

/** A camera at the origin looking down -Z, matrices refreshed (as fade.update() does each frame). */
function camLookingForward(): PerspectiveCamera {
  const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
  cam.position.set(0, 1, 0);
  cam.lookAt(0, 1, -1);
  cam.updateMatrixWorld();
  return cam;
}

test("labelAnchor: a box ahead of the camera projects near the middle of the screen", () => {
  const cam = camLookingForward();
  const screen = labelAnchor(cam, roomUp, new Vector3(0, 0, -10), "s", W, H);
  assert.ok(screen);
  assert.ok(Math.abs(screen.x - W / 2) < 1, "centered horizontally");
  assert.ok(screen.y > 0 && screen.y < H, "on screen vertically");
});

test("labelAnchor: hidden behind the camera", () => {
  const cam = camLookingForward();
  const screen = labelAnchor(cam, roomUp, new Vector3(0, 0, 10), "s", W, H);
  assert.equal(screen, null);
});

test("labelAnchor: hidden farther than the world's label range (40 on the globe and in rooms)", () => {
  const cam = camLookingForward();
  const near = labelAnchor(cam, roomUp, new Vector3(0, 0, -35), "s", W, H);
  const far = labelAnchor(cam, roomUp, new Vector3(0, 0, -45), "s", W, H);
  assert.ok(near, "just inside the cutoff stays visible");
  assert.equal(far, null, "past the cutoff hides");
});

test("labelAnchor: a taller chest anchors its tag higher on screen", () => {
  const cam = camLookingForward();
  const pos = new Vector3(0, 0, -10);
  const s = labelAnchor(cam, roomUp, pos, "s", W, H);
  const l = labelAnchor(cam, roomUp, pos, "l", W, H);
  assert.ok(s && l);
  assert.ok(l.y < s.y, "the L chest's lid sits higher, so its tag sits higher (smaller screen y)");
});

test("labelAnchor: on the globe, the tag rides the radial up direction instead of +Y", () => {
  const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
  // outside a globe of radius 10, looking straight at its near point
  cam.position.set(0, 0, 15);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const screen = labelAnchor(cam, globeUp, new Vector3(0, 0, 10), "s", W, H);
  assert.ok(screen, "the tag above a box on the globe's near surface, facing the camera, is visible");
});

test("labelAnchor: the tag rides a fixed height above the chest's own origin, so a sunk globe chest takes its tag down with it", () => {
  const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
  cam.position.set(0, -12, 30); // outside the globe, looking at the chest from the side and above
  cam.lookAt(0, 0, 21);
  cam.updateMatrixWorld();
  const up = new Vector3(0, 0, 1);
  const onTiles = new Vector3(0, 0, 20.06); // SURFACE
  const sunk = new Vector3(0, 0, 20.06 - 0.42); // an L chest's origin after SINK (src/treasures.ts)
  const a = labelAnchor(cam, globeUp, onTiles, "l", W, H);
  const b = labelAnchor(cam, globeUp, sunk, "l", W, H);
  assert.ok(a && b);
  assert.ok(Math.abs(a.dist - b.dist) < 0.5 && b.y > a.y, "the sunk chest's tag sits lower on screen");
  // exactly 2.4 (the L chest) + 0.35 above the origin: projecting that point by hand lands on the tag
  const p = sunk.clone().addScaledVector(up, 2.4 + 0.35).project(cam);
  assert.ok(Math.abs((-p.y * 0.5 + 0.5) * H - b.y) < 1e-6);
});

test("labelAnchor: in a treasure hall, zoomed all the way out at the door, every bay's tag is in range", () => {
  const hive = new RoomWorld("hive", "hive", { room_hive: new Group() } as unknown as Assets);
  // the follow camera at the hall's farthest zoom, behind the character on the exit tile facing into the hall (src/camera.ts)
  const reach = Math.hypot(3.2, 6.5) * hive.zoomMax;
  const feet = hive.tilePos(hive.exitTile, 0, new Vector3());
  const cam = new PerspectiveCamera(55, 390 / 844, 0.1, 700); // a phone held upright: the narrowest view
  cam.position.copy(feet).add(new Vector3(0, Math.sin(hive.lookDown) * reach, Math.cos(hive.lookDown) * reach));
  cam.lookAt(feet.x, feet.y + 1.2, feet.z);
  cam.updateMatrixWorld();
  let beyondRoomRange = 0;
  for (const bay of GALLERY.bays) {
    const pos = new Vector3();
    for (const [i, j] of bay.tiles) pos.add(hive.tilePos(hive.key(i, j), 0, new Vector3()));
    pos.divideScalar(bay.tiles.length).setY(hive.floorHeight(hive.key(...bay.tiles[0])));
    const spot = labelAnchor(cam, hive, pos, bay.size, 390, 844);
    assert.ok(spot, `bay ${bay.id} (${bay.size}) at ${JSON.stringify(bay.tiles[0])} shows its tag`);
    if (spot.dist > 40) beyondRoomRange++;
  }
  assert.ok(beyondRoomRange > 60, `most bays are beyond an ordinary room's range (${beyondRoomRange})`);
  assert.equal(new RoomWorld("b0", "house_a", { room_house_a: new Group() } as unknown as Assets).labelRange, 40);
});

test("farness: near tags stay full size, far ones recede toward the range", () => {
  assert.equal(farness(10, 140), 0);
  assert.equal(farness(40, 140), 0);
  assert.equal(farness(140, 140), 1);
  assert.ok(Math.abs(farness(90, 140) - 0.5) < 1e-9);
  assert.equal(farness(39, 40), 0, "on the globe and in rooms tags never recede");
});
