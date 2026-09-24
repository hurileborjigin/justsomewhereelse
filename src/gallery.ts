// The gallery layout shared by both treasure houses: one pure module of data
// and rules, computed once. The client (rendering, placement) and the
// Blender script (assets/blender/gallery.json, written by scripts/models.mjs)
// both read it, so the shelves players see and the tiles the rules accept
// cannot drift apart.
//
// Tile axes: i runs across the width (0 at the left wall), j runs across the
// depth (0 at the far wall, GALLERY_H - 1 at the door). Across the width,
// from the left wall: an L wall (4), an aisle (2), an M spine (4), an aisle
// (2), an S spine (2), an aisle (2), an L wall (4) - 20 tiles in all. Along
// the depth: a far-wall row (0), a cross-aisle (1), the bays themselves
// (2..36), and the entrance hall by the door (37..41) - 42 tiles in all.
//
// A sketch of the first few and last few rows (L/M/S = a bay tile of that
// size, s = one of the ten extra S shelves, . = open floor, X = the exit):
//
//   i:   0 1 2 3   4 5   6 7 8 9   10 11   12 13   14 15   16 17 18 19
//   j=0  . s s .   . .   . s s .   .  .    s  s    .  .    .  s  s  .
//   j=1  . . . .   . .   . . . .   .  .    .  .    .  .    .  .  .  .
//   j=2  L L L L   . .   M M M M   .  .    S  S    .  .    L  L  L  L
//   j=3  L L L L   . .   M M M M   .  .    .  .    .  .    L  L  L  L
//   j=4  L L L L   . .   .  .  .  .   .  .    S  S    .  .    L  L  L  L
//        (a pillar row follows every L bay every 3 rows, every M bay every 2
//        rows, and every S bay every row, until the last bay ends at j=36)
//   j=37 . s . .   . .   . s . .   .  .    . s    .  .    .  s  .  .
//   j=38 . . . .   . .   . . . .   .  .    .  .    .  .    .  .  .  .
//    ...   (open entrance-hall floor)
//   j=41 . . . .   . .   . . . .   .  X    .  .    .  .    .  .  .  .
//
// The counts are fixed: 18 L bays (nine per long wall), 24 M bays (twelve
// facing each aisle), 46 S shelves (eighteen facing each aisle on the S
// spine, plus six along the far wall and four beside the door) - 88 in all.
import type { BoxSize } from "../shared/protocol.ts";

export const GALLERY_W = 20;
export const GALLERY_H = 42;
export const PLINTH_H = 0.5;

export type Bay = {
  id: number;
  size: BoxSize;
  tiles: [number, number][];
  faces: "left" | "right" | "up" | "down";
};

type Face = Bay["faces"];

const EXIT: [number, number] = [10, 41];

const SIZE_RANK: Record<BoxSize, number> = { s: 0, m: 1, l: 2 };

function rect(iFrom: number, iTo: number, jFrom: number, jTo: number): [number, number][] {
  const tiles: [number, number][] = [];
  for (let i = iFrom; i <= iTo; i++) {
    for (let j = jFrom; j <= jTo; j++) tiles.push([i, j]);
  }
  return tiles;
}

function buildGallery(): { w: number; h: number; exit: [number, number]; bays: Bay[]; pillars: [number, number][] } {
  const bays: Bay[] = [];
  const pillars: [number, number][] = [];
  let nextId = 0;

  // A spine of `count` bays of `size`, each `depth` tiles deep along j,
  // stacked from j = 2 with a one-tile pillar row between neighbours. Every
  // spine used here ends at j = 36, whatever depth and count it is given.
  function spine(iFrom: number, iTo: number, faces: Face, size: BoxSize, depth: number, count: number) {
    let j = 2;
    for (let k = 0; k < count; k++) {
      bays.push({ id: nextId++, size, tiles: rect(iFrom, iTo, j, j + depth - 1), faces });
      j += depth;
      if (k < count - 1) {
        pillars.push(...rect(iFrom, iTo, j, j));
        j += 1;
      }
    }
  }

  spine(0, 3, "right", "l", 3, 9); // L wall against the left wall, facing the left aisle
  spine(16, 19, "left", "l", 3, 9); // L wall against the right wall, facing the right aisle
  spine(6, 7, "left", "m", 2, 12); // M spine, half facing the left-hand aisle
  spine(8, 9, "right", "m", 2, 12); // M spine, half facing the right-hand aisle
  spine(12, 12, "left", "s", 1, 18); // S spine, half facing the left-hand aisle
  spine(13, 13, "right", "s", 1, 18); // S spine, half facing the right-hand aisle

  // Six S shelves along the far wall (j 0), open toward the cross-aisle at j 1.
  for (const i of [1, 2, 7, 8, 17, 18]) {
    bays.push({ id: nextId++, size: "s", tiles: [[i, 0]], faces: "down" });
  }
  // Four S shelves beside the door, in the entrance hall's first row (j 37).
  for (const i of [2, 8, 13, 18]) {
    bays.push({ id: nextId++, size: "s", tiles: [[i, 37]], faces: "down" });
  }

  return { w: GALLERY_W, h: GALLERY_H, exit: EXIT, bays, pillars };
}

export const GALLERY = buildGallery();

const bayByTile = new Map<string, Bay>();
for (const bay of GALLERY.bays) {
  for (const [i, j] of bay.tiles) bayByTile.set(`${i},${j}`, bay);
}
const pillarSet = new Set<string>();
for (const [i, j] of GALLERY.pillars) pillarSet.add(`${i},${j}`);

export function bayAt(i: number, j: number): Bay | null {
  return bayByTile.get(`${i},${j}`) ?? null;
}

export function isPillar(i: number, j: number): boolean {
  return pillarSet.has(`${i},${j}`);
}

/**
 * Per tile, in input order: if every tile lies in one bay whose size is at
 * least `size`, all true. Otherwise bay and pillar tiles are false and floor
 * tiles are true (terrain, boxes and doors are the caller's job).
 */
export function footprintVerdict(tiles: [number, number][], size: BoxSize): boolean[] {
  if (tiles.length === 0) return [];
  const first = bayAt(tiles[0][0], tiles[0][1]);
  const fitsOneBay =
    first !== null && SIZE_RANK[first.size] >= SIZE_RANK[size] && tiles.every(([i, j]) => bayAt(i, j) === first);
  if (fitsOneBay) return tiles.map(() => true);
  return tiles.map(([i, j]) => !(bayAt(i, j) !== null || isPillar(i, j)));
}
