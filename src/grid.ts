import { Vector3 } from "three";
import { LAKE, N } from "../shared/protocol.ts";

/**
 * The globe is an equal-angle spherified cube: 6 faces x N x N square tiles.
 * A tile is addressed as (face, i, j) and packed into a single integer key.
 * The mapping here MUST stay identical to the one in assets/blender/globe.py,
 * so the visual tiles and the gameplay tiles are the same squares.
 */

const A = Math.PI / 4;
export const TILE_COUNT = 6 * N * N;

// Face bases: dir(u,v) = normalize(n + a*tan(A*u) + b*tan(A*v)), u,v in [-1,1]
type Face = { n: Vector3; a: Vector3; b: Vector3 };
const FACES: Face[] = [
  { n: new Vector3(1, 0, 0), a: new Vector3(0, 0, -1), b: new Vector3(0, 1, 0) },
  { n: new Vector3(-1, 0, 0), a: new Vector3(0, 0, 1), b: new Vector3(0, 1, 0) },
  { n: new Vector3(0, 1, 0), a: new Vector3(1, 0, 0), b: new Vector3(0, 0, -1) },
  { n: new Vector3(0, -1, 0), a: new Vector3(1, 0, 0), b: new Vector3(0, 0, 1) },
  { n: new Vector3(0, 0, 1), a: new Vector3(1, 0, 0), b: new Vector3(0, 1, 0) },
  { n: new Vector3(0, 0, -1), a: new Vector3(-1, 0, 0), b: new Vector3(0, 1, 0) },
];

export function key(f: number, i: number, j: number): number {
  return f * N * N + j * N + i;
}

export function unkey(k: number): [number, number, number] {
  const f = Math.floor(k / (N * N));
  const r = k - f * N * N;
  return [f, r % N, Math.floor(r / N)];
}

function dirAt(f: number, u: number, v: number, out: Vector3): Vector3 {
  const face = FACES[f];
  return out
    .copy(face.n)
    .addScaledVector(face.a, Math.tan(A * u))
    .addScaledVector(face.b, Math.tan(A * v))
    .normalize();
}

function centerDir(f: number, i: number, j: number, out: Vector3): Vector3 {
  const u = -1 + (2 * (i + 0.5)) / N;
  const v = -1 + (2 * (j + 0.5)) / N;
  return dirAt(f, u, v, out);
}

const clampIdx = (x: number) => Math.min(N - 1, Math.max(0, Math.floor(x)));

/** Which tile contains this direction? Exact inverse of centerDir. */
export function tileAt(p: Vector3): number {
  const ax = Math.abs(p.x);
  const ay = Math.abs(p.y);
  const az = Math.abs(p.z);
  let f: number;
  if (ax >= ay && ax >= az) f = p.x >= 0 ? 0 : 1;
  else if (ay >= ax && ay >= az) f = p.y >= 0 ? 2 : 3;
  else f = p.z >= 0 ? 4 : 5;
  const face = FACES[f];
  const w = p.dot(face.n);
  const u = Math.atan2(p.dot(face.a), w) / A;
  const v = Math.atan2(p.dot(face.b), w) / A;
  const i = clampIdx(((u + 1) / 2) * N);
  const j = clampIdx(((v + 1) / 2) * N);
  return key(f, i, j);
}

// ---- precomputed tables -------------------------------------------------

const centers: Vector3[] = new Array(TILE_COUNT);
const neighborKeys = new Int32Array(TILE_COUNT * 4).fill(-1);
const neighborDirs: Vector3[] = new Array(TILE_COUNT * 4);

const _p = new Vector3();

/** From unit vector `c`, first tile != k found walking along tangent `t`. */
function probeNeighbor(k: number, c: Vector3, t: Vector3): number {
  for (let arc = 0.01; arc <= 0.3; arc += 0.01) {
    _p.copy(c).multiplyScalar(Math.cos(arc)).addScaledVector(t, Math.sin(arc));
    const found = tileAt(_p);
    if (found !== k) return found;
  }
  return -1;
}

/** Unit tangent at `from` pointing along the great circle toward `to`. */
export function greatCircleDir(from: Vector3, to: Vector3, out: Vector3): Vector3 {
  return out.copy(to).addScaledVector(from, -from.dot(to)).normalize();
}

{
  const eps = 0.005;
  const du = new Vector3();
  const dv = new Vector3();
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = key(f, i, j);
        const c = centerDir(f, i, j, new Vector3());
        centers[k] = c;
        const u = -1 + (2 * (i + 0.5)) / N;
        const v = -1 + (2 * (j + 0.5)) / N;
        // local grid axes (tangent-projected finite differences)
        dirAt(f, u + eps, v, du).addScaledVector(c, -c.dot(du)).normalize();
        dirAt(f, u, v + eps, dv).addScaledVector(c, -c.dot(dv)).normalize();
        const axes = [du, du.clone().negate(), dv, dv.clone().negate()];
        for (let d = 0; d < 4; d++) {
          neighborKeys[k * 4 + d] = probeNeighbor(k, c, axes[d]);
          neighborDirs[k * 4 + d] = axes[d].clone();
        }
      }
    }
  }
  // second pass (all centers exist now): exact great-circle direction to each neighbor
  for (let k = 0; k < TILE_COUNT; k++) {
    for (let d = 0; d < 4; d++) {
      const nk = neighborKeys[k * 4 + d];
      if (nk >= 0) greatCircleDir(centers[k], centers[nk], neighborDirs[k * 4 + d]);
    }
  }
}

/** Tile center as a unit vector (do not mutate). */
export function tileCenter(k: number): Vector3 {
  return centers[k];
}

/**
 * The four corners of a tile as unit vectors, in order around it (the same
 * corners the globe mesh's tile quads are spherified from).
 */
export function tileCorners(k: number, out: Vector3[]): Vector3[] {
  const [f, i, j] = unkey(k);
  const u0 = -1 + (2 * i) / N;
  const u1 = -1 + (2 * (i + 1)) / N;
  const v0 = -1 + (2 * j) / N;
  const v1 = -1 + (2 * (j + 1)) / N;
  dirAt(f, u0, v0, out[0]);
  dirAt(f, u1, v0, out[1]);
  dirAt(f, u1, v1, out[2]);
  dirAt(f, u0, v1, out[3]);
  return out;
}

export function neighborsOf(k: number): number[] {
  return [
    neighborKeys[k * 4],
    neighborKeys[k * 4 + 1],
    neighborKeys[k * 4 + 2],
    neighborKeys[k * 4 + 3],
  ];
}

/**
 * Neighbor tile whose direction best matches `dir` (unit tangent at the tile
 * center). Returns -1 when nothing matches well enough.
 */
export function neighborInDirection(k: number, dir: Vector3): number {
  let best = -1;
  let bestDot = 0.35;
  for (let d = 0; d < 4; d++) {
    const nk = neighborKeys[k * 4 + d];
    if (nk < 0) continue;
    const dot = dir.dot(neighborDirs[k * 4 + d]);
    if (dot > bestDot) {
      bestDot = dot;
      best = nk;
    }
  }
  return best;
}

// ---- occupancy & terrain -------------------------------------------------

const blocked = new Set<number>();
const occupiedDecor = new Set<number>(); // non-blocking props (grass)
const water = new Set<number>();
const dynamicBlocked = new Set<number>(); // treasure boxes: come and go at runtime

/** Runtime blockers on globe tiles (treasure boxes). */
export function setDynamicBlocked(keys: number[], on: boolean): void {
  for (const k of keys) {
    if (on) dynamicBlocked.add(k);
    else dynamicBlocked.delete(k);
  }
}

for (const [f, i, j] of LAKE) water.add(key(f, i, j));

/** Mark tiles as taken by an object. Blocking objects also stop movement. */
export function occupy(keys: number[], blocks: boolean): void {
  for (const k of keys) (blocks ? blocked : occupiedDecor).add(k);
}

export function isWater(k: number): boolean {
  return water.has(k);
}

/** Can this tile be stepped onto? Water only stops characters that can't fly. */
export function isBlockedFor(k: number, canFly: boolean): boolean {
  return blocked.has(k) || dynamicBlocked.has(k) || (!canFly && water.has(k));
}

/** Free for placing scatter/buildings: no props, no water. */
export function isFree(k: number): boolean {
  return !blocked.has(k) && !dynamicBlocked.has(k) && !occupiedDecor.has(k) && !water.has(k);
}

// ---- spawns -------------------------------------------------------------

const half = Math.floor(N / 2);
export const SPAWN_TILES: [number, number] = [key(2, half - 2, half), key(2, half + 1, half)];

export function spawnForward(slot: 0 | 1): Vector3 {
  const from = centers[SPAWN_TILES[slot]];
  const to = centers[SPAWN_TILES[1 - slot]];
  return greatCircleDir(from, to, new Vector3());
}
