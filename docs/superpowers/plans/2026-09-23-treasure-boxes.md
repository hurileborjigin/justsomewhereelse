# Treasure Boxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Either player can pack a postcard (handwritten text plus photos and videos) into a 3D treasure chest, leave it anywhere on the globe or inside a room, and the other player can stumble on it, open it, keep it, label it and place it back in the world.

**Architecture:** Boxes are first-class world objects stored in SQLite and relayed over the existing WebSocket protocol. The server enforces ownership and overlap rules and hides contents until a box is opened. Both clients compute footprints against the shared seeded grid, render chests into the globe or room scenes, and show a designed postcard dialog for composing and reading.

**Tech Stack:** TypeScript, Three.js, Vite, Node >= 24 (type stripping, `node:sqlite`, `node:test`), `ws`, Blender Python for models, Playwright for visual checks, `@fontsource/caveat` for the handwriting font.

**Spec:** `docs/superpowers/specs/2026-09-23-treasure-boxes-design.md`

## Global Constraints

- Never use the em dash character anywhere: code, comments, copy, docs, commit messages.
- Commit messages carry no co-author line.
- Long Markdown: one full sentence per line.
- `shared/protocol.ts` is imported by Node with type stripping: no enums, no namespaces, no parameter properties, explicit `.ts` extensions on relative imports.
- All client modules that unit tests import must be erasable-syntax TypeScript (Node strips types, it does not transform them); `tsconfig.json` enforces this with `erasableSyntaxOnly`.
- Limits, verbatim from the spec: text 2000 characters, 6 media files per box, label 40 characters, 25 MB per media file (existing `MEDIA_MAX_BYTES`).
- Footprints: S = 1 tile (col 0, row 1), M = 2 by 2 (cols 0 and +1, rows 1 and 2), L = 3 wide by 4 deep (cols -1, 0, +1, rows 1 to 4). Row 1 is the square directly in front of the player; positive columns are to the player's right.
- Announce toggle defaults to on.
- No third-party network requests from the page: the font ships in the bundle.
- Boxes and their media are never deleted.
- Node 24 is the CI runtime (matches the Dockerfile's `node:24-slim`); the local machine runs Node 26.
- Run everything with `npm run typecheck`, `npm test`, `npm run smoke` green before each commit that touches code.

## Review Focus

Inputs the spec implies but that need explicit tests, most likely to bite first:

1. A player reconnects while standing where a box now stands: they must be nudged to a free neighbor, not trapped inside the chest. Test: `nearestFreeTile` unit test in Task 10.
2. Pressing Enter inside the postcard text area must insert a newline, not jump focus to the chat box. Guard in Task 7; the drive script in Task 11 presses Enter in the card and asserts focus stays.
3. A box left in a room the partner has never entered must appear the moment they walk in, with its tiles blocked. Exercised by the drive script's last step in Task 11: A enters the ger only after B placed the box there.
4. The creator opening their own sealed box must not mark it opened. Test added in Task 3's smoke test.
5. Two placements from both players in the same instant on overlapping tiles: the second is refused with `overlap` and the dialog stays open. Test added in Task 3's smoke test and Task 8 (compose keeps the dialog on rejection).

---

### Task 1: Protocol types, constants and messages

**Files:**
- Modify: `shared/protocol.ts`
- Modify: `docs/superpowers/specs/2026-09-23-treasure-boxes-design.md` (two small additions)

**Interfaces:**
- Produces: `BoxSize`, `Vec3`, `Box`, `BoxDenyReason`, `BOX_TEXT_MAX_LEN`, `BOX_MEDIA_MAX`, `BOX_LABEL_MAX_LEN`, `BOX_SIZES`, `boxTileCount(size)`, the five `box-*` client messages, the `box` and `box-deny` server messages, and `boxes` on `welcome`. Every later task imports from here.

- [ ] **Step 1: Add the box section to `shared/protocol.ts`**

Append after the `ChatEntry` type (before the `SETUP_CREATOR` comment):

```ts
// ---- treasure boxes -------------------------------------------------------

export type BoxSize = "s" | "m" | "l";
export type Vec3 = [number, number, number];

export const BOX_TEXT_MAX_LEN = 2000;
export const BOX_MEDIA_MAX = 6;
export const BOX_LABEL_MAX_LEN = 40;

// Footprint layout as seen by the player who places the box: columns run
// across the facing direction (positive = right), rows run away from the
// player (row 1 = the square directly in front).
export const BOX_SIZES: Record<BoxSize, { cols: number[]; rows: number[] }> = {
  s: { cols: [0], rows: [1] },
  m: { cols: [0, 1], rows: [1, 2] },
  l: { cols: [-1, 0, 1], rows: [1, 2, 3, 4] },
};

export const boxTileCount = (size: BoxSize) =>
  BOX_SIZES[size].cols.length * BOX_SIZES[size].rows.length;

export type Box = {
  id: number;
  creator: PlayerId;
  owner: PlayerId | null; // who kept it; null until first kept
  size: BoxSize;
  announce: boolean; // may the partner be told a sealed box is waiting?
  created: number;
  opened: number | null; // first opening; null while sealed
  label: string | null; // the owner's note
  origin: string; // world id where it was first left (for the postmark)
  loc: string | null; // world id while standing in the world; null while held
  tiles: number[]; // footprint tiles in that world; [] while held
  fwd: Vec3; // placer's facing at placement (orients the chest)
  // contents - only present when the recipient may see them
  text?: string;
  media?: MediaRef[];
};

export type BoxDenyReason = "invalid" | "overlap" | "partner" | "creator" | "owner" | "missing";
```

- [ ] **Step 2: Extend the message unions**

Replace the `ClientMessage` type with:

```ts
export type ClientMessage =
  | { t: "join"; id: PlayerId; pass: string; create?: boolean }
  | ({ t: "state" } & StateData)
  | { t: "rename"; name: string }
  | { t: "chat"; text: string; media?: MediaRef }
  | { t: "recall"; id: number }
  | {
      t: "box-place";
      size: BoxSize;
      text: string;
      media: MediaRef[];
      announce: boolean;
      loc: string;
      tiles: number[];
      fwd: Vec3;
    }
  | { t: "box-open"; id: number }
  | { t: "box-keep"; id: number; label?: string }
  | { t: "box-label"; id: number; label: string }
  | { t: "box-put"; id: number; loc: string; tiles: number[]; fwd: Vec3 };
```

In `ServerMessage`, add `boxes: Box[]; // every box, contents stripped unless you may see them` as the last field of the `welcome` object, and add these two members at the end of the union:

```ts
  | { t: "box"; box: Box } // one box changed (or answers your box-open)
  | { t: "box-deny"; reason: BoxDenyReason };
```

- [ ] **Step 3: Record two clarifications in the spec**

In the spec's Storage table add a row `| origin | TEXT NOT NULL | world id where the box was first left, for the postmark |` after `label`, and in the `Box` property list add `- \`origin\`: the world id where the box was first left, so the postmark stays right after the box moves.` after `label`.
In the same section change `Label edits the note in place.` to `Label asks for the note in a prompt, the way renaming does.`
In the Treasures panel section, replace the sentence `Your collection: one row per held box with its label or "no label yet", a size marker, who it is from, when it was kept, and a thumbnail of the first photo or video.` with these two lines:

```
Your collection: one row per box you own, held or placed, with its label or "no label yet", a size marker, who it is from, when you found it, where it stands, and a thumbnail of the first photo or video.
Held boxes offer Open, Label and "Place here"; placed boxes offer Open and Label.
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0 (nothing consumes the new types yet).

- [ ] **Step 5: Commit**

```bash
git add shared/protocol.ts docs/superpowers/specs/2026-09-23-treasure-boxes-design.md
git commit -m "Protocol: treasure box types, limits and messages"
```

---

### Task 2: Store: the boxes table with unit tests

**Files:**
- Modify: `server/store.ts`
- Create: `server/store.test.ts`
- Modify: `package.json` (add the `test` script)

**Interfaces:**
- Consumes: `Box`, `BoxSize`, `MediaRef`, `PlayerId`, `Vec3` from `shared/protocol.ts`.
- Produces on `Store`: `addBox(input: NewBox): FullBox`, `getBox(id): FullBox | null`, `boxes(): FullBox[]`, `boxesIn(loc): FullBox[]`, `openBox(id, ts)`, `keepBox(id, owner, label)`, `labelBox(id, label)`, `putBox(id, loc, tiles, fwd)`. Exported types `FullBox = Box & { text: string; media: MediaRef[] }` and `NewBox`.

- [ ] **Step 1: Add the test script**

In `package.json` `scripts`, add after `"typecheck"`:

```json
    "test": "node --test 'server/*.test.ts' 'src/*.test.ts'",
```

- [ ] **Step 2: Write the failing tests**

Create `server/store.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Vec3 } from "../shared/protocol.ts";
import { Store } from "./store.ts";

const fresh = () => new Store(":memory:");
const draft = {
  creator: 0 as const,
  size: "m" as const,
  text: "for you",
  media: [{ url: "/media/a.jpg", kind: "image" as const }],
  announce: true,
  loc: "globe",
  tiles: [10, 11, 26, 27],
  fwd: [0, 0, 1] as Vec3,
};

test("a new box is sealed, unowned and stands where it was left", () => {
  const s = fresh();
  const box = s.addBox(draft);
  assert.equal(box.id, 1);
  assert.equal(box.creator, 0);
  assert.equal(box.owner, null);
  assert.equal(box.opened, null);
  assert.equal(box.label, null);
  assert.equal(box.origin, "globe");
  assert.equal(box.loc, "globe");
  assert.deepEqual(box.tiles, [10, 11, 26, 27]);
  assert.deepEqual(box.fwd, [0, 0, 1]);
  assert.equal(box.text, "for you");
  assert.deepEqual(box.media, draft.media);
  assert.equal(box.announce, true);
  assert.ok(box.created > 0);
  assert.deepEqual(
    s.boxes().map((b) => b.id),
    [1],
  );
});

test("boxesIn lists only boxes standing in that world", () => {
  const s = fresh();
  s.addBox(draft);
  s.addBox({ ...draft, loc: "b3", tiles: [4], size: "s" });
  assert.deepEqual(
    s.boxesIn("globe").map((b) => b.id),
    [1],
  );
  assert.deepEqual(
    s.boxesIn("b3").map((b) => b.id),
    [2],
  );
  assert.deepEqual(s.boxesIn("tower"), []);
});

test("opening records only the first time", () => {
  const s = fresh();
  const { id } = s.addBox(draft);
  s.openBox(id, 1000);
  s.openBox(id, 2000);
  assert.equal(s.getBox(id)?.opened, 1000);
});

test("keeping moves the box out of the world into the owner's collection", () => {
  const s = fresh();
  const { id } = s.addBox(draft);
  s.keepBox(id, 1, "our first trip");
  const box = s.getBox(id)!;
  assert.equal(box.owner, 1);
  assert.equal(box.label, "our first trip");
  assert.equal(box.loc, null);
  assert.deepEqual(box.tiles, []);
  assert.equal(box.origin, "globe", "the postmark keeps where it was first left");
  assert.deepEqual(s.boxesIn("globe"), []);
});

test("labeling and putting back", () => {
  const s = fresh();
  const { id } = s.addBox(draft);
  s.keepBox(id, 1, null);
  s.labelBox(id, "rainy day");
  s.putBox(id, "ger", [7, 8, 12, 13], [1, 0, 0]);
  const box = s.getBox(id)!;
  assert.equal(box.label, "rainy day");
  assert.equal(box.loc, "ger");
  assert.deepEqual(box.tiles, [7, 8, 12, 13]);
  assert.deepEqual(box.fwd, [1, 0, 0]);
  assert.equal(box.owner, 1);
  assert.equal(box.origin, "globe");
});

test("missing boxes are null", () => {
  assert.equal(fresh().getBox(99), null);
});

test("boxes survive reopening the database file", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-store-"));
  const path = join(dir, "planet.db");
  try {
    new Store(path).addBox(draft);
    const again = new Store(path);
    assert.equal(again.boxes().length, 1);
    assert.equal(again.getBox(1)?.text, "for you");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL. `src/*.test.ts` matches nothing yet (that is fine, Node reports only the files it found) and the store tests fail with `TypeError: s.addBox is not a function`.

- [ ] **Step 4: Implement the table and methods**

In `server/store.ts`, change the import line to:

```ts
import type {
  Box,
  BoxSize,
  ChatEntry,
  MediaRef,
  PlayerId,
  StateData,
  Vec3,
} from "../shared/protocol.ts";
```

Add below the `HISTORY_KEEP` constant:

```ts
/** A box as stored: contents always present (the server strips them per viewer). */
export type FullBox = Box & { text: string; media: MediaRef[] };

export type NewBox = {
  creator: PlayerId;
  size: BoxSize;
  text: string;
  media: MediaRef[];
  announce: boolean;
  loc: string;
  tiles: number[];
  fwd: Vec3;
};

type BoxRow = {
  id: number;
  creator: number;
  owner: number | null;
  size: string;
  text: string;
  media: string;
  announce: number;
  created: number;
  opened: number | null;
  label: string | null;
  origin: string;
  loc: string | null;
  tiles: string;
  fwd: string;
};

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function rowToBox(r: BoxRow): FullBox {
  return {
    id: Number(r.id),
    creator: r.creator as PlayerId,
    owner: r.owner === null ? null : (r.owner as PlayerId),
    size: r.size as BoxSize,
    announce: r.announce === 1,
    created: r.created,
    opened: r.opened,
    label: r.label,
    origin: r.origin,
    loc: r.loc,
    tiles: parseJson<number[]>(r.tiles, []),
    fwd: parseJson<Vec3>(r.fwd, [0, 0, 1]),
    text: r.text,
    media: parseJson<MediaRef[]>(r.media, []),
  };
}
```

Add the table to the `CREATE TABLE` block in the constructor, after the `kv` table:

```sql
      CREATE TABLE IF NOT EXISTS boxes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator INTEGER NOT NULL,
        owner INTEGER,
        size TEXT NOT NULL,
        text TEXT NOT NULL,
        media TEXT NOT NULL,
        announce INTEGER NOT NULL,
        created INTEGER NOT NULL,
        opened INTEGER,
        label TEXT,
        origin TEXT NOT NULL,
        loc TEXT,
        tiles TEXT NOT NULL,
        fwd TEXT NOT NULL
      );
```

Add the methods at the end of the class, after `history()`:

```ts
  // --- treasure boxes ---------------------------------------------------------

  addBox(input: NewBox): FullBox {
    const res = this.db
      .prepare(
        `INSERT INTO boxes (creator, owner, size, text, media, announce, created, opened, label, origin, loc, tiles, fwd)
         VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      )
      .run(
        input.creator,
        input.size,
        input.text,
        JSON.stringify(input.media),
        input.announce ? 1 : 0,
        Date.now(),
        input.loc,
        input.loc,
        JSON.stringify(input.tiles),
        JSON.stringify(input.fwd),
      );
    return this.getBox(Number(res.lastInsertRowid))!;
  }

  getBox(id: number): FullBox | null {
    const row = this.db.prepare("SELECT * FROM boxes WHERE id = ?").get(id) as BoxRow | undefined;
    return row ? rowToBox(row) : null;
  }

  boxes(): FullBox[] {
    return (this.db.prepare("SELECT * FROM boxes ORDER BY id").all() as BoxRow[]).map(rowToBox);
  }

  /** Boxes currently standing in world `loc` (held boxes have loc NULL). */
  boxesIn(loc: string): FullBox[] {
    return (this.db.prepare("SELECT * FROM boxes WHERE loc = ? ORDER BY id").all(loc) as BoxRow[]).map(
      rowToBox,
    );
  }

  /** Records the first opening; later openings change nothing. */
  openBox(id: number, ts: number) {
    this.db.prepare("UPDATE boxes SET opened = ? WHERE id = ? AND opened IS NULL").run(ts, id);
  }

  /** Out of the world, into `owner`'s collection. */
  keepBox(id: number, owner: PlayerId, label: string | null) {
    this.db
      .prepare("UPDATE boxes SET owner = ?, label = ?, loc = NULL, tiles = '[]' WHERE id = ?")
      .run(owner, label, id);
  }

  labelBox(id: number, label: string | null) {
    this.db.prepare("UPDATE boxes SET label = ? WHERE id = ?").run(label, id);
  }

  /** A held box goes back into the world. */
  putBox(id: number, loc: string, tiles: number[], fwd: Vec3) {
    this.db
      .prepare("UPDATE boxes SET loc = ?, tiles = ?, fwd = ? WHERE id = ?")
      .run(loc, JSON.stringify(tiles), JSON.stringify(fwd), id);
  }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm test`
Expected: 7 tests pass. Then `npm run typecheck` exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json server/store.ts server/store.test.ts
git commit -m "Store: treasure boxes table with unit tests"
```

---

### Task 3: Server handlers with the smoke test

**Files:**
- Modify: `server/index.ts`
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: `Store.addBox/getBox/boxes/boxesIn/openBox/keepBox/labelBox/putBox`, `FullBox` from Task 2; protocol types from Task 1.
- Produces: the wire behavior every client task relies on. `welcome.boxes` is the full list filtered per viewer. Every change broadcasts `{ t: "box", box }` to both players (filtered per recipient). A refused request answers only the requester with `{ t: "box-deny", reason }`. A `box-open` on an already-opened box (or by the creator) answers the requester with `{ t: "box", box }` and broadcasts nothing.

- [ ] **Step 1: Extend the smoke test (it fails first)**

In `scripts/smoke.mjs`, insert the following block right before the line `a.ws.close();` (the one followed by the `peer-left` expectation):

```js
  // ---- treasure boxes ------------------------------------------------------
  // gloria leaves a box (with a photo); khurlee sees WHERE it is, not what's inside
  const up2 = await fetch(`http://localhost:${PORT}/media`, {
    method: "POST",
    headers: { "content-type": "image/png", "x-planet-pass": PASS },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]),
  });
  const media2 = await up2.json();
  a.send({
    t: "box-place",
    size: "s",
    text: "meet me where the lake is bluest",
    media: [media2],
    announce: true,
    loc: "globe",
    tiles: [43],
    fwd: [0, 0, 1],
  });
  const pa = await a.next();
  const pb = await b.next();
  expect(
    pa.t === "box" && pa.box.text === "meet me where the lake is bluest" && pa.box.media.length === 1,
    "creator sees the contents of the box she left",
  );
  expect(
    pb.t === "box" &&
      pb.box.id === pa.box.id &&
      pb.box.text === undefined &&
      pb.box.media === undefined &&
      pb.box.loc === "globe" &&
      pb.box.origin === "globe" &&
      pb.box.opened === null &&
      pb.box.announce === true,
    "partner sees the sealed box but not its contents",
  );
  const boxId = pa.box.id;

  // refusals: on the partner, overlapping, malformed, creator keeping her own
  b.send({ t: "box-place", size: "s", text: "x", media: [], announce: false, loc: "globe", tiles: [42], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "partner", "can't drop a box on your partner (live tile)");
  b.send({ t: "box-place", size: "m", text: "x", media: [], announce: false, loc: "globe", tiles: [43, 44, 59, 60], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "overlap", "footprints can't overlap");
  b.send({ t: "box-place", size: "l", text: "x", media: [], announce: false, loc: "globe", tiles: [100, 101], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "invalid", "tile count must match the size");
  a.send({ t: "box-keep", id: boxId });
  expect((await a.next()).reason === "creator", "you can't keep a box you left");

  // the creator peeking at her own sealed box does not open it
  a.send({ t: "box-open", id: boxId });
  const peek = await a.next();
  expect(peek.t === "box" && peek.box.opened === null && peek.box.text !== undefined, "creator rereads without unsealing");

  // opening reveals the postcard to both and records the moment
  b.send({ t: "box-open", id: boxId });
  const oa = await a.next();
  const ob = await b.next();
  expect(
    ob.t === "box" && ob.box.text === "meet me where the lake is bluest" && typeof ob.box.opened === "number",
    "opening reveals the postcard",
  );
  expect(oa.t === "box" && oa.box.opened === ob.box.opened, "the creator learns it was opened");

  // keeping with a label takes it out of the world
  b.send({ t: "box-keep", id: boxId, label: "the lake one" });
  await a.next();
  const kb = await b.next();
  expect(
    kb.t === "box" &&
      kb.box.owner === 1 &&
      kb.box.loc === null &&
      kb.box.tiles.length === 0 &&
      kb.box.label === "the lake one" &&
      kb.box.origin === "globe",
    "kept: held by khurlee with a label",
  );

  // only the owner labels or places it
  a.send({ t: "box-label", id: boxId, label: "mine" });
  expect((await a.next()).reason === "owner", "only the owner labels a box");
  a.send({ t: "box-put", id: boxId, loc: "globe", tiles: [200], fwd: [0, 0, 1] });
  expect((await a.next()).reason === "owner", "only the owner places a box");
  b.send({ t: "box-label", id: boxId, label: "the lake postcard" });
  await a.next();
  expect((await b.next()).box.label === "the lake postcard", "owner relabels");

  // back into the world, inside the ger this time
  b.send({ t: "box-put", id: boxId, loc: "ger", tiles: [12], fwd: [1, 0, 0] });
  const ta = await a.next();
  const tb = await b.next();
  expect(tb.t === "box" && tb.box.loc === "ger" && tb.box.tiles[0] === 12 && tb.box.owner === 1, "placed back inside the ger");
  expect(ta.t === "box" && ta.box.text !== undefined, "creator still sees her postcard wherever it stands");
```

Then extend the reconnect check: replace the `w2.names[1] === "K 💙",` line and its closing with:

```js
      w2.names[1] === "K 💙" &&
      w2.boxes.length === 1 &&
      w2.boxes[0].loc === "ger" &&
      w2.boxes[0].label === "the lake postcard" &&
      w2.boxes[0].text === "meet me where the lake is bluest",
    "reconnect: history keeps the text message, not the recalled one; the box is where khurlee put it",
```

- [ ] **Step 2: Run the smoke test to see it fail**

Run: `npm run smoke`
Expected: FAIL at "creator sees the contents of the box she left" (the server ignores unknown messages, so the client times out waiting).

- [ ] **Step 3: Implement the handlers**

In `server/index.ts`, extend the value import from the protocol:

```ts
import {
  BOX_LABEL_MAX_LEN,
  BOX_MEDIA_MAX,
  BOX_TEXT_MAX_LEN,
  CHAT_MAX_LEN,
  MEDIA_MAX_BYTES,
  NAME_MAX_LEN,
  PASS_MIN_LEN,
  RECALL_WINDOW_MS,
  SETUP_CREATOR,
  boxTileCount,
} from "../shared/protocol.ts";
import type {
  Box,
  BoxDenyReason,
  BoxSize,
  ClientMessage,
  MediaRef,
  PlayerId,
  ServerMessage,
  StateData,
  Vec3,
} from "../shared/protocol.ts";
import { Store, type FullBox } from "./store.ts";
```

Add these helpers after the `broadcast` function:

```ts
// ---- treasure boxes ---------------------------------------------------------

/** What `viewer` may see of a box: contents only for the creator, or once opened. */
function viewOf(box: FullBox, viewer: PlayerId): Box {
  const { text, media, ...rest } = box;
  return box.creator === viewer || box.opened !== null ? { ...rest, text, media } : rest;
}

function broadcastBox(box: FullBox) {
  for (const [pid, c] of conns) send(c.ws, { t: "box", box: viewOf(box, pid) });
}

const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

const isMediaRef = (m: unknown): m is MediaRef =>
  typeof m === "object" &&
  m !== null &&
  typeof (m as MediaRef).url === "string" &&
  /^\/media\/[\w.-]+$/.test((m as MediaRef).url) &&
  ((m as MediaRef).kind === "image" || (m as MediaRef).kind === "video");

const isSize = (s: unknown): s is BoxSize => s === "s" || s === "m" || s === "l";

/** Footprint SHAPE only; terrain is the clients' job (both share the seeded world). */
function validFootprint(size: BoxSize, tiles: unknown): tiles is number[] {
  if (!Array.isArray(tiles) || tiles.length !== boxTileCount(size)) return false;
  if (!tiles.every((t) => Number.isInteger(t) && t >= 0)) return false;
  return new Set(tiles).size === tiles.length;
}

/** The partner's tile in `loc`: live when online, else the persisted one; -1 when elsewhere. */
function partnerTileIn(partner: PlayerId, loc: string): number {
  const state = conns.get(partner)?.live ?? store.state(partner);
  return state && state.loc === loc ? state.tile : -1;
}

/** Why a footprint can't stand here, or null when it can. */
function placementDenial(me: PlayerId, loc: string, tiles: number[]): BoxDenyReason | null {
  if (tiles.includes(partnerTileIn((1 - me) as PlayerId, loc))) return "partner";
  const taken = new Set(store.boxesIn(loc).flatMap((b) => b.tiles));
  return tiles.some((t) => taken.has(t)) ? "overlap" : null;
}

const cleanLabel = (raw: unknown) => String(raw ?? "").slice(0, BOX_LABEL_MAX_LEN).trim() || null;
```

Add `boxes: store.boxes().map((b) => viewOf(b, id)),` to the `welcome` object sent in the join handler, right after `history: store.history(200),`.

Add these branches to the message chain, after the `rename` branch (inside `ws.on("message")`):

```ts
    } else if (msg.t === "box-place") {
      const text = String(msg.text ?? "").slice(0, BOX_TEXT_MAX_LEN).trim();
      const media = Array.isArray(msg.media) ? msg.media.filter(isMediaRef).slice(0, BOX_MEDIA_MAX) : [];
      const loc = String(msg.loc ?? "");
      if (
        !isSize(msg.size) ||
        !validFootprint(msg.size, msg.tiles) ||
        !isVec3(msg.fwd) ||
        !loc ||
        (!text && media.length === 0)
      ) {
        send(ws, { t: "box-deny", reason: "invalid" });
        return;
      }
      const denial = placementDenial(id, loc, msg.tiles);
      if (denial) {
        send(ws, { t: "box-deny", reason: denial });
        return;
      }
      const box = store.addBox({
        creator: id,
        size: msg.size,
        text,
        media,
        announce: !!msg.announce,
        loc,
        tiles: msg.tiles,
        fwd: msg.fwd,
      });
      broadcastBox(box);
      console.log(`[planet] ${store.names()[id]} left a ${box.size.toUpperCase()} treasure box #${box.id} in ${loc}`);
    } else if (msg.t === "box-open") {
      const box = store.getBox(Number(msg.id));
      if (!box) {
        send(ws, { t: "box-deny", reason: "missing" });
        return;
      }
      if (box.opened === null && box.creator !== id) {
        store.openBox(box.id, Date.now());
        broadcastBox(store.getBox(box.id)!);
        console.log(`[planet] ${store.names()[id]} opened treasure box #${box.id}`);
      } else {
        send(ws, { t: "box", box: viewOf(box, id) });
      }
    } else if (msg.t === "box-keep") {
      const box = store.getBox(Number(msg.id));
      if (!box) {
        send(ws, { t: "box-deny", reason: "missing" });
        return;
      }
      if (box.creator === id) {
        send(ws, { t: "box-deny", reason: "creator" });
        return;
      }
      if (box.loc === null) {
        send(ws, { t: "box-deny", reason: "missing" }); // not standing anywhere
        return;
      }
      store.keepBox(box.id, id, cleanLabel(msg.label) ?? box.label);
      broadcastBox(store.getBox(box.id)!);
      console.log(`[planet] ${store.names()[id]} kept treasure box #${box.id}`);
    } else if (msg.t === "box-label") {
      const box = store.getBox(Number(msg.id));
      if (!box) {
        send(ws, { t: "box-deny", reason: "missing" });
        return;
      }
      if (box.owner !== id) {
        send(ws, { t: "box-deny", reason: "owner" });
        return;
      }
      store.labelBox(box.id, cleanLabel(msg.label));
      broadcastBox(store.getBox(box.id)!);
    } else if (msg.t === "box-put") {
      const box = store.getBox(Number(msg.id));
      if (!box) {
        send(ws, { t: "box-deny", reason: "missing" });
        return;
      }
      if (box.owner !== id) {
        send(ws, { t: "box-deny", reason: "owner" });
        return;
      }
      const loc = String(msg.loc ?? "");
      if (box.loc !== null || !loc || !validFootprint(box.size, msg.tiles) || !isVec3(msg.fwd)) {
        send(ws, { t: "box-deny", reason: "invalid" });
        return;
      }
      const denial = placementDenial(id, loc, msg.tiles);
      if (denial) {
        send(ws, { t: "box-deny", reason: denial });
        return;
      }
      store.putBox(box.id, loc, msg.tiles, msg.fwd);
      broadcastBox(store.getBox(box.id)!);
      console.log(`[planet] ${store.names()[id]} placed treasure box #${box.id} in ${loc}`);
    }
```

- [ ] **Step 4: Run the smoke test and typecheck**

Run: `npm run smoke && npm run typecheck`
Expected: `SMOKE PASSED`, every new `ok:` line printed, typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts scripts/smoke.mjs
git commit -m "Server: place, open, keep, label and put back treasure boxes"
```

---

### Task 4: Erasable syntax, dynamic blockers and tile neighbors on World

**Files:**
- Modify: `tsconfig.json`
- Modify: `src/world.ts`, `src/grid.ts`, `src/player.ts`, `src/net.ts`, `src/animate.ts`
- Create: `src/world.test.ts`

**Interfaces:**
- Produces on `World`: `neighbors(k: number): number[]` (edge neighbors, no -1 entries) and `setBlocked(tiles: number[], blocked: boolean): void` (runtime blockers that come and go). In `grid.ts`: `setDynamicBlocked(keys: number[], on: boolean)`; `isBlockedFor` and `isFree` consult it. `GlobeWorld` and `RoomWorld` constructors take the same arguments as today but declare fields explicitly.

- [ ] **Step 1: Turn on `erasableSyntaxOnly`**

In `tsconfig.json` add `"erasableSyntaxOnly": true,` after `"strict": true,`.
Run `npm run typecheck` and confirm it reports exactly six `TS1294` errors in `animate.ts`, `net.ts`, `player.ts` and `world.ts` (two in `RoomWorld`).

- [ ] **Step 2: Write the failing world test**

Create `src/world.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { Group, Scene } from "three";
import type { Assets } from "./assets.ts";
import { SPAWN_TILES, isFree, neighborsOf } from "./grid.ts";
import { GlobeWorld, ROOM_SPECS, RoomWorld } from "./world.ts";

// RoomWorld only clones the room model; an empty Group is enough here.
const fakeAssets = { room_house_a: new Group() } as unknown as Assets;

test("globe: neighbors drop the -1 entries and setBlocked toggles walkability", () => {
  const globe = new GlobeWorld(new Scene());
  const k = SPAWN_TILES[0];
  assert.deepEqual(globe.neighbors(k), neighborsOf(k).filter((n) => n >= 0));
  assert.equal(globe.isBlockedFor(k, "donkey"), false);
  globe.setBlocked([k], true);
  assert.equal(globe.isBlockedFor(k, "donkey"), true);
  assert.equal(globe.isBlockedFor(k, "bee"), true, "boxes stop flyers too");
  assert.equal(isFree(k), false, "scatter placement sees the box");
  globe.setBlocked([k], false);
  assert.equal(globe.isBlockedFor(k, "donkey"), false);
});

test("room: neighbors stay inside the grid and boxes never unblock furniture", () => {
  const room = new RoomWorld("b0", "house_a", fakeAssets);
  const { w } = ROOM_SPECS.house_a;
  const corner = room.key(0, 0);
  assert.deepEqual(room.neighbors(corner).sort(), [room.key(1, 0), room.key(0, 1)].sort());
  assert.equal(room.neighbors(room.key(2, 2)).length, 4);
  const furniture = room.key(1, 1); // blocked in ROOM_SPECS.house_a
  assert.equal(room.isBlockedFor(furniture, "donkey"), true);
  room.setBlocked([furniture, room.key(2, 2)], true);
  room.setBlocked([furniture, room.key(2, 2)], false);
  assert.equal(room.isBlockedFor(furniture, "donkey"), true, "furniture survives a box being picked up");
  assert.equal(room.isBlockedFor(room.key(2, 2), "donkey"), false);
  assert.equal(w, 6);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test`
Expected: FAIL with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX ... TypeScript parameter property is not supported in strip-only mode` from `world.ts`.

- [ ] **Step 4: Fix the four files**

`src/grid.ts`: add after the `water` set declaration:

```ts
const dynamicBlocked = new Set<number>(); // treasure boxes: come and go at runtime

/** Runtime blockers on globe tiles (treasure boxes). */
export function setDynamicBlocked(keys: number[], on: boolean): void {
  for (const k of keys) {
    if (on) dynamicBlocked.add(k);
    else dynamicBlocked.delete(k);
  }
}
```

and change the two predicates:

```ts
export function isBlockedFor(k: number, canFly: boolean): boolean {
  return blocked.has(k) || dynamicBlocked.has(k) || (!canFly && water.has(k));
}

export function isFree(k: number): boolean {
  return !blocked.has(k) && !dynamicBlocked.has(k) && !occupiedDecor.has(k) && !water.has(k);
}
```

`src/world.ts`: add to the `World` interface after `areNeighbors`:

```ts
  /** Edge neighbors of a tile (never -1). */
  neighbors(k: number): number[];
  /** Runtime blockers (treasure boxes) that come and go. */
  setBlocked(tiles: number[], blocked: boolean): void;
```

Import `setDynamicBlocked` from `./grid.ts`. Replace the `GlobeWorld` header:

```ts
export class GlobeWorld implements World {
  id = "globe";
  isGlobe = true;
  scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }
```

and add the two methods after `areNeighbors` in `GlobeWorld`:

```ts
  neighbors(k: number) {
    return neighborsOf(k).filter((n) => n >= 0);
  }

  setBlocked(tiles: number[], blocked: boolean) {
    setDynamicBlocked(tiles, blocked);
  }
```

Replace the `RoomWorld` header and constructor with:

```ts
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
```

Delete the old `private w: number; private h: number;` lines that followed the constructor and the old `private blocked` field. Replace `isBlockedFor` and add the two methods:

```ts
  isBlockedFor(k: number, _character: CharacterId) {
    return this.furniture.has(k) || this.boxes.has(k);
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
```

`src/player.ts`: replace `constructor(private globe: GlobeWorld) {` with

```ts
  private globe: GlobeWorld;

  constructor(globe: GlobeWorld) {
    this.globe = globe;
```

`src/net.ts`: replace `constructor(private handlers: NetHandlers) {}` with

```ts
  private handlers: NetHandlers;

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
  }
```

`src/animate.ts`: replace the constructor with

```ts
  private assets: Assets;

  constructor(assets: Assets, character: CharacterId, scene: Scene) {
    this.assets = assets;
    this.shadow = makeBlobShadow();
    scene.add(this.container, this.shadow);
    this.setCharacter(character);
  }
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: store tests plus the 2 world tests pass; typecheck exit 0 with `erasableSyntaxOnly` on.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json src/world.ts src/grid.ts src/player.ts src/net.ts src/animate.ts src/world.test.ts
git commit -m "World: runtime blockers, tile neighbors, erasable syntax so Node can run client modules"
```

---

### Task 5: The footprint function

**Files:**
- Create: `src/footprint.ts`
- Create: `src/footprint.test.ts`

**Interfaces:**
- Consumes: `World` (`tilePos`, `up`, `neighborInDirection`, `dirBetween`, `areNeighbors`) from Task 4; `BOX_SIZES`, `BoxSize` from Task 1.
- Produces: `footprintFor(world: World, tile: number, forward: Vector3, size: BoxSize, free: (k: number) => boolean): number[] | null`. Tiles come back row-major: rows away from the player, columns left to right. Null when the size does not fit.

- [ ] **Step 1: Write the failing tests**

Create `src/footprint.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { Group, Scene, Vector3 } from "three";
import { BOX_SIZES, N, type BoxSize } from "../shared/protocol.ts";
import type { Assets } from "./assets.ts";
import { footprintFor } from "./footprint.ts";
import {
  SPAWN_TILES,
  TILE_COUNT,
  greatCircleDir,
  key,
  neighborInDirection,
  neighborsOf,
  spawnForward,
  tileCenter,
} from "./grid.ts";
import { GlobeWorld, RoomWorld, type World } from "./world.ts";

const fakeAssets = { room_house_a: new Group(), room_barn: new Group() } as unknown as Assets;
const yes = () => true;

/** Row-major rectangle check: every tile touches its right and forward neighbor. */
function isRect(world: World, tiles: number[], cols: number) {
  const rows = tiles.length / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = tiles[r * cols + c];
      if (c + 1 < cols && !world.areNeighbors(k, tiles[r * cols + c + 1])) return false;
      if (r + 1 < rows && !world.areNeighbors(k, tiles[(r + 1) * cols + c])) return false;
    }
  }
  return true;
}

test("room: S and M from (2,2) facing the back wall", () => {
  const room = new RoomWorld("b0", "house_a", fakeAssets); // 6 x 5
  const fwd = new Vector3(0, 0, -1); // toward smaller j
  assert.deepEqual(footprintFor(room, room.key(2, 2), fwd, "s", yes), [room.key(2, 1)]);
  assert.deepEqual(footprintFor(room, room.key(2, 2), fwd, "m", yes), [
    room.key(2, 1),
    room.key(3, 1),
    room.key(2, 0),
    room.key(3, 0),
  ]);
});

test("room: walls and furniture stop a footprint", () => {
  const room = new RoomWorld("b0", "house_a", fakeAssets);
  const fwd = new Vector3(0, 0, -1);
  assert.equal(footprintFor(room, room.key(2, 0), fwd, "s", yes), null, "facing the wall");
  const free = (k: number) => !room.isBlockedFor(k, "donkey");
  // (1,1) is furniture in house_a: row 2 of an M from (1,3) lands on it
  assert.deepEqual(footprintFor(room, room.key(1, 3), fwd, "s", free), [room.key(1, 2)]);
  assert.equal(footprintFor(room, room.key(1, 3), fwd, "m", free), null);
});

test("room: L in the barn from (0,3) facing +X is 3 wide and 4 deep, centered", () => {
  const barn = new RoomWorld("b1", "barn", fakeAssets); // 6 x 8
  const got = footprintFor(barn, barn.key(0, 3), new Vector3(1, 0, 0), "l", yes);
  const want: number[] = [];
  for (let r = 1; r <= 4; r++) for (const c of [-1, 0, 1]) want.push(barn.key(r, 3 + c));
  assert.deepEqual(got, want);
  // (4,2) is furniture in the barn
  assert.equal(footprintFor(barn, barn.key(0, 3), new Vector3(1, 0, 0), "l", (k) => !barn.isBlockedFor(k, "donkey")), null);
});

test("globe: all three sizes fit at the spawn and form rectangles", () => {
  const globe = new GlobeWorld(new Scene());
  const fwd = spawnForward(0);
  const s = footprintFor(globe, SPAWN_TILES[0], fwd, "s", yes)!;
  assert.deepEqual(s, [neighborInDirection(SPAWN_TILES[0], fwd)]);
  const m = footprintFor(globe, SPAWN_TILES[0], fwd, "m", yes)!;
  assert.equal(m.length, 4);
  assert.ok(isRect(globe, m, 2));
  const l = footprintFor(globe, SPAWN_TILES[0], fwd, "l", yes)!;
  assert.deepEqual(l, [663, 647, 631, 664, 648, 632, 665, 649, 633, 666, 650, 634]);
  assert.ok(isRect(globe, l, 3));
  assert.equal(new Set(l).size, 12);
});

test("globe: a free tile rule is honored", () => {
  const globe = new GlobeWorld(new Scene());
  const fwd = spawnForward(0);
  const front = neighborInDirection(SPAWN_TILES[0], fwd);
  assert.equal(footprintFor(globe, SPAWN_TILES[0], fwd, "s", (k) => k !== front), null);
});

test("globe survey: rectangles always close except right at the cube corners", () => {
  const globe = new GlobeWorld(new Scene());
  const corners: Vector3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(new Vector3(x, y, z).normalize());
  const tileAngle = Math.PI / 2 / N; // one tile of arc, roughly
  const dir = new Vector3();
  const survey = (size: BoxSize, maxFailDistTiles: number) => {
    const cols = BOX_SIZES[size].cols.length;
    let total = 0;
    let fails = 0;
    for (let k = 0; k < TILE_COUNT; k++) {
      for (const nb of neighborsOf(k)) {
        if (nb < 0) continue;
        total++;
        greatCircleDir(tileCenter(k), tileCenter(nb), dir);
        const fp = footprintFor(globe, k, dir, size, yes);
        if (!fp) {
          fails++;
          const dist = Math.min(...corners.map((c) => tileCenter(k).angleTo(c))) / tileAngle;
          assert.ok(dist < maxFailDistTiles, `${size} failed ${dist.toFixed(2)} tiles from a corner at tile ${k}`);
        } else {
          assert.equal(new Set(fp).size, fp.length, `duplicate tile in ${size} at ${k}`);
          assert.ok(isRect(globe, fp, cols), `${size} at ${k} is not a rectangle`);
        }
      }
    }
    return { total, fails };
  };
  assert.deepEqual(survey("m", 1.5), { total: 6144, fails: 48 });
  assert.deepEqual(survey("l", 3), { total: 6144, fails: 192 });
  // face centers never fail
  for (let f = 0; f < 6; f++) {
    const k = key(f, 7, 7);
    for (const nb of neighborsOf(k)) {
      greatCircleDir(tileCenter(k), tileCenter(nb), dir);
      assert.ok(footprintFor(globe, k, dir, "l", yes), `L should fit at the center of face ${f}`);
    }
  }
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/footprint.ts'`.

- [ ] **Step 3: Implement `src/footprint.ts`**

```ts
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
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all footprint tests pass (the survey numbers 48 and 192 were measured against this exact grid), typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/footprint.ts src/footprint.test.ts
git commit -m "Footprint: where a treasure box of each size would stand"
```

---

### Task 6: The three chest models

**Files:**
- Create: `assets/blender/treasure.py`
- Modify: `assets/blender/_common.py` (palette)
- Modify: `src/assets.ts` (manifest)
- Generated: `public/models/chest_s.glb`, `chest_m.glb`, `chest_l.glb`

**Interfaces:**
- Produces: assets `chest_s`, `chest_m`, `chest_l` on the `Assets` record, each a `Group` whose front faces three.js +Z and which contains a node named `Lid` hinged at the back top edge. Rotating `Lid` about its local X by a negative angle opens it.

- [ ] **Step 1: Add the palette entries**

In `assets/blender/_common.py`, add to `PALETTE` after `"cat_eye"`:

```python
    "chest": "b5763f",
    "chest_dark": "7d4f2a",
    "gold": "e2b34a",
    "iron": "6d6a66",
```

- [ ] **Step 2: Write the model script**

Create `assets/blender/treasure.py`:

```python
"""Treasure chests in three sizes (S = one tile, M = 2x2, L = 3x4 tiles).

Origin at the base center, the front (lock side) faces -Y like every other
model. The lid is a separate object named `Lid` whose origin sits ON THE HINGE
(the back top edge of the body): the client opens it by rotating around local
X with a negative angle. Body dimensions are (width, depth, height) in units;
a tile is 2 units, so chests stay a little smaller than their footprint."""

import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402


def chest(name, w, d, h):
    body_h = h * 0.62
    lid_h = h - body_h
    wood = C.mat("chest")
    dark = C.mat("chest_dark")
    gold = C.mat("gold", 0.45)
    iron = C.mat("iron", 0.6)
    band_w = w * 0.08
    bevel = min(w, d, body_h) * 0.06

    b = C.Build(name)
    b.box(wood, (w, d, body_h), loc=(0, 0, body_h / 2), bevel=bevel)
    # a darker base plank so the chest reads as sitting on the ground
    b.box(dark, (w * 1.02, d * 1.02, h * 0.06), loc=(0, 0, h * 0.03))
    # two vertical bands around the body
    for x in (-w * 0.28, w * 0.28):
        b.box(gold, (band_w, d * 1.03, body_h * 1.01), loc=(x, 0, body_h / 2))
    # lock plate + keyhole knob on the front
    b.box(gold, (w * 0.16, d * 0.04, body_h * 0.28), loc=(0, -d / 2 - d * 0.015, body_h * 0.78))
    b.uvsphere(iron, min(w, d) * 0.04, loc=(0, -d / 2 - d * 0.04, body_h * 0.7), u=8, v=6)
    b.obj()

    # the lid, built relative to its hinge at (0, +d/2, body_h)
    lid = C.Build("Lid")
    lid.box(wood, (w, d, lid_h), loc=(0, -d / 2, lid_h / 2), bevel=lid_h * 0.4)
    for x in (-w * 0.28, w * 0.28):
        lid.box(gold, (band_w, d * 1.03, lid_h * 1.02), loc=(x, -d / 2, lid_h / 2))
    lid.obj(location=(0, d / 2, body_h))


for name, dims in (
    ("chest_s", (1.2, 0.9, 0.8)),
    ("chest_m", (3.0, 3.0, 1.6)),
    ("chest_l", (5.0, 7.0, 2.4)),
):
    C.reset_scene()
    chest("Chest" + name[-1].upper(), *dims)
    C.export_glb(f"{name}.glb")
```

- [ ] **Step 3: Generate the models**

Run: `npm run models`
Expected: the log shows `> treasure.py` followed by three `exported .../chest_*.glb` lines and ends with `all models exported.` (every other model is regenerated too; that is normal).

- [ ] **Step 4: Check the GLBs carry the Lid node at the hinge**

Run:

```bash
node -e '
const fs = require("fs");
const dims = { s: [1.2, 0.9, 0.8], m: [3.0, 3.0, 1.6], l: [5.0, 7.0, 2.4] };
for (const s of ["s", "m", "l"]) {
  const buf = fs.readFileSync(`public/models/chest_${s}.glb`);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString());
  const lid = json.nodes.find((n) => n.name === "Lid");
  if (!lid) { console.error(`chest_${s}: no Lid node`, json.nodes.map((n) => n.name)); process.exit(1); }
  const [, d, h] = dims[s];
  const want = [0, h * 0.62, -d / 2]; // Blender (0, d/2, body_h) -> glTF (x, z, -y)
  const ok = lid.translation.every((v, i) => Math.abs(v - want[i]) < 1e-3);
  console.log(`chest_${s}: Lid at`, lid.translation, ok ? "ok" : `expected ${want}`);
  if (!ok) process.exit(1);
}'
```

Expected: three `ok` lines.

- [ ] **Step 5: Register the assets**

In `src/assets.ts` add to `MANIFEST` after `room_frauenkirche`:

```ts
  chest_s: "/models/chest_s.glb",
  chest_m: "/models/chest_m.glb",
  chest_l: "/models/chest_l.glb",
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck` (exit 0), then:

```bash
git add assets/blender/treasure.py assets/blender/_common.py src/assets.ts public/models/chest_s.glb public/models/chest_m.glb public/models/chest_l.glb
git commit -m "Models: treasure chests in three sizes with a hinged Lid node"
```

If `npm run models` changed other `.glb` files byte-for-byte differently (Blender exports are not always deterministic), leave them out of this commit unless they render differently; `git status` should list only the three chests plus the sources.

---

### Task 7: Client plumbing and HUD markup

**Files:**
- Modify: `src/chat.ts` (exports, Enter guard, public `setOpen`)
- Modify: `src/input.ts` (mute)
- Modify: `src/net.ts` (box methods)
- Modify: `index.html` (actions stack, treasures button and panel, postcard container, toast, styles)
- Modify: `package.json` (font dependency)

**Interfaces:**
- Produces: `chat.ts` exports `EMOJI`, `mediaElement`, `openLightbox`, `uploadMedia`, and `Chat.setOpen(open)` is public. `Input.setMuted(on: boolean)`. `Net.placeBox(draft)`, `Net.openBox(id)`, `Net.keepBox(id, label?)`, `Net.labelBox(id, label)`, `Net.putBox(id, loc, tiles, fwd)`. DOM ids: `#actions` (with `#enter` and `#box-btn`), `#treasure-open`, `#treasure-badge`, `#treasure-panel`, `#treasure-min`, `#treasure-waiting`, `#treasure-leave`, `#treasure-mine`, `#treasure-left`, `#postcard`, `#pc-file`, `#toast`.

- [ ] **Step 1: Install the handwriting font**

Run: `npm install --save-dev @fontsource/caveat`
Expected: `package.json` gains `"@fontsource/caveat"` under `devDependencies` and `package-lock.json` updates.

- [ ] **Step 2: `chat.ts` exports and the Enter guard**

Add `export` in front of `const EMOJI`, `function openLightbox`, `function mediaElement` and `async function uploadMedia`.
Change `private setOpen(open: boolean)` to `setOpen(open: boolean)`.
Add this helper at module level (next to `project`):

```ts
/** Inputs and text areas anywhere (chat box, postcard) must keep their Enter key. */
function isTypingElement(el: Element | null): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}
```

and change the Enter branch of the global keydown listener in the `Chat` constructor to:

```ts
      } else if (
        e.code === "Enter" &&
        document.activeElement !== this.input &&
        !isTypingElement(document.activeElement) &&
        document.getElementById("postcard")?.hidden !== false
      ) {
```

- [ ] **Step 3: `input.ts` mute**

Add a field and method to `Input`:

```ts
  /** While a dialog is open nothing walks, even with keys or the d-pad held. */
  private muted = false;

  setMuted(on: boolean) {
    this.muted = on;
    if (on) this.keys.clear();
    this.recompute();
  }
```

and make `recompute` start with:

```ts
    if (this.muted) {
      this.x = 0;
      this.y = 0;
      this.fast = false;
      return;
    }
```

- [ ] **Step 4: `net.ts` methods**

Extend the type import with `BoxSize` and `Vec3`, and add after `rename`:

```ts
  placeBox(draft: {
    size: BoxSize;
    text: string;
    media: MediaRef[];
    announce: boolean;
    loc: string;
    tiles: number[];
    fwd: Vec3;
  }) {
    this.send({ t: "box-place", ...draft });
  }

  openBox(id: number) {
    this.send({ t: "box-open", id });
  }

  keepBox(id: number, label?: string) {
    this.send(label ? { t: "box-keep", id, label } : { t: "box-keep", id });
  }

  labelBox(id: number, label: string) {
    this.send({ t: "box-label", id, label });
  }

  putBox(id: number, loc: string, tiles: number[], fwd: Vec3) {
    this.send({ t: "box-put", id, loc, tiles, fwd });
  }
```

- [ ] **Step 5: HUD markup in `index.html`**

Replace `<button id="enter" hidden>Enter</button>` with:

```html
    <div id="actions">
      <button id="enter" hidden>Enter</button>
      <button id="box-btn" hidden>Open the treasure box 🎁 (E)</button>
    </div>
```

Change the existing chat minimize glyph so both panels match: in `<button id="chat-min" title="Minimize">` replace the em dash character with an en dash `–`.
Insert right after `<div id="bubbles"></div>`:

```html
    <button id="treasure-open" title="Treasures">🎁<span id="treasure-badge" hidden></span></button>
    <div id="treasure-panel" hidden>
      <header>
        <span>Treasures 🎁</span>
        <button id="treasure-min" title="Minimize">–</button>
      </header>
      <div id="treasure-body">
        <p id="treasure-waiting"></p>
        <button id="treasure-leave">Leave a treasure here 🎁</button>
        <h3>Your collection</h3>
        <div id="treasure-mine" class="tr-list" data-empty="Nothing kept yet. Go looking!"></div>
        <h3>Boxes you left</h3>
        <div id="treasure-left" class="tr-list" data-empty="You haven't left any treasure yet."></div>
      </div>
    </div>
```

Insert right after `<div id="lightbox" hidden></div>`:

```html
    <div id="postcard" hidden></div>
    <input id="pc-file" type="file" accept="image/*,video/*" multiple hidden />
    <div id="toast" hidden></div>
```

- [ ] **Step 6: Styles in `index.html`**

Replace the `#enter { ... }` and `#enter:hover { ... }` rules with:

```css
      #actions {
        position: fixed;
        bottom: 68px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
      }
      #actions button {
        border: none;
        border-radius: 14px;
        padding: 10px 18px;
        font: inherit;
        font-size: 15px;
        font-weight: 600;
        background: #58b368;
        color: white;
        cursor: pointer;
        box-shadow: 0 2px 12px rgba(30, 60, 30, 0.3);
        white-space: nowrap;
      }
      #actions button:hover {
        transform: translateY(-1px);
      }
      #actions button[hidden] {
        display: none;
      }
      #box-btn {
        background: #d9962f;
        box-shadow: 0 2px 12px rgba(90, 60, 10, 0.3);
      }
```

Add before the `#loading,` rule:

```css
      /* --- treasures ---------------------------------------------------- */
      #treasure-open {
        position: fixed;
        top: 14px;
        left: 14px;
        border: none;
        border-radius: 14px;
        padding: 8px 11px;
        font-size: 15px;
        background: rgba(255, 255, 253, 0.45);
        cursor: pointer;
        box-shadow: 0 1px 6px rgba(30, 60, 30, 0.12);
        opacity: 0.85;
      }
      #treasure-open[hidden],
      #treasure-panel[hidden] {
        display: none;
      }
      #treasure-badge {
        position: absolute;
        top: -6px;
        right: -6px;
        background: #d9962f;
        color: white;
        font-size: 11px;
        border-radius: 9px;
        padding: 2px 6px;
      }
      #treasure-panel {
        position: fixed;
        top: 14px;
        left: 14px;
        width: min(270px, calc(100vw - 28px));
        background: rgba(255, 255, 253, 0.42);
        backdrop-filter: blur(7px);
        -webkit-backdrop-filter: blur(7px);
        border-radius: 14px;
        box-shadow: 0 1px 6px rgba(30, 60, 30, 0.12);
        overflow: hidden;
        font-size: 12.5px;
        color: rgba(43, 58, 42, 0.85);
      }
      #treasure-panel header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 8px 8px 12px;
        font-weight: 600;
      }
      #treasure-min {
        border: none;
        background: none;
        font: inherit;
        cursor: pointer;
        padding: 0 6px;
        color: var(--ink);
      }
      #treasure-body {
        max-height: 60vh;
        overflow-y: auto;
        padding: 0 10px 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #treasure-body h3 {
        font-size: 10.5px;
        text-transform: uppercase;
        letter-spacing: 0.7px;
        opacity: 0.6;
        margin-top: 6px;
      }
      #treasure-waiting {
        font-size: 12.5px;
      }
      #treasure-leave {
        border: none;
        border-radius: 12px;
        padding: 9px 14px;
        font: inherit;
        font-size: 13.5px;
        font-weight: 600;
        background: #58b368;
        color: white;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(30, 60, 30, 0.25);
      }
      .tr-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .tr-list:empty::before {
        content: attr(data-empty);
        opacity: 0.55;
        font-size: 12px;
      }
      .tr-row {
        display: grid;
        grid-template-columns: 40px 1fr;
        gap: 4px 8px;
        align-items: center;
        background: rgba(255, 255, 253, 0.5);
        border-radius: 10px;
        padding: 6px 8px;
      }
      .tr-thumb {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        background: rgba(43, 58, 42, 0.08);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        overflow: hidden;
      }
      .tr-thumb img,
      .tr-thumb video {
        width: 40px;
        height: 40px;
        object-fit: cover;
        display: block;
        cursor: pointer;
      }
      .tr-title {
        font-weight: 600;
        font-size: 12.5px;
        overflow-wrap: anywhere;
      }
      .tr-title.faint {
        font-weight: 400;
        font-style: italic;
        opacity: 0.55;
      }
      .tr-meta {
        font-size: 11px;
        opacity: 0.7;
      }
      .tr-actions {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .tr-actions button {
        border: none;
        border-radius: 9px;
        padding: 4px 9px;
        font: inherit;
        font-size: 11.5px;
        background: rgba(43, 58, 42, 0.09);
        color: var(--ink);
        cursor: pointer;
      }
      .tr-actions button:hover {
        background: rgba(43, 58, 42, 0.16);
      }
      #toast[hidden] {
        display: none;
      }
      #toast {
        position: fixed;
        bottom: 118px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(43, 58, 42, 0.9);
        color: white;
        padding: 8px 14px;
        border-radius: 12px;
        font-size: 13px;
        z-index: 11;
        max-width: min(90vw, 360px);
        text-align: center;
      }
      /* --- postcard ----------------------------------------------------- */
      #postcard[hidden] {
        display: none;
      }
      #postcard {
        position: fixed;
        inset: 0;
        z-index: 9;
        background: rgba(30, 40, 60, 0.55);
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        overflow-y: auto;
        padding: 28px 16px 40px;
      }
      .pc-sheet {
        width: min(640px, 100%);
        display: flex;
        flex-direction: column;
        gap: 18px;
        margin: auto 0;
        position: relative;
      }
      .pc-close {
        position: absolute;
        top: -12px;
        right: -12px;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: none;
        background: rgba(255, 255, 253, 0.92);
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25);
        cursor: pointer;
        font-size: 12px;
        z-index: 1;
      }
      .pc-card {
        aspect-ratio: 3 / 2;
        display: grid;
        grid-template-columns: 58fr 42fr;
        background-color: #fbf6e9;
        background-image: radial-gradient(rgba(120, 90, 40, 0.05) 1px, transparent 1px);
        background-size: 5px 5px;
        border-radius: 6px;
        border: 1px solid #d9cfba;
        box-shadow:
          0 12px 32px rgba(20, 30, 40, 0.4),
          inset 0 0 0 4px #fbf6e9,
          inset 0 0 0 5px #d9cfba;
        position: relative;
        overflow: hidden;
      }
      .pc-card > * {
        min-height: 0;
      }
      .pc-msg {
        padding: 28px 22px 26px 28px;
        position: relative;
        display: flex;
        overflow: hidden;
      }
      .pc-msg::after {
        content: "";
        position: absolute;
        top: 24px;
        bottom: 24px;
        right: 0;
        border-right: 1.5px dashed #c9bda3;
      }
      .pc-text {
        font-family: Caveat, "Segoe Print", "Bradley Hand", cursive;
        font-weight: 500;
        font-size: 22px;
        line-height: 1.35;
        color: #2f3a5a;
        white-space: pre-wrap;
        overflow-wrap: break-word;
        width: 100%;
        height: 100%;
        overflow-y: auto;
        background: transparent;
        border: none;
        resize: none;
        outline: none;
        padding: 0;
        margin: 0;
      }
      .pc-text::placeholder {
        color: rgba(47, 58, 90, 0.35);
      }
      .pc-empty {
        color: rgba(47, 58, 90, 0.45);
        font-style: italic;
      }
      .pc-count {
        position: absolute;
        left: 28px;
        bottom: 8px;
        font-size: 10px;
        color: rgba(47, 58, 90, 0.4);
      }
      .pc-side {
        padding: 18px 20px 18px 22px;
        display: flex;
        flex-direction: column;
        position: relative;
        color: #2f3a5a;
      }
      .pc-stamp {
        align-self: flex-end;
        width: 58px;
        height: 70px;
        background: #e9eef6;
        border: 3px dotted #fbf6e9;
        outline: 1px solid #c9bda3;
        border-radius: 2px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        font-size: 26px;
        line-height: 1;
      }
      .pc-stamp small {
        font-size: 6.5px;
        letter-spacing: 1px;
        font-weight: 600;
        opacity: 0.7;
      }
      .pc-postmark {
        position: absolute;
        top: 46px;
        right: 64px;
        width: 76px;
        height: 76px;
        border-radius: 50%;
        border: 1.5px solid rgba(47, 58, 90, 0.5);
        outline: 1.5px solid rgba(47, 58, 90, 0.5);
        outline-offset: -7px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        font-size: 8.5px;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        text-align: center;
        color: rgba(47, 58, 90, 0.7);
        transform: rotate(-12deg);
        pointer-events: none;
        padding: 0 10px;
      }
      .pc-to {
        margin-top: 30px;
        font-size: 13px;
      }
      .pc-to b {
        font-family: Caveat, cursive;
        font-size: 21px;
        font-weight: 500;
      }
      .pc-line {
        border-bottom: 1px dotted rgba(47, 58, 90, 0.45);
        height: 26px;
        font-family: Caveat, cursive;
        font-size: 18px;
        padding-left: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pc-from {
        margin-top: auto;
        align-self: flex-end;
        font-family: Caveat, cursive;
        font-size: 20px;
        transform: rotate(-3deg);
      }
      .pc-prints {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        justify-content: center;
      }
      .pc-print {
        background: #fff;
        padding: 8px 8px 24px;
        box-shadow: 0 5px 16px rgba(0, 0, 0, 0.35);
        transform: rotate(-2deg);
        position: relative;
      }
      .pc-print:nth-child(even) {
        transform: rotate(2deg);
      }
      .pc-print img,
      .pc-print video {
        display: block;
        width: 150px;
        height: 150px;
        object-fit: cover;
        cursor: pointer;
        margin: 0;
        border-radius: 0;
        max-width: none;
        max-height: none;
      }
      .pc-x {
        position: absolute;
        top: -9px;
        right: -9px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: none;
        background: rgba(43, 58, 42, 0.85);
        color: white;
        font-size: 10px;
        cursor: pointer;
      }
      .pc-add {
        width: 166px;
        height: 190px;
        border: 2px dashed rgba(255, 255, 253, 0.6);
        border-radius: 8px;
        background: rgba(255, 255, 253, 0.15);
        color: white;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .pc-add[hidden] {
        display: none;
      }
      .pc-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 10px;
        color: white;
        font-size: 14px;
      }
      .pc-sizes {
        display: flex;
        gap: 6px;
      }
      .pc-sizes button {
        border: 2px solid transparent;
        border-radius: 12px;
        padding: 6px 10px;
        background: rgba(255, 255, 253, 0.85);
        color: var(--ink);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .pc-sizes button.picked {
        border-color: #58b368;
        background: #e3f3d9;
      }
      .pc-sizes button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .pc-announce {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
      }
      .pc-primary {
        border: none;
        border-radius: 14px;
        padding: 10px 18px;
        font: inherit;
        font-size: 15px;
        font-weight: 600;
        background: #58b368;
        color: white;
        cursor: pointer;
        box-shadow: 0 2px 12px rgba(30, 60, 30, 0.3);
      }
      .pc-primary:disabled {
        opacity: 0.5;
        cursor: wait;
      }
      .pc-secondary {
        border: none;
        border-radius: 14px;
        padding: 10px 14px;
        font: inherit;
        font-size: 14px;
        background: rgba(255, 255, 253, 0.85);
        color: var(--ink);
        cursor: pointer;
      }
      .pc-label {
        border: none;
        border-radius: 12px;
        padding: 9px 12px;
        font: inherit;
        font-size: 14px;
        background: rgba(255, 255, 253, 0.92);
        color: var(--ink);
        width: min(100%, 260px);
        outline-color: #58b368;
      }
      .pc-error {
        width: 100%;
        text-align: center;
        color: #ffb4b4;
        font-size: 13px;
        min-height: 1em;
      }
      .pc-footer {
        width: 100%;
        text-align: center;
        color: rgba(255, 255, 253, 0.85);
        font-size: 13px;
      }
      @media (max-width: 560px) {
        .pc-card {
          aspect-ratio: auto;
          grid-template-columns: 1fr;
        }
        .pc-msg {
          min-height: 220px;
          padding: 24px 20px 26px 22px;
        }
        .pc-msg::after {
          border-right: none;
          border-bottom: 1.5px dashed #c9bda3;
          top: auto;
          bottom: 0;
          left: 22px;
          right: 22px;
        }
        .pc-text {
          font-size: 20px;
          height: auto;
          min-height: 170px;
        }
        .pc-count {
          left: 22px;
        }
        .pc-side {
          padding-top: 22px;
        }
        .pc-postmark {
          top: 36px;
          right: 62px;
        }
        .pc-print img,
        .pc-print video {
          width: 120px;
          height: 120px;
        }
      }
```

- [ ] **Step 7: Typecheck and a quick look**

Run: `npm run typecheck` (exit 0).
Start `npm run dev` in a second terminal, open http://localhost:5173, log in, and confirm the 🎁 button sits top-left and the page otherwise looks unchanged (the panel and postcard are still inert). Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/chat.ts src/input.ts src/net.ts index.html
git commit -m "Client plumbing for treasures: HUD markup, postcard styles, net methods, input mute"
```

---

### Task 8: The postcard dialog

**Files:**
- Create: `src/postcard.ts`

**Interfaces:**
- Consumes: `EMOJI`, `mediaElement` from `chat.ts` (Task 7); DOM `#postcard`, `#pc-file` and the `.pc-*` styles (Task 7); protocol limits (Task 1).
- Produces: `class Postcard` with `constructor(onToggle: (open: boolean) => void)`, `compose(opts: ComposeOptions)`, `read(opts: ReadOptions)`, `close()`, `get isOpen`. Types `Postmark`, `Draft`, `ComposeOptions`, `ReadOptions`. Element ids the drive script uses: `#pc-send`, `#pc-keep`, `#pc-leave`, `#pc-close`, `textarea.pc-text`, `input.pc-label`, `[data-size="s|m|l"]`.

- [ ] **Step 1: Write `src/postcard.ts`**

```ts
import "@fontsource/caveat/500.css";
import {
  BOX_LABEL_MAX_LEN,
  BOX_MEDIA_MAX,
  BOX_TEXT_MAX_LEN,
  MEDIA_MAX_BYTES,
  type Box,
  type BoxSize,
  type CharacterId,
} from "../shared/protocol.ts";
import { EMOJI, mediaElement } from "./chat.ts";

/** Who wrote the card, who it is for, and where and when it was left. */
export type Postmark = { from: string; fromChar: CharacterId; to: string; place: string; date: Date };

export type Draft = { text: string; files: File[]; size: BoxSize; announce: boolean };

export type ComposeOptions = {
  mark: Postmark;
  /** Which sizes fit where the player stands right now. */
  fits: Record<BoxSize, boolean>;
  /** Resolve once the box stands in the world; reject with a message to show. */
  onSend: (draft: Draft) => Promise<void>;
};

export type ReadOptions = {
  box: Box; // with text and media present
  mark: Postmark;
  /** finder: may keep it. creator: sees the sealed/opened footer. owner: reading from the panel. */
  role: "finder" | "creator" | "owner";
  openedBy: string; // the partner's name, for the creator's footer
  onKeep: (label: string) => void;
};

const ORDER: BoxSize[] = ["s", "m", "l"];
const SIZE_LABEL: Record<BoxSize, string> = { s: "S · 1 square", m: "M · 4 squares", l: "L · 12 squares" };

const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The postcard dialog: one overlay (#postcard) rebuilt for every card.
 * Compose mode writes straight onto the card; reading mode shows a card
 * someone left. Knows nothing about the network - decisions come back through
 * the callbacks in the options.
 */
export class Postcard {
  private root: HTMLElement;
  private fileInput: HTMLInputElement;
  private onToggle: (open: boolean) => void;
  /** Returns false to keep the dialog open (a half-written card). */
  private guard: (() => boolean) | null = null;
  private cleanup: (() => void) | null = null;

  constructor(onToggle: (open: boolean) => void) {
    this.onToggle = onToggle;
    const root = document.getElementById("postcard");
    const file = document.getElementById("pc-file");
    if (!root || !(file instanceof HTMLInputElement)) throw new Error("missing #postcard / #pc-file");
    this.root = root;
    this.fileInput = file;
    addEventListener("keydown", (e) => {
      if (e.code === "Escape" && this.isOpen) this.close();
    });
    // a click on the dark backdrop (not on the sheet) closes too
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  close() {
    if (this.root.hidden) return;
    if (this.guard && !this.guard()) return;
    this.guard = null;
    this.cleanup?.();
    this.cleanup = null;
    this.root.hidden = true;
    this.root.replaceChildren();
    this.onToggle(false);
  }

  /** A new card to write and leave here. */
  compose(opts: ComposeOptions) {
    const files: File[] = [];
    const urls: string[] = [];
    let size: BoxSize | null = ORDER.find((s) => opts.fits[s]) ?? null;
    let busy = false;

    const error = el("div", "pc-error");
    const textarea = el("textarea", "pc-text");
    textarea.maxLength = BOX_TEXT_MAX_LEN;
    textarea.placeholder = `Dear ${opts.mark.to},`;
    const count = el("span", "pc-count", `0 / ${BOX_TEXT_MAX_LEN}`);
    textarea.addEventListener("input", () => {
      count.textContent = `${textarea.value.length} / ${BOX_TEXT_MAX_LEN}`;
    });
    const card = this.card(opts.mark, textarea);
    card.querySelector(".pc-msg")!.append(count);

    // photos & videos as instant-camera prints, staged until "Leave it here"
    const prints = el("div", "pc-prints");
    const addBtn = el("button", "pc-add", "＋ add photos or videos");
    addBtn.type = "button";
    addBtn.addEventListener("click", () => this.fileInput.click());
    const renderPrints = () => {
      prints.replaceChildren();
      files.forEach((f, i) => {
        const print = el("div", "pc-print");
        let media: HTMLImageElement | HTMLVideoElement;
        if (f.type.startsWith("video/")) {
          const v = el("video");
          v.muted = true;
          v.playsInline = true;
          v.preload = "metadata";
          media = v;
        } else {
          media = el("img");
        }
        media.src = urls[i];
        const x = el("button", "pc-x", "✕");
        x.type = "button";
        x.title = "Remove";
        x.addEventListener("click", () => {
          URL.revokeObjectURL(urls[i]);
          files.splice(i, 1);
          urls.splice(i, 1);
          renderPrints();
        });
        print.append(media, x);
        prints.append(print);
      });
      addBtn.hidden = files.length >= BOX_MEDIA_MAX;
      prints.append(addBtn);
    };
    const onFiles = () => {
      for (const f of this.fileInput.files ?? []) {
        if (files.length >= BOX_MEDIA_MAX) {
          error.textContent = `A box holds at most ${BOX_MEDIA_MAX} photos or videos`;
          break;
        }
        if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) {
          error.textContent = "Only photos and videos fit in a box";
          continue;
        }
        if (f.type.startsWith("video/") && f.size > MEDIA_MAX_BYTES) {
          error.textContent = "That video is too big (max 25 MB)";
          continue;
        }
        files.push(f);
        urls.push(URL.createObjectURL(f));
      }
      this.fileInput.value = "";
      renderPrints();
    };
    this.fileInput.addEventListener("change", onFiles);
    renderPrints();

    // size, announce, send
    const controls = el("div", "pc-controls");
    const sizes = el("div", "pc-sizes");
    const sizeBtns = ORDER.map((s) => {
      const b = el("button", undefined, SIZE_LABEL[s]);
      b.type = "button";
      b.dataset.size = s;
      b.disabled = !opts.fits[s];
      if (!opts.fits[s]) b.title = "no room here";
      b.classList.toggle("picked", size === s);
      b.addEventListener("click", () => {
        size = s;
        for (const o of sizeBtns) o.classList.toggle("picked", o === b);
      });
      sizes.append(b);
      return b;
    });
    const announce = el("label", "pc-announce");
    const check = el("input");
    check.type = "checkbox";
    check.checked = true;
    announce.append(check, `Let ${opts.mark.to} know a box is waiting`);
    const send = el("button", "pc-primary", "Leave it here 🎁");
    send.id = "pc-send";
    send.type = "button";
    if (!size) {
      send.disabled = true;
      error.textContent = "No room for a box here. Step somewhere more open.";
    }
    send.addEventListener("click", async () => {
      if (busy || !size) return;
      const text = textarea.value.trim();
      if (!text && files.length === 0) {
        error.textContent = "Write something or add a photo first";
        return;
      }
      busy = true;
      send.disabled = true;
      send.textContent = "⏳ packing…";
      error.textContent = "";
      try {
        await opts.onSend({ text, files: [...files], size, announce: check.checked });
        this.guard = null;
        this.close();
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : "Something went wrong";
        busy = false;
        send.disabled = false;
        send.textContent = "Leave it here 🎁";
      }
    });
    controls.append(sizes, announce, send, error);

    const sheet = el("div", "pc-sheet");
    sheet.append(this.closeButton(), card, prints, controls);
    this.guard = () => (!textarea.value.trim() && files.length === 0) || confirm("Throw this postcard away?");
    this.cleanup = () => {
      this.fileInput.removeEventListener("change", onFiles);
      for (const u of urls) URL.revokeObjectURL(u);
    };
    this.show(sheet);
    textarea.focus();
  }

  /** A card someone left, opened. */
  read(opts: ReadOptions) {
    const { box, mark, role } = opts;
    const text = el("div", "pc-text");
    if (box.text) text.textContent = box.text;
    else {
      text.textContent = "(no words, just the pictures)";
      text.classList.add("pc-empty");
    }
    const card = this.card(mark, text);

    const prints = el("div", "pc-prints");
    for (const m of box.media ?? []) {
      const print = el("div", "pc-print");
      print.append(mediaElement(m, "row"));
      prints.append(print);
    }

    const controls = el("div", "pc-controls");
    if (role === "finder") {
      const label = el("input", "pc-label");
      label.maxLength = BOX_LABEL_MAX_LEN;
      label.placeholder = "Give it a label (optional)…";
      const keep = el("button", "pc-primary", "Keep it 🎁");
      keep.id = "pc-keep";
      keep.type = "button";
      keep.addEventListener("click", () => {
        opts.onKeep(label.value.trim());
        this.close();
      });
      const leave = el("button", "pc-secondary", "Leave it here");
      leave.id = "pc-leave";
      leave.type = "button";
      leave.addEventListener("click", () => this.close());
      controls.append(label, keep, leave);
    } else {
      if (role === "creator") {
        controls.append(
          el(
            "div",
            "pc-footer",
            box.opened === null ? "Still sealed 🤫" : `Opened by ${opts.openedBy} on ${fmtDate(new Date(box.opened))}`,
          ),
        );
      }
      const close = el("button", "pc-secondary", "Close");
      close.type = "button";
      close.addEventListener("click", () => this.close());
      controls.append(close);
    }

    const sheet = el("div", "pc-sheet");
    sheet.append(this.closeButton(), card, prints, controls);
    this.guard = null;
    this.cleanup = null;
    this.show(sheet);
  }

  private show(sheet: HTMLElement) {
    this.root.replaceChildren(sheet);
    this.root.hidden = false;
    this.root.scrollTop = 0;
    this.onToggle(true);
  }

  private closeButton() {
    const b = el("button", "pc-close", "✕");
    b.id = "pc-close";
    b.type = "button";
    b.title = "Close";
    b.addEventListener("click", () => this.close());
    return b;
  }

  /** The card itself: the message on the left, the postal dressing on the right. */
  private card(mark: Postmark, message: HTMLElement): HTMLElement {
    const card = el("div", "pc-card");
    const msg = el("div", "pc-msg");
    msg.append(message);

    const side = el("div", "pc-side");
    const stamp = el("div", "pc-stamp");
    stamp.append(el("span", undefined, EMOJI[mark.fromChar]), el("small", undefined, "HAVEN"));
    const postmark = el("div", "pc-postmark");
    postmark.append(el("span", undefined, fmtDate(mark.date)), el("span", undefined, mark.place));
    const to = el("div", "pc-to");
    to.append("To: ", el("b", undefined, mark.to));
    const from = el("div", "pc-from", `from ${mark.from}`);
    side.append(stamp, postmark, to, el("div", "pc-line"), el("div", "pc-line", mark.place), el("div", "pc-line"), from);

    card.append(msg, side);
    return card;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. (The module is not wired yet; Task 10 does that.)

- [ ] **Step 3: Commit**

```bash
git add src/postcard.ts
git commit -m "Postcard dialog: handwritten card for composing and reading treasures"
```

---

### Task 9: The treasures module

**Files:**
- Create: `src/treasures.ts`

**Interfaces:**
- Consumes: `footprintFor` (Task 5), `World.setBlocked/neighbors/areNeighbors/dirBetween` (Task 4), `Postcard` (Task 8), `mediaElement`/`uploadMedia` (Task 7), `node` from `assets.ts`, chest assets (Task 6), `Net` box methods (Task 7).
- Produces: `class Treasures` with `constructor(assets: Assets, hooks: TreasureHooks)`, `setIdentity(me, names)`, `setAll(boxes)`, `apply(box)`, `deny(reason)`, `mountWorld(world)`, `update(dt)`, `actionAt(world, tile, forward): Box | null`, `open(box)`, `setPanelOpen(open)`, `list(): Box[]`, `get dialogOpen`. Type `TreasureHooks` (see code). Row button class `.tr-place` for the drive script.

- [ ] **Step 1: Write `src/treasures.ts`**

```ts
import { Vector3, type Group, type Object3D } from "three";
import {
  CHARACTER_OF,
  SURFACE,
  type Box,
  type BoxDenyReason,
  type BoxSize,
  type PlayerId,
  type Vec3,
} from "../shared/protocol.ts";
import { node, type AssetName, type Assets } from "./assets.ts";
import { mediaElement, uploadMedia } from "./chat.ts";
import { footprintFor } from "./footprint.ts";
import { tangentFrameQuat } from "./math.ts";
import type { Net } from "./net.ts";
import { Postcard, type Postmark } from "./postcard.ts";
import type { World } from "./world.ts";

const LID_OPEN = -1.75; // radians around the hinge (about 100 degrees); 0 = sealed
const LID_SPEED = 4; // rad/s
const REQUEST_TIMEOUT_MS = 15_000;
const CHEST: Record<BoxSize, AssetName> = { s: "chest_s", m: "chest_m", l: "chest_l" };
const SIZE_NAME: Record<BoxSize, string> = { s: "S", m: "M", l: "L" };

const DENY_TEXT: Record<BoxDenyReason, string> = {
  invalid: "The planet didn't accept that box.",
  overlap: "Another box is already standing there.",
  partner: "Your partner is standing right there!",
  creator: "You can't keep a box you left yourself.",
  owner: "Only its owner can do that.",
  missing: "That box isn't there anymore.",
};

export type PlayerSpot = { world: World; tile: number; forward: Vector3; moving: boolean };

export type TreasureHooks = {
  /** The local player's whereabouts right now. */
  player(): PlayerSpot;
  /** The globe, or a room that has already been created; null otherwise. */
  resolveWorld(loc: string): World | null;
  /** "Haven" or "the crooked house": for postmarks and panel rows. */
  placeName(loc: string): string;
  /** Per-tile placement rule for `world`: terrain, doors, spawns, the partner. */
  canPlaceOn(world: World, tile: number): boolean;
  /** A postcard dialog opened or closed (walking is muted while open). */
  onDialog(open: boolean): void;
  /** The treasures panel was opened (small screens tidy other panels). */
  onPanelOpen(): void;
  net: Pick<Net, "placeBox" | "openBox" | "keepBox" | "labelBox" | "putBox">;
};

type Mounted = { box: Box; group: Group; lid: Object3D; world: World };
type Pending = {
  matches(box: Box, isNew: boolean): boolean;
  resolve(): void;
  reject(err: Error): void;
  timer: number;
};

const _dir = new Vector3();
const _p = new Vector3();
const vec = (v: Vector3): Vec3 => [v.x, v.y, v.z];
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Everything treasure: the box list mirrored from the server, the chests in
 * the 3D worlds (with their blocked tiles), the adjacency check behind the
 * action button, the Treasures panel, and the requests to the server.
 */
export class Treasures {
  private assets: Assets;
  private hooks: TreasureHooks;
  private postcard: Postcard;
  private boxes = new Map<number, Box>();
  private mounted = new Map<number, Mounted>();
  private me: PlayerId = 0;
  private names: [string, string] = ["…", "…"];
  private pendingOpen: number | null = null; // box we asked the server to open
  private pending: Pending | null = null; // a place / put waiting for its answer
  private toastTimer = 0;
  private ui: {
    openBtn: HTMLElement;
    badge: HTMLElement;
    panel: HTMLElement;
    waiting: HTMLElement;
    mine: HTMLElement;
    left: HTMLElement;
    toast: HTMLElement;
  };

  constructor(assets: Assets, hooks: TreasureHooks) {
    this.assets = assets;
    this.hooks = hooks;
    this.postcard = new Postcard((open) => hooks.onDialog(open));
    const $ = (id: string) => {
      const e = document.getElementById(id);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    this.ui = {
      openBtn: $("treasure-open"),
      badge: $("treasure-badge"),
      panel: $("treasure-panel"),
      waiting: $("treasure-waiting"),
      mine: $("treasure-mine"),
      left: $("treasure-left"),
      toast: $("toast"),
    };
    this.ui.openBtn.addEventListener("click", () => this.setPanelOpen(true));
    $("treasure-min").addEventListener("click", () => this.setPanelOpen(false));
    $("treasure-leave").addEventListener("click", () => this.compose());
    this.setPanelOpen(false);
  }

  get dialogOpen() {
    return this.postcard.isOpen;
  }

  setPanelOpen(open: boolean) {
    this.ui.panel.hidden = !open;
    this.ui.openBtn.hidden = open;
    if (open) this.hooks.onPanelOpen();
  }

  setIdentity(me: PlayerId, names: [string, string]) {
    this.me = me;
    this.names = names;
    this.renderPanel();
  }

  /** Replace everything (welcome, also after a reconnect). */
  setAll(boxes: Box[]) {
    for (const id of [...this.mounted.keys()]) this.unmount(id);
    this.boxes.clear();
    for (const b of boxes) {
      this.boxes.set(b.id, b);
      this.mount(b);
    }
    this.renderPanel();
  }

  /** One box changed, or the server answered our own request. */
  apply(incoming: Box) {
    const prev = this.boxes.get(incoming.id);
    // never forget contents we were already allowed to see
    const box =
      prev?.text !== undefined && incoming.text === undefined
        ? { ...incoming, text: prev.text, media: prev.media }
        : incoming;
    this.boxes.set(box.id, box);
    // re-mount, but let an already-standing lid keep its angle so update() swings it
    const lidNow = this.mounted.get(box.id)?.lid.rotation.x;
    this.unmount(box.id);
    this.mount(box, lidNow);
    this.renderPanel();
    if (this.pending?.matches(box, !prev)) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.resolve();
    }
    if (this.pendingOpen === box.id && box.text !== undefined) {
      this.pendingOpen = null;
      this.showRead(box);
    }
  }

  deny(reason: BoxDenyReason) {
    const message = DENY_TEXT[reason];
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.reject(new Error(message));
      return;
    }
    this.pendingOpen = null;
    this.toast(message);
  }

  /** A room was just created on this client: its boxes can stand in it now. */
  mountWorld(world: World) {
    for (const b of this.boxes.values()) {
      if (b.loc === world.id && !this.mounted.has(b.id)) this.mount(b);
    }
  }

  /** Every frame: lids swing toward sealed or open. */
  update(dt: number) {
    for (const m of this.mounted.values()) {
      const target = m.box.opened !== null ? LID_OPEN : 0;
      const cur = m.lid.rotation.x;
      const step = LID_SPEED * dt;
      m.lid.rotation.x = Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step;
    }
  }

  /** The box the action button offers from `tile` (closest to the facing), or null. */
  actionAt(world: World, tile: number, forward: Vector3): Box | null {
    let best: Box | null = null;
    let bestDot = -Infinity;
    for (const m of this.mounted.values()) {
      if (m.world !== world) continue;
      for (const t of m.box.tiles) {
        if (!world.areNeighbors(tile, t)) continue;
        const d = world.dirBetween(tile, t, _dir).dot(forward);
        const better = d > bestDot + 1e-6 || (best !== null && Math.abs(d - bestDot) <= 1e-6 && m.box.id < best.id);
        if (better) {
          bestDot = d;
          best = m.box;
        }
      }
    }
    return best;
  }

  /** E on a box, or Open in the panel. Asks the server only when contents are unknown. */
  open(box: Box) {
    const current = this.boxes.get(box.id) ?? box;
    if (current.text !== undefined) {
      this.showRead(current);
      return;
    }
    this.pendingOpen = current.id;
    this.hooks.net.openBox(current.id);
  }

  list(): Box[] {
    return [...this.boxes.values()];
  }

  // ---- placing ----------------------------------------------------------------

  private compose() {
    if (this.postcard.isOpen) return;
    const spot = this.hooks.player();
    if (spot.moving) {
      this.toast("Stand still first");
      return;
    }
    const { world, tile } = spot;
    const forward = spot.forward.clone();
    const free = (k: number) => this.hooks.canPlaceOn(world, k);
    const fits: Record<BoxSize, boolean> = {
      s: footprintFor(world, tile, forward, "s", free) !== null,
      m: footprintFor(world, tile, forward, "m", free) !== null,
      l: footprintFor(world, tile, forward, "l", free) !== null,
    };
    this.setPanelOpen(false);
    this.postcard.compose({
      mark: this.mark(this.me, world.id, new Date()),
      fits,
      onSend: async (draft) => {
        const media = [];
        for (const f of draft.files) media.push(await uploadMedia(f));
        const tiles = footprintFor(world, tile, forward, draft.size, free);
        if (!tiles) throw new Error("No room for that size here anymore");
        await this.request(
          (b, isNew) => isNew && b.creator === this.me,
          () =>
            this.hooks.net.placeBox({
              size: draft.size,
              text: draft.text,
              media,
              announce: draft.announce,
              loc: world.id,
              tiles,
              fwd: vec(forward),
            }),
        );
      },
    });
  }

  private place(box: Box) {
    const spot = this.hooks.player();
    if (spot.moving) {
      this.toast("Stand still first");
      return;
    }
    const { world, tile } = spot;
    const forward = spot.forward.clone();
    const tiles = footprintFor(world, tile, forward, box.size, (k) => this.hooks.canPlaceOn(world, k));
    if (!tiles) {
      this.toast(`No room for an ${SIZE_NAME[box.size]} box here. Step somewhere more open.`);
      return;
    }
    this.request(
      (b) => b.id === box.id && b.loc === world.id,
      () => this.hooks.net.putBox(box.id, world.id, tiles, vec(forward)),
    ).then(
      () => this.toast("Placed 🎁"),
      (e: Error) => this.toast(e.message),
    );
  }

  private relabel(box: Box) {
    const label = prompt("Label for this treasure:", box.label ?? "");
    if (label === null) return;
    this.hooks.net.labelBox(box.id, label.trim());
  }

  /** Send one request; settle on the matching `box` message or on `box-deny`. */
  private request(matches: Pending["matches"], send: () => void): Promise<void> {
    if (this.pending) return Promise.reject(new Error("Still waiting for the planet…"));
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (this.pending?.timer !== timer) return;
        this.pending = null;
        reject(new Error("No answer from the planet. Try again."));
      }, REQUEST_TIMEOUT_MS);
      this.pending = { matches, resolve, reject, timer };
      send();
    });
  }

  // ---- reading ----------------------------------------------------------------

  private showRead(box: Box) {
    const role = box.creator === this.me ? "creator" : box.loc !== null ? "finder" : "owner";
    this.postcard.read({
      box,
      mark: this.mark(box.creator, box.origin, new Date(box.created)),
      role,
      openedBy: this.names[1 - box.creator],
      onKeep: (label) => this.hooks.net.keepBox(box.id, label || undefined),
    });
  }

  private mark(from: PlayerId, loc: string, date: Date): Postmark {
    return {
      from: this.names[from],
      fromChar: CHARACTER_OF[from],
      to: this.names[1 - from],
      place: this.hooks.placeName(loc),
      date,
    };
  }

  // ---- 3D ---------------------------------------------------------------------

  private mount(box: Box, lidAngle?: number) {
    if (box.loc === null || box.tiles.length === 0) return;
    const world = this.hooks.resolveWorld(box.loc);
    if (!world) return; // a room not created yet - mountWorld() catches up later
    const group = this.assets[CHEST[box.size]].clone(true);
    const lid = node(group, "Lid");
    // stand at the footprint's center, front toward the player who left it
    const center = new Vector3();
    for (const t of box.tiles) center.add(world.tilePos(t, 0, _p));
    center.divideScalar(box.tiles.length);
    if (world.isGlobe) center.normalize().multiplyScalar(SURFACE - 0.03);
    else center.y = 0;
    group.position.copy(center);
    const up = world.up(center, new Vector3());
    tangentFrameQuat(up, new Vector3(-box.fwd[0], -box.fwd[1], -box.fwd[2]), group.quaternion);
    lid.rotation.x = lidAngle ?? (box.opened !== null ? LID_OPEN : 0);
    world.scene.add(group);
    world.setBlocked(box.tiles, true);
    this.mounted.set(box.id, { box, group, lid, world });
  }

  private unmount(id: number) {
    const m = this.mounted.get(id);
    if (!m) return;
    m.group.removeFromParent();
    m.world.setBlocked(m.box.tiles, false);
    this.mounted.delete(id);
  }

  // ---- panel ------------------------------------------------------------------

  private renderPanel() {
    const me = this.me;
    const all = [...this.boxes.values()].sort((a, b) => b.created - a.created);
    const waiting = all.filter((b) => b.loc !== null && b.creator !== me && b.opened === null && b.announce).length;
    this.ui.waiting.textContent =
      waiting === 0
        ? "Nothing announced… but who knows 👀"
        : waiting === 1
          ? "1 sealed box is waiting for you somewhere 🎁"
          : `${waiting} sealed boxes are waiting for you somewhere 🎁`;
    this.ui.badge.hidden = waiting === 0;
    this.ui.badge.textContent = String(waiting);
    this.ui.mine.replaceChildren(...all.filter((b) => b.owner === me).map((b) => this.row(b, "mine")));
    this.ui.left.replaceChildren(...all.filter((b) => b.creator === me).map((b) => this.row(b, "left")));
  }

  private whereText(box: Box): string {
    if (box.loc === null) return box.owner === this.me ? "in your pocket" : `kept by ${this.names[box.owner ?? 0]}`;
    return box.loc === "globe" ? "on the planet" : `in ${this.hooks.placeName(box.loc)}`;
  }

  private row(box: Box, kind: "mine" | "left"): HTMLElement {
    const row = el("div", "tr-row");
    const thumb = el("div", "tr-thumb");
    const first = box.media?.[0];
    if (first) thumb.append(mediaElement(first, "row"));
    else thumb.textContent = "🎁";

    const main = el("div");
    const title = el("div", "tr-title");
    if (box.label) title.textContent = box.label;
    else {
      title.textContent = kind === "mine" ? "no label yet" : `${SIZE_NAME[box.size]} box`;
      title.classList.add("faint");
    }
    const meta = el("div", "tr-meta");
    meta.textContent =
      kind === "mine"
        ? `from ${this.names[box.creator]} · ${SIZE_NAME[box.size]} · found ${fmtDate(box.opened ?? box.created)} · ${this.whereText(box)}`
        : `${SIZE_NAME[box.size]} · ${box.opened === null ? "sealed" : "opened"} · ${this.whereText(box)}`;
    main.append(title, meta);

    const actions = el("div", "tr-actions");
    const button = (label: string, cls: string, onClick: () => void) => {
      const b = el("button", cls, label);
      b.type = "button";
      b.addEventListener("click", onClick);
      return b;
    };
    actions.append(button("Open", "tr-open", () => this.open(box)));
    if (kind === "mine") {
      actions.append(button("Label ✏️", "tr-label", () => this.relabel(box)));
      if (box.loc === null) actions.append(button("Place here", "tr-place", () => this.place(box)));
    }
    row.append(thumb, main, actions);
    return row;
  }

  private toast(text: string) {
    this.ui.toast.textContent = text;
    this.ui.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.ui.toast.hidden = true;
    }, 3200);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. If `noUnusedLocals` complains about `AssetName`, the import is used by `CHEST`; check the manifest names from Task 6 match exactly (`chest_s`, `chest_m`, `chest_l`).

- [ ] **Step 3: Commit**

```bash
git add src/treasures.ts
git commit -m "Treasures: box state, chests in the world, action targeting and the panel"
```

---

### Task 10: Wire it into the game

**Files:**
- Modify: `src/main.ts`
- Modify: `src/world.ts` (add `nearestFreeTile`)
- Modify: `src/world.test.ts` (test it)

**Interfaces:**
- Consumes: `Treasures`/`TreasureHooks` (Task 9), `Input.setMuted`, `Chat.setOpen`, `Net` box methods (Task 7), `World.neighbors` (Task 4), `SPAWN_TILES` from `grid.ts`.
- Produces: the running feature. Dev hooks on `window.__tp`: `joined(): boolean` and `treasures.list(): Box[]` (the drive script in Task 11 uses both).

- [ ] **Step 1: A test for the reconnect nudge**

Append to `src/world.test.ts`:

```ts
test("nearestFreeTile steps out of a box that appeared under a sleeping player", () => {
  const globe = new GlobeWorld(new Scene());
  const k = SPAWN_TILES[1];
  assert.equal(nearestFreeTile(globe, k, "donkey"), k, "free tiles stay put");
  const ring = globe.neighbors(k);
  globe.setBlocked([k, ...ring], true);
  const out = nearestFreeTile(globe, k, "donkey");
  assert.notEqual(out, k);
  assert.equal(globe.isBlockedFor(out, "donkey"), false);
  assert.ok(ring.some((n) => globe.neighbors(n).includes(out)), "two rings out at most");
  globe.setBlocked([k, ...ring], false);
});
```

and extend the import from `./world.ts` to `{ GlobeWorld, ROOM_SPECS, RoomWorld, nearestFreeTile }`.

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL, `nearestFreeTile` is not exported.

- [ ] **Step 3: Add `nearestFreeTile` to `src/world.ts`**

Append at the end of the file:

```ts
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
```

Run `npm test`: the new test passes.

- [ ] **Step 4: Imports in `src/main.ts`**

Change these import lines:

```ts
import { CHARACTER_OF, type CharacterId, type PlayerId, type StateData } from "../shared/protocol.ts";
import { SPAWN_TILES, greatCircleDir, tileCenter } from "./grid.ts";
import { Treasures } from "./treasures.ts";
import { BUILDING_NAMES, GlobeWorld, RoomWorld, nearestFreeTile } from "./world.ts";
```

(`CharacterId` is used by `nearestFreeTile`'s argument; if the typechecker reports it unused, drop it.)

- [ ] **Step 5: Rooms tell the treasures module when they appear**

In `getRoom`, after `rooms.set(b.id, room);` add:

```ts
      treasures.mountWorld(room);
```

- [ ] **Step 6: The action buttons**

Replace `const enterBtn = $("enter") as HTMLButtonElement;` with:

```ts
  const enterBtn = $("enter") as HTMLButtonElement;
  const boxBtn = $("box-btn") as HTMLButtonElement;
```

Replace the whole block from `let doorAction: (() => void) | null = null;` through the `KeyE` keydown listener with:

```ts
  let doorAction: (() => void) | null = null;
  let boxAction: (() => void) | null = null;
  const refreshActions = () => {
    doorAction = null;
    boxAction = null;
    if (!player.moving && !treasures.dialogOpen) {
      if (player.world.isGlobe) {
        const b = doorTileMap.get(player.tile);
        if (b) {
          enterBtn.textContent = `Enter the ${BUILDING_NAMES[b.kind]} 🚪 (E)`;
          doorAction = () => enterBuilding(b);
        }
      } else if (player.tile === (player.world as RoomWorld).exitTile) {
        enterBtn.textContent = "Go back outside 🚪 (E)";
        doorAction = leaveBuilding;
      }
      const box = treasures.actionAt(player.world, player.tile, player.forward);
      if (box) {
        // E fires the first visible button, so the box only claims it when alone
        const key = doorAction ? "" : " (E)";
        boxBtn.textContent = box.label ? `Open “${box.label}” 🎁${key}` : `Open the treasure box 🎁${key}`;
        boxAction = () => treasures.open(box);
      }
    }
    enterBtn.hidden = !doorAction;
    boxBtn.hidden = !boxAction;
  };
  enterBtn.addEventListener("click", () => {
    doorAction?.();
    enterBtn.blur();
  });
  boxBtn.addEventListener("click", () => {
    boxAction?.();
    boxBtn.blur();
  });
  addEventListener("keydown", (e) => {
    if (e.code !== "KeyE") return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    if (treasures.dialogOpen) return;
    (doorAction ?? boxAction)?.();
  });
```

- [ ] **Step 7: Restore nudges out of boxes**

In `restore`, replace `switchWorld(state.tile, fwd, world);` with:

```ts
        switchWorld(nearestFreeTile(world, state.tile, CHARACTER_OF[myId]), fwd, world);
```

- [ ] **Step 8: Network messages**

In the `welcome` case, right after `applyCharacters();` add:

```ts
          treasures.setIdentity(myId, names);
          treasures.setAll(msg.boxes); // before restore(): blocked tiles must exist for the nudge
```

In the `names` case, after `chat.setNames(...)` add `treasures.setIdentity(myId, names);`.

Add two cases before the closing of the `switch`:

```ts
        case "box": {
          treasures.apply(msg.box);
          break;
        }
        case "box-deny": {
          treasures.deny(msg.reason);
          break;
        }
```

- [ ] **Step 9: Construct the module**

After the `const chat = new Chat(...)` statement add:

```ts
  const placeName = (loc: string) => {
    if (loc === "globe") return "Haven";
    const b = buildings.find((x) => x.id === loc);
    return b ? `the ${BUILDING_NAMES[b.kind]}` : "somewhere";
  };

  const treasures = new Treasures(assets, {
    player: () => ({ world: player.world, tile: player.tile, forward: player.forward, moving: player.moving }),
    resolveWorld: (loc) => (loc === "globe" ? globeWorld : (rooms.get(loc) ?? null)),
    placeName,
    canPlaceOn: (world, k) => {
      // the donkey's rule covers trees, buildings, furniture, other boxes AND water
      if (world.isBlockedFor(k, "donkey")) return false;
      if (world.isGlobe) {
        if (doorTileMap.has(k) || SPAWN_TILES.includes(k)) return false;
      } else if (k === (world as RoomWorld).exitTile) {
        return false;
      }
      return !(remote.present && remote.loc === world.id && remote.tile === k);
    },
    onDialog: (open) => input.setMuted(open),
    onPanelOpen: () => {
      if (innerWidth < 640) chat.setOpen(false);
    },
    net,
  });
  // on a phone the two panels would overlap: opening one tucks the other away
  $("chat-open").addEventListener("click", () => {
    if (innerWidth < 640) treasures.setPanelOpen(false);
  });
```

- [ ] **Step 10: Frame loop and dev hooks**

In the animation loop replace `refreshDoorAction();` with:

```ts
    treasures.update(dt);
    refreshActions();
```

In the `__tp` object add:

```ts
      joined: () => net.joined,
      treasures: { list: () => treasures.list() },
```

- [ ] **Step 11: Typecheck, tests, and a manual run**

Run: `npm run typecheck && npm test`
Expected: exit 0, all tests pass.

Then, with `DB_PATH=/tmp/tp-manual.db PLANET_PASS=planet npm run dev` in a second terminal, open two browser windows at http://localhost:5173, log in as each identity with the word `planet`, and check:

- The 🎁 button opens the Treasures panel; "Leave a treasure here" opens the postcard in handwriting; S, M and L all fit at the spawn.
- After sending, the chest stands in front of the sender for both players and blocks walking.
- The other player walking next to it sees the amber "Open the treasure box 🎁 (E)" button; E opens the postcard, the lid swings open for both.
- "Keep it 🎁" with a label removes the chest for both; the keeper's panel lists it with the label; "Place here" inside a house puts it down again.
- Pressing Enter inside the postcard text area inserts a newline (the chat box does not grab focus), and WASD does not move the character while the card is open.

Stop the dev server and remove `/tmp/tp-manual.db` afterwards.

- [ ] **Step 12: Commit**

```bash
git add src/main.ts src/world.ts src/world.test.ts
git commit -m "Treasure boxes: leave, find, open, keep, label and place them in the world"
```

---

### Task 11: Visual drive script and screenshot review

**Files:**
- Create: `scripts/_browser.mjs`
- Create: `scripts/drive-treasure.mjs`
- Modify: `scripts/drive.mjs`, `scripts/drive-chat.mjs` (use the shared browser lookup; `drive.mjs` also drops the selectors for the removed swap button)

**Interfaces:**
- Consumes: `window.__tp.joined()`, `window.__tp.treasures.list()`, `__tp.teleport`, `__tp.lookAt`, `__tp.enterBuilding`, `__tp.buildings`, `__tp.player` (Task 10); DOM ids from Tasks 7 to 9.
- Produces: `headlessShell()` in `scripts/_browser.mjs`; screenshots `/tmp/haven-treasure-*.png`.

- [ ] **Step 1: The shared browser lookup**

Create `scripts/_browser.mjs`:

```js
// The Playwright headless-shell binary changes folder name with every
// playwright-core release; find whatever is installed instead of hardcoding.
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function headlessShell() {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const dirs = readdirSync(cache)
    .filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort();
  if (dirs.length === 0) {
    throw new Error(`no chromium_headless_shell in ${cache}; run: npx playwright-core install chromium-headless-shell`);
  }
  return join(cache, dirs.at(-1), "chrome-headless-shell-mac-arm64/chrome-headless-shell");
}
```

In `scripts/drive.mjs` and `scripts/drive-chat.mjs`, replace the `homedir`/`join` imports and the `SHELL` constant with `import { headlessShell } from "./_browser.mjs";` and launch with `executablePath: headlessShell()`.
In `scripts/drive.mjs` also: replace `await page.waitForSelector("#who", { timeout: 15000 });` with `await page.waitForFunction(() => window.__tp?.joined(), { timeout: 15000 });`, change `hud` to read only `status`, and delete the "B swaps characters" block (the `#swap` click, its two screenshots and the two `hud after swap` logs). The swap button was removed from the game in commit 7d33f16.

- [ ] **Step 2: The treasure drive**

Create `scripts/drive-treasure.mjs`:

```js
// Visual check for treasure boxes: A writes a postcard with a photo and leaves
// an S box; B walks up, opens it, keeps it with a label, carries it into the
// ger and places it there. Screenshots land in /tmp/haven-treasure-*.png.
// Run against a FRESH database so both players start at their spawn tiles:
//   DB_PATH=/tmp/tp-drive.db PLANET_PASS=planet npm run dev
//   node scripts/drive-treasure.mjs
import { chromium } from "playwright-core";
import { headlessShell } from "./_browser.mjs";

const URL = process.argv[2] ?? "http://localhost:5173";
const shot = (page, name) => page.screenshot({ path: `/tmp/haven-treasure-${name}.png` });
const check = (cond, what) => {
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exitCode = 1;
  } else console.log(`  ok: ${what}`);
};

const browser = await chromium.launch({ executablePath: headlessShell(), args: ["--no-sandbox"] });

async function openPlayer(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(
    (id) => localStorage.setItem("tp-auth", JSON.stringify({ id, pass: "planet" })),
    name === "A" ? 0 : 1,
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[${name}] console.error: ${m.text()}`);
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__tp?.joined(), { timeout: 20000 });
  return page;
}

const a = await openPlayer("A");
const b = await openPlayer("B");
await a.waitForTimeout(1200);

// ---- A composes and leaves an S box with a photo -------------------------
await a.click("#treasure-open");
await a.click("#treasure-leave");
await a.waitForSelector("#postcard textarea.pc-text");
await a.fill("#postcard textarea.pc-text", "Dear khurlee,\n\nI hid this where the grass is softest.\nOpen it when you miss me.");
await a.keyboard.press("Enter"); // a newline on the card, never a jump to the chat box
await a.keyboard.type("🐝");
check(
  (await a.evaluate(() => document.activeElement?.tagName)) === "TEXTAREA",
  "Enter inside the postcard keeps writing on the card",
);
check((await a.inputValue("#postcard textarea.pc-text")).endsWith("miss me.\n🐝"), "the newline landed in the text");
const photo = await b.screenshot(); // any real PNG will do as the "photo"
await a.setInputFiles("#pc-file", { name: "view.png", mimeType: "image/png", buffer: photo });
await a.click('#postcard [data-size="s"]');
await a.evaluate(() => document.fonts.ready);
await shot(a, "A1-compose");
await a.click("#pc-send");
await a.waitForFunction(() => document.getElementById("postcard").hidden, { timeout: 15000 });
await a.waitForTimeout(500);
const box = await a.evaluate(() => window.__tp.treasures.list()[0]);
check(box && box.size === "s" && box.loc === "globe" && box.tiles.length === 1, "A's box stands on the globe");
await shot(a, "A2-placed");
await shot(b, "B2-sees-box");
const sealedForB = await b.evaluate(() => window.__tp.treasures.list()[0]);
check(sealedForB && sealedForB.text === undefined, "B cannot read the sealed box");
check((await b.textContent("#treasure-badge")) === "1", "B's 🎁 badge announces one waiting box");

// ---- B walks up, opens, keeps ----------------------------------------------
await b.evaluate((tile) => {
  const tp = window.__tp;
  const w = tp.player.world;
  const spot = w.neighbors(tile).find((n) => !w.isBlockedFor(n, "donkey"));
  tp.teleport(spot);
  tp.lookAt(tile);
}, box.tiles[0]);
await b.waitForFunction(() => !document.getElementById("box-btn").hidden, { timeout: 5000 });
check((await b.textContent("#box-btn")).includes("Open the treasure box"), "B is offered the box");
await shot(b, "B3-adjacent");
await b.keyboard.press("e");
await b.waitForFunction(() => !document.getElementById("postcard").hidden, { timeout: 10000 });
await b.evaluate(() => document.fonts.ready);
await b.waitForTimeout(700); // lid tween on both screens
await shot(b, "B4-postcard");
await shot(a, "A4-lid-open");
// Enter inside the card is a newline for the writer, never a jump to chat:
await b.focus("#postcard input.pc-label");
await b.keyboard.type("the softest grass");
check((await b.evaluate(() => document.activeElement?.className)) === "pc-label", "label input keeps focus");
await b.click("#pc-keep");
await b.waitForFunction(() => document.getElementById("postcard").hidden);
await b.waitForFunction(() => window.__tp.treasures.list()[0].loc === null, { timeout: 5000 });
const kept = await b.evaluate(() => window.__tp.treasures.list()[0]);
check(kept.owner === 1 && kept.label === "the softest grass", "B kept it with a label");
check((await a.evaluate(() => window.__tp.treasures.list()[0].loc)) === null, "the chest left A's world too");
await b.click("#treasure-open");
await shot(b, "B5-collection");

// ---- B carries it into the ger and places it -------------------------------
await b.evaluate(() => window.__tp.enterBuilding(window.__tp.buildings.find((x) => x.kind === "ger")));
await b.waitForTimeout(600);
await b.click("#treasure-mine .tr-place");
await b.waitForFunction(() => window.__tp.treasures.list()[0].loc === "ger", { timeout: 5000 });
await b.waitForTimeout(500);
await shot(b, "B6-in-the-ger");
await a.evaluate(() => window.__tp.enterBuilding(window.__tp.buildings.find((x) => x.kind === "ger")));
await a.waitForTimeout(600);
await shot(a, "A6-visits-the-ger");
const finalA = await a.evaluate(() => window.__tp.treasures.list()[0]);
check(finalA.loc === "ger" && finalA.text !== undefined, "A sees the placed box and still reads her own words");

await browser.close();
console.log(process.exitCode ? "DRIVE FAILED" : "done - screenshots in /tmp/haven-treasure-*.png");
```

- [ ] **Step 3: Run it against a fresh world**

In one terminal: `DB_PATH=/tmp/tp-drive.db PLANET_PASS=planet npm run dev` (delete `/tmp/tp-drive.db` first if it exists).
In another: `node scripts/drive-treasure.mjs`
Expected: every `ok:` line, no `pageerror`, final line `done - screenshots in ...`.

- [ ] **Step 4: Look at every screenshot**

Open the eight PNGs (the Read tool renders images). Be picky; fix and rerun until all of these hold:

- `A1-compose`: cream 3:2 card, handwriting (Caveat) in blue ink on the left, dashed divider, stamp with 🐝 and "HAVEN", rotated postmark, "To: khurlee", dotted lines, "from gloria"; the staged print tilted below; S picked, M and L enabled; the announce checkbox checked.
- `A2-placed` and `B2-sees-box`: a small wooden chest with gold bands on the tile in front of the bee, lid closed, lock facing the bee.
- `B3-adjacent`: the amber "Open the treasure box 🎁 (E)" button above the chat box, donkey facing the chest.
- `B4-postcard`: reading mode with the message, the print, the label field, "Keep it 🎁" and "Leave it here".
- `A4-lid-open`: the lid swung open (about 100 degrees) toward the back. If it swung DOWN into the body, negate `LID_OPEN` in `src/treasures.ts`.
- `B5-collection`: one row with the label "the softest grass", thumbnail, meta "from gloria · S · found <date> · in your pocket", buttons Open, Label ✏️, Place here.
- `B6-in-the-ger`, `A6-visits-the-ger`: the chest on the floor tile in front of the door, lid open. In A6 both characters stand in the doorway (entering always spawns on the door tile today, so they may overlap; that is existing behavior, not a treasure bug).

Also run `node scripts/drive-chat.mjs` and `node scripts/drive.mjs` once to confirm the shared browser lookup works and they no longer time out.

- [ ] **Step 5: Phone layout**

Temporarily set the viewport in `openPlayer` to `{ width: 390, height: 844 }` plus `hasTouch: true, isMobile: true`, rerun, and check `A1-compose` and `B4-postcard`: the card is portrait, message above the postal block, divider horizontal, controls reachable. Restore the desktop viewport afterwards (or keep a `MOBILE=1` env switch if you prefer; both are fine).

- [ ] **Step 6: Commit**

```bash
git add scripts/_browser.mjs scripts/drive-treasure.mjs scripts/drive.mjs scripts/drive-chat.mjs
git commit -m "Drive script for treasure boxes; drive scripts find the installed headless shell"
```

Commit any fixes from the screenshot review separately with a message naming what changed (for example `Postcard: tighter postmark placement on phones`).

---

### Task 12: CI gate and README

**Files:**
- Modify: `.github/workflows/fly-deploy.yml`
- Modify: `README.md`

- [ ] **Step 1: Tests before deploy**

Replace the contents of `.github/workflows/fly-deploy.yml` with:

```yaml
# Every push to main is tested, then deployed to Fly.io.
# See https://fly.io/docs/app-guides/continuous-deployment-with-github-actions/

name: Fly Deploy
on:
  push:
    branches:
      - main
      - master
jobs:
  test:
    name: Typecheck, unit tests, smoke test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run smoke
  deploy:
    name: Deploy app
    needs: test
    runs-on: ubuntu-latest
    concurrency: deploy-group # only one deploy at a time
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Verify locally that the three commands the job runs pass on this checkout: `npm run typecheck && npm test && npm run smoke`.

- [ ] **Step 2: Document the feature**

In `README.md`, add this section after "Going inside" (before "Adding your own models"):

```markdown
## Treasure boxes 🎁

Write a postcard, tuck photos or videos into it, and leave it as a treasure
chest anywhere: on the globe or on the floor of any room. The 🎁 button (top
left) opens your Treasures panel; **Leave a treasure here** puts a chest on the
squares in front of you. Three sizes: **S** takes one square, **M** four
(2 x 2), **L** twelve (3 x 4) - the card only offers sizes that fit where you
stand. Chests block walking like trees do.

A sealed chest tells the finder nothing. Walk up to it and press **E**: the lid
swings open (for both of you) and the postcard appears, handwritten, stamped
and postmarked with where and when it was left. **Keep it** to take it into
your collection, optionally with a label; **Leave it here** and it stays, open.
You can't keep a box you left yourself, but you can reread it and see whether
it has been opened. From the panel you can relabel a kept box, reread it, or
**Place here** to put it down again - in your own house, say, which makes it a
treasure house you can wander through together.

When leaving a box you choose whether the other player gets told that a sealed
box is waiting (they see a count, never a location). Boxes and their media live
in SQLite / the media folder next to the chat history.
```

In the Scripts table add two rows:

```markdown
| `npm test` | unit tests (store, footprints, worlds) with the Node test runner |
| `node scripts/drive-treasure.mjs` | two headless browsers leave, find, keep and place a treasure box; screenshots in `/tmp/haven-treasure-*.png` |
```

and change the `npm run typecheck` row's description to `TypeScript over client, shared and server (erasable syntax only, so Node can run the tests)`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/fly-deploy.yml README.md
git commit -m "CI runs typecheck, unit and smoke tests before deploying; document treasure boxes"
```

---

## Done when

- `npm run typecheck`, `npm test`, `npm run smoke` all pass.
- `node scripts/drive-treasure.mjs` prints only `ok:` lines and the eight screenshots match the checklist in Task 11.
- The manual checks in Task 10 step 11 hold on desktop and on a phone-sized window.
- `git log` shows one commit per task, none carrying a co-author line.
