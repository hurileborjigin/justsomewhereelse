import assert from "node:assert/strict";
import { test } from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import type { World } from "./world.ts";
import { labelAnchor } from "./labels.ts";

// labelAnchor only calls world.up(); a minimal stand-in is enough here.
const roomUp: Pick<World, "up"> = { up: (_pos, out) => out.set(0, 1, 0) };
const globeUp: Pick<World, "up"> = { up: (pos, out) => out.copy(pos).normalize() };
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

test("labelAnchor: hidden farther than 40 units away", () => {
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
