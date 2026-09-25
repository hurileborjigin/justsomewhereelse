import assert from "node:assert/strict";
import { test } from "node:test";
import { Object3D, PerspectiveCamera, Vector3 } from "three";
import type { World } from "./world.ts";
import { labelAnchor, lidTip } from "./labels.ts";

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

/** An L chest's lid as mounted: its hinge at the back of the body top (treasure.py: body 62% of 2.4 high, 7 deep). */
function lLid(angle: number): Object3D {
  const chest = new Object3D();
  const lid = new Object3D();
  lid.position.set(0, 2.4 * 0.62, -3.5);
  lid.rotation.x = angle;
  chest.add(lid);
  chest.updateMatrixWorld(true);
  return lid;
}

test("lidTip: sealed, the lid's front edge is the front of the chest top; open, it stands far above the body", () => {
  const sealed = lidTip(lLid(0), "l", new Vector3());
  assert.ok(Math.abs(sealed.z - 3.5) < 1e-6 && Math.abs(sealed.y - 2.4 * 0.62) < 1e-6);
  const open = lidTip(lLid(-1.75), "l", new Vector3()); // LID_OPEN in src/treasures.ts
  assert.ok(open.y > 8, `the open L lid reaches above 8 units (${open.y.toFixed(2)})`);
  assert.ok(open.z < -3.5, "and leans back past the hinge");
});

test("labelAnchor: an open lid lifts the tag above its top edge; a sealed one leaves it on the chest", () => {
  const cam = camLookingForward();
  const pos = new Vector3(0, 0, -30);
  const tipOf = (angle: number) => lidTip(lLid(angle), "l", new Vector3()).add(pos);
  const plain = labelAnchor(cam, roomUp, pos, "l", W, H);
  const sealed = labelAnchor(cam, roomUp, pos, "l", W, H, tipOf(0));
  const open = labelAnchor(cam, roomUp, pos, "l", W, H, tipOf(-1.75));
  assert.ok(plain && sealed && open);
  assert.equal(sealed.y, plain.y, "a sealed lid's edge is below the chest top: the tag stays put");
  assert.ok(open.y < plain.y - 50, `the open lid's tag rides well above (${open.y.toFixed(0)} vs ${plain.y.toFixed(0)})`);
});

test("labelAnchor: up close, an open lid's top leaves the screen and the tag stops at the top edge", () => {
  const cam = camLookingForward();
  const pos = new Vector3(0, 0, -6);
  const tip = lidTip(lLid(-1.75), "l", new Vector3()).add(pos);
  const screen = labelAnchor(cam, roomUp, pos, "l", W, H, tip);
  assert.ok(screen, "still shown");
  assert.equal(screen.y, 72, "pinned near the top edge, below the corner buttons");
  assert.ok(Math.abs(screen.x - W / 2) < 1, "on the line from the chest up to the lid");
});
