import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Scene,
  Vector3,
} from "three";
import { CHARACTERS, SURFACE, type CharacterId } from "../shared/protocol.ts";
import type { Assets } from "./assets.ts";
import {
  SPAWN_TILES,
  TILE_COUNT,
  greatCircleDir,
  isBlockedFor as globeBlocked,
  isWater as globeWater,
  neighborInDirection as globeNeighbor,
  neighborsOf,
  setDynamicBlocked,
  spawnForward,
  tileAt,
  tileCenter,
} from "./grid.ts";

/**
 * A World is anywhere a character can stand: the globe, or a building's
 * interior room. Both are tile grids; the same Player/Camera/CharacterView
 * code drives movement in either. `id` travels over the network so the two
 * players only see each other when they are in the same world.
 */
export interface World {
  id: string;
  isGlobe: boolean;
  scene: Scene;
  /** True for a tile key that exists in this world (data from the network may not). */
  hasTile(k: number): boolean;
  up(pos: Vector3, out: Vector3): Vector3;
  tilePos(k: number, hover: number, out: Vector3): Vector3;
  pathPos(fromK: number, toK: number, t: number, hover: number, out: Vector3): Vector3;
  dirBetween(fromK: number, toK: number, out: Vector3): Vector3;
  stepLength(fromK: number, toK: number): number;
  neighborInDirection(k: number, dir: Vector3): number;
  isBlockedFor(k: number, character: CharacterId): boolean;
  /** True when the two tiles share an edge (the reunion-hop trigger). */
  areNeighbors(a: number, b: number): boolean;
  /** Edge neighbors of a tile (never -1). */
  neighbors(k: number): number[];
  /** Runtime blockers (treasure boxes) that come and go. */
  setBlocked(tiles: number[], blocked: boolean): void;
  /** Ground point directly under `pos` for the blob shadow. */
  shadowPos(pos: Vector3, out: Vector3): Vector3;
}

// ---- the globe ------------------------------------------------------------

const _a = new Vector3();
const _b = new Vector3();

export class GlobeWorld implements World {
  id = "globe";
  isGlobe = true;
  scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  hasTile(k: number) {
    return Number.isInteger(k) && k >= 0 && k < TILE_COUNT;
  }

  up(pos: Vector3, out: Vector3) {
    return out.copy(pos).normalize();
  }

  tilePos(k: number, hover: number, out: Vector3) {
    return out.copy(tileCenter(k)).multiplyScalar(SURFACE + hover);
  }

  pathPos(fromK: number, toK: number, t: number, hover: number, out: Vector3) {
    return out
      .copy(tileCenter(fromK))
      .lerp(tileCenter(toK), t)
      .normalize()
      .multiplyScalar(SURFACE + hover);
  }

  dirBetween(fromK: number, toK: number, out: Vector3) {
    return greatCircleDir(tileCenter(fromK), tileCenter(toK), out);
  }

  stepLength(fromK: number, toK: number) {
    return tileCenter(fromK).angleTo(tileCenter(toK)) * SURFACE;
  }

  neighborInDirection(k: number, dir: Vector3) {
    return globeNeighbor(k, dir);
  }

  isBlockedFor(k: number, character: CharacterId) {
    return globeBlocked(k, CHARACTERS[character].fly);
  }

  areNeighbors(a: number, b: number) {
    return neighborsOf(a).includes(b);
  }

  neighbors(k: number) {
    return neighborsOf(k).filter((n) => n >= 0);
  }

  setBlocked(tiles: number[], blocked: boolean) {
    setDynamicBlocked(tiles, blocked);
  }

  shadowPos(pos: Vector3, out: Vector3) {
    this.up(pos, out);
    const drop = globeWater(tileAt(out)) ? 0.12 : 0;
    return out.multiplyScalar(SURFACE + 0.02 - drop);
  }

  spawn(slot: 0 | 1): { tile: number; forward: Vector3 } {
    return { tile: SPAWN_TILES[slot], forward: spawnForward(slot) };
  }
}

// ---- building interiors ---------------------------------------------------

export type BuildingKind =
  | "house_a"
  | "house_b"
  | "tower"
  | "barn"
  | "opera"
  | "ger"
  | "frauenkirche";

export type RoomSpec = {
  /** grid size in tiles (tile size = 2 units, same feel as the globe) */
  w: number;
  h: number;
  /** tiles occupied by furniture (i, j) - keep in sync with rooms.py props */
  blocked: [number, number][];
  /** cozy background color behind the open-top room */
  bg: string;
};

// The flexible part: swap a building's interior by editing its spec here and
// its geometry in assets/blender/rooms.py (a museum/gallery later = a bigger
// w x h, its own GLB, and Frame nodes to hang art on).
export const ROOM_SPECS: Record<BuildingKind, RoomSpec> = {
  house_a: { w: 6, h: 5, blocked: [[1, 1]], bg: "2e2836" },
  house_b: {
    w: 5,
    h: 5,
    blocked: [[0, 0], [4, 0], [0, 4], [4, 4], [2, 2]],
    bg: "33222a",
  },
  tower: {
    w: 5,
    h: 5,
    blocked: [[0, 0], [4, 0], [0, 4], [4, 4], [1, 0], [2, 0], [3, 0], [2, 1]],
    bg: "1f2233",
  },
  barn: { w: 6, h: 8, blocked: [[1, 1], [4, 2], [2, 5]], bg: "302a22" },
  opera: {
    w: 7,
    h: 6,
    blocked: [[1, 2], [2, 2], [4, 2], [5, 2], [1, 3], [2, 3], [4, 3], [5, 3]],
    bg: "241a20",
  },
  ger: {
    w: 5,
    h: 5,
    blocked: [[0, 0], [4, 0], [0, 4], [4, 4], [2, 2], [0, 2], [4, 2]],
    bg: "2c2420",
  },
  frauenkirche: {
    w: 5,
    h: 7,
    blocked: [[2, 0], [1, 2], [3, 2], [1, 3], [3, 3], [1, 4], [3, 4]],
    bg: "1c2030",
  },
};

export const BUILDING_NAMES: Record<BuildingKind, string> = {
  house_a: "crooked house",
  house_b: "mushroom house",
  tower: "wizard tower",
  barn: "barn",
  opera: "opera house",
  ger: "ger",
  frauenkirche: "Frauenkirche",
};

const T = 2; // tile size
const AXES = [
  { di: 1, dj: 0, v: new Vector3(1, 0, 0) },
  { di: -1, dj: 0, v: new Vector3(-1, 0, 0) },
  { di: 0, dj: 1, v: new Vector3(0, 0, 1) },
  { di: 0, dj: -1, v: new Vector3(0, 0, -1) },
];

export class RoomWorld implements World {
  id: string;
  kind: BuildingKind;
  isGlobe = false;
  scene = new Scene();
  exitTile: number;
  private w: number;
  private h: number;
  private furniture = new Set<number>(); // from ROOM_SPECS, permanent
  private boxes = new Set<number>(); // treasure boxes, runtime

  constructor(id: string, kind: BuildingKind, assets: Assets) {
    this.id = id;
    this.kind = kind;
    const spec = ROOM_SPECS[kind];
    this.w = spec.w;
    this.h = spec.h;
    for (const [i, j] of spec.blocked) this.furniture.add(this.key(i, j));
    // the door is in the middle of the +Z wall; standing there offers "Leave"
    this.exitTile = this.key(Math.floor(spec.w / 2), spec.h - 1);

    this.scene.background = new Color(`#${spec.bg}`);
    this.scene.add(new HemisphereLight(0xffe8c8, 0x5a4a3a, 1.0));
    const lamp = new DirectionalLight(0xfff0d8, 1.8);
    lamp.position.set(4, 10, 3);
    this.scene.add(lamp);
    this.scene.add(assets[`room_${kind}`].clone(true));
  }

  key(i: number, j: number) {
    return j * this.w + i;
  }

  private unkey(k: number): [number, number] {
    return [k % this.w, Math.floor(k / this.w)];
  }

  hasTile(k: number) {
    return Number.isInteger(k) && k >= 0 && k < this.w * this.h;
  }

  up(_pos: Vector3, out: Vector3) {
    return out.set(0, 1, 0);
  }

  tilePos(k: number, hover: number, out: Vector3) {
    const [i, j] = this.unkey(k);
    return out.set((i - (this.w - 1) / 2) * T, hover, (j - (this.h - 1) / 2) * T);
  }

  pathPos(fromK: number, toK: number, t: number, hover: number, out: Vector3) {
    this.tilePos(fromK, hover, _a);
    this.tilePos(toK, hover, _b);
    return out.copy(_a).lerp(_b, t);
  }

  dirBetween(fromK: number, toK: number, out: Vector3) {
    this.tilePos(fromK, 0, _a);
    this.tilePos(toK, 0, _b);
    return out.copy(_b).sub(_a).normalize();
  }

  stepLength() {
    return T;
  }

  neighborInDirection(k: number, dir: Vector3) {
    const [i, j] = this.unkey(k);
    let best = -1;
    let bestDot = 0.35;
    for (const axis of AXES) {
      const ni = i + axis.di;
      const nj = j + axis.dj;
      if (ni < 0 || ni >= this.w || nj < 0 || nj >= this.h) continue;
      const dot = dir.dot(axis.v);
      if (dot > bestDot) {
        bestDot = dot;
        best = this.key(ni, nj);
      }
    }
    return best;
  }

  isBlockedFor(k: number, _character: CharacterId) {
    return this.furniture.has(k) || this.boxes.has(k);
  }

  areNeighbors(a: number, b: number) {
    const [ai, aj] = this.unkey(a);
    const [bi, bj] = this.unkey(b);
    return Math.abs(ai - bi) + Math.abs(aj - bj) === 1;
  }

  neighbors(k: number) {
    const [i, j] = this.unkey(k);
    const out: number[] = [];
    for (const axis of AXES) {
      const ni = i + axis.di;
      const nj = j + axis.dj;
      if (ni >= 0 && ni < this.w && nj >= 0 && nj < this.h) out.push(this.key(ni, nj));
    }
    return out;
  }

  setBlocked(tiles: number[], blocked: boolean) {
    for (const t of tiles) {
      if (blocked) this.boxes.add(t);
      else this.boxes.delete(t);
    }
  }

  shadowPos(pos: Vector3, out: Vector3) {
    return out.set(pos.x, 0.02, pos.z);
  }

  /** Where a character appears after stepping through the door. */
  enterSpawn(): { tile: number; forward: Vector3 } {
    return { tile: this.exitTile, forward: new Vector3(0, 0, -1) };
  }
}

/**
 * The nearest tile `character` can stand on, searching outward a few rings.
 * Used when a persisted position is now inside a treasure box that appeared
 * while the player was away. Returns `start` itself when nothing nearby is
 * free (the player can still step out: only target tiles are checked).
 */
export function nearestFreeTile(world: World, start: number, character: CharacterId): number {
  if (!world.isBlockedFor(start, character)) return start;
  const seen = new Set([start]);
  let ring = [start];
  for (let depth = 0; depth < 4; depth++) {
    const next: number[] = [];
    for (const k of ring) {
      for (const n of world.neighbors(k)) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (!world.isBlockedFor(n, character)) return n;
        next.push(n);
      }
    }
    ring = next;
  }
  return start;
}
