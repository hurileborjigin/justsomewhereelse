import assert from "node:assert/strict";
import { test } from "node:test";
import { clampZoom, focusFrom, placePicture } from "./crop.ts";

const frame = { w: 600, h: 400 };
const centre = { x: 0.5, y: 0.5 };

test("a photo with the frame's shape at zoom 1 fills it exactly", () => {
  assert.deepEqual(placePicture(frame, { w: 3000, h: 2000 }, centre, 1), { left: 0, top: 0, width: 600, height: 400 });
});

test("a portrait photo covers the width and is centred vertically", () => {
  assert.deepEqual(placePicture(frame, { w: 2000, h: 3000 }, centre, 1), { left: 0, top: -250, width: 600, height: 900 });
});

test("zoom scales about the focus point", () => {
  assert.deepEqual(placePicture(frame, { w: 3000, h: 2000 }, centre, 2), { left: -300, top: -200, width: 1200, height: 800 });
});

test("a focus near an edge is clamped so no frame edge shows empty space", () => {
  assert.deepEqual(placePicture(frame, { w: 3000, h: 2000 }, { x: 0, y: 0 }, 1), { left: 0, top: 0, width: 600, height: 400 });
  assert.deepEqual(placePicture(frame, { w: 3000, h: 2000 }, { x: 1, y: 1 }, 2), { left: -600, top: -400, width: 1200, height: 800 });
});

test("focusFrom reverses placePicture for a focus that needs no clamping", () => {
  const focus = { x: 0.4, y: 0.6 };
  const placed = placePicture(frame, { w: 3000, h: 2000 }, focus, 2);
  const back = focusFrom(frame, placed);
  assert.ok(Math.abs(back.x - focus.x) < 1e-9 && Math.abs(back.y - focus.y) < 1e-9);
});

test("the same focus and zoom cover a portrait frame too", () => {
  const p = placePicture({ w: 400, h: 600 }, { w: 3000, h: 2000 }, { x: 0.4, y: 0.6 }, 1.5);
  assert.ok(p.left <= 0 && p.top <= 0 && p.left + p.width >= 400 && p.top + p.height >= 600);
});

test("zoom is clamped into the allowed range", () => {
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(2), 2);
  assert.equal(clampZoom(7), 3);
});
