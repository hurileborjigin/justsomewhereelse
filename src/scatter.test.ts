import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene } from "three";
import { LAKE } from "../shared/protocol.ts";
import type { Assets } from "./assets.ts";
import { SPAWN_TILES, TILE_COUNT, isBlockedFor, isFree, isWater, key, neighborsOf } from "./grid.ts";
import { scatterWorld } from "./scatter.ts";

// scatterWorld only clones models (and reads the grass mesh): one tiny mesh stands in for all of them.
const fakeAssets = new Proxy({} as Record<string, Group>, {
  get: (cache, name: string) => {
    if (!cache[name]) {
      cache[name] = new Group();
      cache[name].add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    }
    return cache[name];
  },
}) as unknown as Assets;

// The seeded scatter as it stood before the treasure houses existed, captured
// by running scatterWorld headlessly on 2026-09-24. Boxes already standing on
// the globe rely on it: none of this may ever change.
const BEFORE_BUILDINGS = [
  { id: "opera", kind: "opera", tiles: [887, 888], doorTiles: [886] },
  { id: "ger", kind: "ger", tiles: [683], doorTiles: [699] },
  { id: "frauenkirche", kind: "frauenkirche", tiles: [701, 685], doorTiles: [717] },
  { id: "b3", kind: "house_a", tiles: [312], doorTiles: [328] },
  { id: "b4", kind: "house_b", tiles: [452], doorTiles: [468] },
  { id: "b5", kind: "house_b", tiles: [173], doorTiles: [174] },
  { id: "b6", kind: "house_b", tiles: [220], doorTiles: [204] },
  { id: "b7", kind: "tower", tiles: [919], doorTiles: [918] },
];
// Tiles blocked by buildings and trees.
const BEFORE_BLOCKED = [
  11, 18, 21, 40, 73, 86, 104, 160, 173, 220, 230, 238, 252, 260, 272, 280, 284, 312, 327, 334, 354, 429, 452, 511,
  536, 561, 683, 685, 701, 783, 814, 819, 841, 875, 887, 888, 894, 919, 981, 987, 995, 1016, 1027, 1032, 1100, 1103,
  1113, 1119, 1128, 1168, 1195, 1196, 1198, 1200, 1201, 1202, 1203, 1269, 1281, 1305, 1357, 1370, 1393, 1424, 1438,
  1501, 1512, 1519, 1528, 1533,
];
// Tiles taken by grass (occupied, walkable).
const BEFORE_GRASS = [
  1, 4, 10, 20, 23, 28, 34, 51, 52, 63, 75, 93, 95, 116, 120, 122, 125, 137, 142, 145, 153, 155, 168, 176, 183, 193,
  196, 199, 210, 211, 224, 227, 228, 229, 240, 246, 249, 259, 261, 263, 267, 269, 273, 275, 295, 296, 310, 313, 315,
  329, 344, 353, 355, 356, 357, 380, 394, 395, 405, 409, 410, 412, 423, 443, 446, 455, 460, 462, 463, 473, 474, 476,
  477, 480, 491, 496, 499, 514, 516, 526, 531, 533, 537, 540, 546, 568, 569, 583, 584, 595, 610, 613, 618, 635, 638,
  639, 653, 659, 677, 692, 695, 714, 720, 724, 750, 753, 763, 767, 770, 794, 795, 796, 804, 806, 816, 836, 842, 846,
  847, 848, 850, 855, 891, 897, 908, 911, 930, 932, 938, 944, 948, 950, 952, 956, 967, 989, 998, 999, 1007, 1013,
  1018, 1021, 1028, 1033, 1067, 1076, 1080, 1081, 1082, 1094, 1130, 1137, 1146, 1147, 1149, 1153, 1159, 1167, 1171,
  1175, 1188, 1192, 1193, 1194, 1199, 1206, 1213, 1214, 1224, 1229, 1240, 1242, 1243, 1253, 1271, 1272, 1278, 1283,
  1291, 1300, 1304, 1312, 1314, 1315, 1324, 1326, 1330, 1331, 1336, 1337, 1345, 1350, 1351, 1362, 1364, 1367, 1368,
  1392, 1396, 1401, 1418, 1429, 1430, 1431, 1432, 1437, 1453, 1458, 1461, 1467, 1471, 1475, 1477, 1482, 1495, 1502,
  1504, 1505, 1506, 1532,
];

test("the treasure houses join the planet without moving anything the seeded scatter placed", () => {
  const buildings = scatterWorld(new Scene(), fakeAssets);
  const blocked: number[] = [];
  const grass: number[] = [];
  for (let k = 0; k < TILE_COUNT; k++) {
    if (isBlockedFor(k, true)) blocked.push(k);
    else if (!isFree(k) && !isWater(k)) grass.push(k);
  }

  // every earlier building is exactly where it was, in the same order, with the same id
  assert.deepEqual(buildings.slice(0, BEFORE_BUILDINGS.length), BEFORE_BUILDINGS);
  const houses = buildings.slice(BEFORE_BUILDINGS.length);
  assert.deepEqual(
    houses.map((b) => [b.id, b.kind]),
    [["hive", "hive"], ["hall", "hall"]],
  );
  assert.deepEqual(houses[0].tiles, [key(3, 2, 7), key(3, 1, 7)]);
  assert.deepEqual(houses[0].doorTiles, [key(3, 3, 7)]);
  assert.deepEqual(houses[1].tiles, [key(2, 7, 13), key(2, 6, 13)]);
  assert.deepEqual(houses[1].doorTiles, [key(2, 8, 13)]);

  // grass is untouched; the only newly blocked tiles are the houses' own
  assert.deepEqual(grass, BEFORE_GRASS);
  const houseTiles = houses.flatMap((b) => b.tiles);
  assert.deepEqual(blocked, [...BEFORE_BLOCKED, ...houseTiles].sort((a, b) => a - b));

  // the houses and their doorsteps took tiles the scatter had left completely empty
  const lake = new Set(LAKE.map(([f, i, j]) => key(f, i, j)));
  const doorsteps = new Set(BEFORE_BUILDINGS.flatMap((b) => b.doorTiles));
  const plazas = new Set<number>();
  for (const b of BEFORE_BUILDINGS.slice(0, 3)) {
    for (const t of [...b.tiles, ...b.doorTiles]) {
      plazas.add(t);
      for (const n of neighborsOf(t)) plazas.add(n);
    }
  }
  const taken = new Set([...BEFORE_BLOCKED, ...BEFORE_GRASS]);
  for (const t of [...houseTiles, ...houses.flatMap((b) => b.doorTiles)]) {
    assert.ok(!taken.has(t), `tile ${t} was already taken`);
    assert.ok(!lake.has(t), `tile ${t} is in the lake`);
    assert.ok(!doorsteps.has(t), `tile ${t} is a doorstep`);
    assert.ok(!plazas.has(t), `tile ${t} is in a landmark's plaza`);
    assert.ok(!(SPAWN_TILES as number[]).includes(t), `tile ${t} is a spawn`);
  }

  // each house's first tile touches its door, so the model faces its doorstep
  for (const b of houses) {
    assert.ok(neighborsOf(b.tiles[0]).includes(b.doorTiles[0]));
    assert.ok(neighborsOf(b.tiles[0]).includes(b.tiles[1]));
    assert.equal(isBlockedFor(b.doorTiles[0], false), false, "the doorstep stays walkable");
  }
});
