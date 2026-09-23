import { Vector3 } from "three";
import { BOX_SIZES, type BoxSize } from "../shared/protocol.ts";
import type { World } from "./world.ts";

const _pos = new Vector3();
const _up = new Vector3();
const _up1 = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _h = new Vector3();
const _side = new Vector3();
const _ahead = new Vector3();

/**
 * Where a box of `size` would stand if the player on `tile`, facing
 * `forward`, left it right now: the footprint tiles in row-major order
 * (rows away from the player, columns left to right), or null when it does
 * not fit.
 *
 * Tiles are found by walking neighbor lookups and carrying the heading along
 * (on the globe the grid bends across cube edges, so a straight walk has to
 * be re-aimed after every step). The rectangle must also CLOSE: walking
 * forward-then-sideways must reach the same tile as sideways-then-forward.
 * Around the cube's eight corners that fails, and the size simply does not
 * fit there. `free(k)` is the caller's per-tile rule (terrain, doors, the
 * partner, ...).
 */
export function footprintFor(
  world: World,
  tile: number,
  forward: Vector3,
  size: BoxSize,
  free: (k: number) => boolean,
): number[] | null {
  const { cols, rows } = BOX_SIZES[size];
  world.up(world.tilePos(tile, 0, _pos), _up);
  _fwd.copy(forward).addScaledVector(_up, -forward.dot(_up));
  if (_fwd.lengthSq() < 1e-8) return null;
  _fwd.normalize();
  _right.crossVectors(_fwd, _up); // same convention as the player's camera-right

  const upAt = (k: number, out: Vector3) => world.up(world.tilePos(k, 0, _pos), out);
  const out: number[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    for (const c of cols) {
      // forward first, then sideways (right at the END of the forward walk)
      _h.copy(_fwd);
      const t1 = walk(world, tile, _h, r);
      if (t1 < 0) return null;
      _side.crossVectors(_h, upAt(t1, _up1));
      const a = walk(world, t1, _side, c);
      // sideways first, then forward (forward at the END of the side walk)
      _h.copy(_right);
      const s1 = walk(world, tile, _h, c);
      if (s1 < 0) return null;
      _ahead.crossVectors(upAt(s1, _up1), _h);
      const b = walk(world, s1, _ahead, r);
      if (a < 0 || a !== b || seen.has(a) || !free(a)) return null;
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}

/**
 * Walk |n| tiles from `from` along `heading` (backwards when n < 0),
 * re-aiming after every step. Returns the tile reached (-1 if the grid ends)
 * and leaves `heading` as the transported direction at that tile.
 */
function walk(world: World, from: number, heading: Vector3, n: number): number {
  if (from < 0) return -1;
  if (n < 0) heading.negate();
  let k = from;
  for (let i = 0; i < Math.abs(n); i++) {
    const next = world.neighborInDirection(k, heading);
    if (next < 0) return -1;
    world.dirBetween(k, next, heading);
    k = next;
  }
  if (n < 0) heading.negate();
  return k;
}
