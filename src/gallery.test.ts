import assert from "node:assert/strict";
import { test } from "node:test";
import { GALLERY, GALLERY_H, GALLERY_W, PLINTH_H, bayAt, footprintVerdict, isPillar } from "./gallery.ts";

test("dimensions, plinth height and exit", () => {
  assert.equal(GALLERY_W, 20);
  assert.equal(GALLERY_H, 42);
  assert.equal(PLINTH_H, 0.5);
  assert.deepEqual(GALLERY.exit, [10, 41]);
  assert.equal(GALLERY.w, GALLERY_W);
  assert.equal(GALLERY.h, GALLERY_H);
});

test("counts: 18 L, 24 M, 46 S, 88 in all", () => {
  const countOf = (size: string) => GALLERY.bays.filter((b) => b.size === size).length;
  assert.equal(countOf("l"), 18);
  assert.equal(countOf("m"), 24);
  assert.equal(countOf("s"), 46);
  assert.equal(GALLERY.bays.length, 88);
});

test("no tile lies in two bays", () => {
  const seen = new Set<string>();
  for (const bay of GALLERY.bays) {
    for (const [i, j] of bay.tiles) {
      const key = `${i},${j}`;
      assert.ok(!seen.has(key), `tile ${key} lies in two bays`);
      seen.add(key);
    }
  }
});

test("no bay tile sits on a pillar or the exit tile", () => {
  const [ei, ej] = GALLERY.exit;
  for (const bay of GALLERY.bays) {
    for (const [i, j] of bay.tiles) {
      assert.ok(!isPillar(i, j), `bay ${bay.id} tile ${i},${j} is a pillar`);
      assert.ok(!(i === ei && j === ej), `bay ${bay.id} tile sits on the exit`);
    }
  }
});

test("every bay's open side touches a floor tile", () => {
  const offset: Record<string, [number, number]> = {
    left: [-1, 0],
    right: [1, 0],
    up: [0, -1],
    down: [0, 1],
  };
  const isFloor = (i: number, j: number) =>
    i >= 0 && i < GALLERY_W && j >= 0 && j < GALLERY_H && bayAt(i, j) === null && !isPillar(i, j);
  for (const bay of GALLERY.bays) {
    const [di, dj] = offset[bay.faces];
    const touches = bay.tiles.some(([i, j]) => isFloor(i + di, j + dj));
    assert.ok(touches, `bay ${bay.id} (${bay.size}, faces ${bay.faces}) has no floor neighbour`);
  }
});

test("every floor tile is reachable from the exit", () => {
  const isFloor = (i: number, j: number) => bayAt(i, j) === null && !isPillar(i, j);
  let totalFloor = 0;
  for (let i = 0; i < GALLERY_W; i++) {
    for (let j = 0; j < GALLERY_H; j++) {
      if (isFloor(i, j)) totalFloor++;
    }
  }

  const [ei, ej] = GALLERY.exit;
  const seen = new Set<string>([`${ei},${ej}`]);
  const queue: [number, number][] = [[ei, ej]];
  const steps: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length) {
    const [i, j] = queue.shift()!;
    for (const [di, dj] of steps) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || ni >= GALLERY_W || nj < 0 || nj >= GALLERY_H) continue;
      if (!isFloor(ni, nj)) continue;
      const key = `${ni},${nj}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push([ni, nj]);
    }
  }
  assert.equal(seen.size, totalFloor, "every floor tile must be reachable from the exit");
});

test("footprintVerdict: an L footprint inside an L bay is all true", () => {
  const bay = GALLERY.bays.find((b) => b.size === "l")!;
  assert.deepEqual(
    footprintVerdict(bay.tiles, "l"),
    bay.tiles.map(() => true),
  );
});

test("footprintVerdict: an M footprint inside an L bay is all true", () => {
  const bay = GALLERY.bays.find((b) => b.size === "l")!;
  const [i0, j0] = bay.tiles[0];
  const m: [number, number][] = [
    [i0, j0],
    [i0, j0 + 1],
    [i0 + 1, j0],
    [i0 + 1, j0 + 1],
  ];
  assert.deepEqual(footprintVerdict(m, "m"), [true, true, true, true]);
});

test("footprintVerdict: an L footprint over an S shelf and floor - the shelf tile false, floor true", () => {
  const shelf = GALLERY.bays.find((b) => b.size === "s")!;
  const shelfTile = shelf.tiles[0];
  const floorTile: [number, number] = [4, 20]; // an aisle tile: always floor
  assert.equal(bayAt(floorTile[0], floorTile[1]), null);
  assert.deepEqual(footprintVerdict([shelfTile, floorTile], "l"), [false, true]);
});

test("footprintVerdict: two S tiles across two different shelves are both false", () => {
  const shelves = GALLERY.bays.filter((b) => b.size === "s");
  const verdict = footprintVerdict([shelves[0].tiles[0], shelves[1].tiles[0]], "s");
  assert.deepEqual(verdict, [false, false]);
});

test("footprintVerdict: all-floor tiles are all true", () => {
  const verdict = footprintVerdict(
    [
      [4, 20],
      [5, 20],
      [10, 30],
    ],
    "l",
  );
  assert.deepEqual(verdict, [true, true, true]);
});
