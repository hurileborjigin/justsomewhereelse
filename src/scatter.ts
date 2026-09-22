import { InstancedMesh, Object3D, Vector3, type Scene } from "three";
import { SEED, SURFACE } from "../shared/protocol.ts";
import { firstMesh, type Assets } from "./assets.ts";
import { SPAWN_TILES, TILE_COUNT, isFree, neighborsOf, occupy, tileCenter } from "./grid.ts";
import { mulberry32 } from "./math.ts";

const UP = new Vector3(0, 1, 0);
const TREES = 60;
const GRASS = 220;

/**
 * Seeded, tile-based world dressing. Both players run this with the same SEED,
 * so they deterministically see the identical planet with zero network cost.
 * Trees occupy + block their square; grass occupies its square but is walkable.
 * (Future buildings: pass several tile keys to occupy() for bigger footprints.)
 */
export function scatterWorld(scene: Scene, assets: Assets) {
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
}

function placeOnTile(obj: Object3D, k: number, spin: number, scale: number) {
  const c = tileCenter(k);
  obj.position.copy(c).multiplyScalar(SURFACE - 0.03);
  obj.quaternion.setFromUnitVectors(UP, c);
  obj.rotateY(spin);
  obj.scale.setScalar(scale);
}
