import { InstancedMesh, Object3D, Vector3, type Scene } from "three";
import { SEED, SURFACE } from "../shared/protocol.ts";
import { firstMesh, type Assets } from "./assets.ts";
import {
  SPAWN_TILES,
  TILE_COUNT,
  greatCircleDir,
  isFree,
  key as tileKey,
  neighborInDirection,
  neighborsOf,
  occupy,
  tileCenter,
} from "./grid.ts";
import { mulberry32, tangentFrameQuat } from "./math.ts";
import type { BuildingKind } from "./world.ts";

export type Building = {
  id: string;
  kind: BuildingKind;
  tiles: number[];
  doorTiles: number[];
};

const UP = new Vector3(0, 1, 0);
const BUILDINGS = 8;
const TREES = 60;
const GRASS = 220;

// The dedicated landmarks, at fixed tiles. Gloria's opera house sits on
// face 3 - the exact antipode of the spawn face - half a planet away from
// khurlee's ger and Frauenkirche, just like Sydney and Munich.
const LANDMARKS: {
  kind: BuildingKind;
  tiles: [number, number, number][];
  door: [number, number, number];
}[] = [
  { kind: "opera", tiles: [[3, 7, 7], [3, 8, 7]], door: [3, 6, 7] },
  { kind: "ger", tiles: [[2, 11, 10]], door: [2, 11, 11] },
  { kind: "frauenkirche", tiles: [[2, 13, 11], [2, 13, 10]], door: [2, 13, 12] },
];

// The two treasure houses, placed AFTER all the seeded scatter so every tree,
// building and grass tuft stays where it was. Their tiles and doorsteps were
// chosen among tiles that scatter leaves completely empty (no building, tree,
// grass, lake, spawn, doorstep or landmark plaza; see world.test.ts). gloria's
// Hive faces the opera house across a small square on face 3; khurlee's Copper
// Hall stands a few steps from the ger and the Frauenkirche on face 2, its
// door toward them. Like the landmarks, the first tile touches the door.
const TREASURE_HOUSES: {
  kind: BuildingKind;
  tiles: [number, number, number][];
  door: [number, number, number];
}[] = [
  { kind: "hive", tiles: [[3, 2, 7], [3, 1, 7]], door: [3, 3, 7] },
  { kind: "hall", tiles: [[2, 7, 13], [2, 6, 13]], door: [2, 8, 13] },
];

/**
 * Seeded, tile-based world dressing. Both players run this with the same SEED,
 * so they deterministically see the identical planet with zero network cost -
 * including the building list this returns (ids match across both clients).
 * Buildings and trees occupy + block their squares (the barn takes two);
 * grass occupies its square but is walkable. The lake is part of the globe
 * model itself - the grid knows its tiles from LAKE in shared/protocol.ts.
 */
export function scatterWorld(scene: Scene, assets: Assets): Building[] {
  const rng = mulberry32(SEED);

  // keep the spawn tiles and two rings around them clear
  const protectedTiles = new Set<number>(SPAWN_TILES);
  for (const s of SPAWN_TILES) {
    for (const a of neighborsOf(s)) {
      if (a < 0) continue;
      protectedTiles.add(a);
      for (const b of neighborsOf(a)) if (b >= 0) protectedTiles.add(b);
    }
  }

  const pickFreeTile = (): number => {
    for (let tries = 0; tries < 80; tries++) {
      const k = Math.floor(rng() * TILE_COUNT);
      if (!protectedTiles.has(k) && isFree(k)) return k;
    }
    return -1;
  };

  const buildings: Building[] = [];

  // landmarks first: fixed positions, stable ids (persisted locations inside
  // them survive any change to the random scatter)
  for (const lm of LANDMARKS) {
    const b = placeLandmark(scene, assets, lm);
    // keep a clear little plaza around each landmark
    for (const t of [...b.tiles, ...b.doorTiles]) {
      protectedTiles.add(t);
      for (const n of neighborsOf(t)) if (n >= 0) protectedTiles.add(n);
    }
    buildings.push(b);
  }

  // strange buildings next, while contiguous pairs of tiles are plentiful.
  // Every building faces a free "door tile"; standing there lets you enter.
  const kinds: BuildingKind[] = ["house_a", "house_b", "tower", "barn"];
  let guard = 0;
  while (buildings.length < BUILDINGS && guard++ < 60) {
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const k = pickFreeTile();
    if (k < 0) break;
    const freeNeighbors = (t: number) =>
      neighborsOf(t).filter((n) => n >= 0 && !protectedTiles.has(n) && isFree(n));
    if (kind === "barn") {
      // two-tile footprint: anchor + one free neighbor, barn oriented along it
      const options = freeNeighbors(k);
      if (options.length === 0) continue;
      const nb = options[Math.floor(rng() * options.length)];
      const axis = greatCircleDir(tileCenter(k), tileCenter(nb), new Vector3());
      const mid = tileCenter(k).clone().add(tileCenter(nb)).normalize();
      const building = assets.barn.clone(true);
      building.position.copy(mid).multiplyScalar(SURFACE - 0.03);
      tangentFrameQuat(mid.clone(), axis, building.quaternion);
      scene.add(building);
      occupy([k, nb], true);
      // doors at both gable ends: the walkable tiles just beyond each end
      const doorTiles = [
        neighborInDirection(nb, greatCircleDir(tileCenter(nb), tileCenter(k), new Vector3()).negate()),
        neighborInDirection(k, greatCircleDir(tileCenter(k), tileCenter(nb), new Vector3()).negate()),
      ].filter((d) => d >= 0 && isFree(d) && !protectedTiles.has(d));
      if (doorTiles.length === 0) doorTiles.push(...options.filter((o) => o !== nb));
      for (const d of doorTiles) protectedTiles.add(d);
      buildings.push({ id: `b${buildings.length}`, kind, tiles: [k, nb], doorTiles });
    } else {
      const options = freeNeighbors(k);
      if (options.length === 0) continue;
      const doorTile = options[Math.floor(rng() * options.length)];
      const c = tileCenter(k);
      const building = assets[kind].clone(true);
      building.position.copy(c).multiplyScalar(SURFACE - 0.03);
      // face the door tile (models keep their door on the local +Z side)
      tangentFrameQuat(c.clone(), greatCircleDir(c, tileCenter(doorTile), new Vector3()), building.quaternion);
      building.scale.setScalar(0.9 + rng() * 0.2);
      scene.add(building);
      occupy([k], true);
      protectedTiles.add(doorTile); // keep the doorstep clear of trees
      buildings.push({ id: `b${buildings.length}`, kind, tiles: [k], doorTiles: [doorTile] });
    }
  }

  const variants = [assets.tree_a, assets.tree_b, assets.tree_c];
  for (let n = 0; n < TREES; n++) {
    const k = pickFreeTile();
    if (k < 0) break;
    const tree = variants[Math.floor(rng() * variants.length)].clone(true);
    placeOnTile(tree, k, rng() * Math.PI * 2, 0.8 + rng() * 0.45);
    scene.add(tree);
    occupy([k], true);
  }

  const grassMesh = firstMesh(assets.grass);
  const inst = new InstancedMesh(grassMesh.geometry, grassMesh.material, GRASS);
  const dummy = new Object3D();
  let placed = 0;
  for (let n = 0; n < GRASS; n++) {
    const k = pickFreeTile();
    if (k < 0) break;
    placeOnTile(dummy, k, rng() * Math.PI * 2, 0.85 + rng() * 0.6);
    dummy.updateMatrix();
    inst.setMatrixAt(placed++, dummy.matrix);
    occupy([k], false);
  }
  inst.count = placed;
  scene.add(inst);

  // last, so the random scatter above never sees them
  for (const house of TREASURE_HOUSES) buildings.push(placeLandmark(scene, assets, house));

  return buildings;
}

/** A building at fixed tiles with a stable id (its kind), facing its door tile. */
function placeLandmark(
  scene: Scene,
  assets: Assets,
  lm: { kind: BuildingKind; tiles: [number, number, number][]; door: [number, number, number] },
): Building {
  const tiles = lm.tiles.map(([f, i, j]) => tileKey(f, i, j));
  const door = tileKey(...lm.door);
  const anchor =
    tiles.length === 1
      ? tileCenter(tiles[0]).clone()
      : tileCenter(tiles[0]).clone().add(tileCenter(tiles[1])).normalize();
  const obj = assets[lm.kind].clone(true);
  obj.position.copy(anchor).multiplyScalar(SURFACE - 0.03);
  tangentFrameQuat(anchor.clone(), greatCircleDir(anchor, tileCenter(door), new Vector3()), obj.quaternion);
  scene.add(obj);
  occupy(tiles, true);
  return { id: lm.kind, kind: lm.kind, tiles, doorTiles: [door] };
}

function placeOnTile(obj: Object3D, k: number, spin: number, scale: number) {
  const c = tileCenter(k);
  obj.position.copy(c).multiplyScalar(SURFACE - 0.03);
  obj.quaternion.setFromUnitVectors(UP, c);
  obj.rotateY(spin);
  obj.scale.setScalar(scale);
}
