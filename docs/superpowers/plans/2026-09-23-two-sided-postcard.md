# Two-Sided Postcard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the postcard a picture side (a snapshot taken inside Tiny Planet or an uploaded photo, cropped and captioned), a flip between the two sides, and a typed `contents` model for what a box holds.

**Architecture:** The shared protocol replaces the flat `style/text/media/card` fields with one `BoxContents` union per style; the server parses it in a new `server/contents.ts`, stores it as one JSON column after a one-time table rebuild, and strips it for the partner. On the client, `src/crop.ts` holds the pure crop math, `src/picture.ts` builds the picture face, `src/photo.ts` runs the in-world viewfinder, and `postcard.ts` wraps the card in a flip container. A build id baked into the bundle and written next to it lets a stale tab reload.

**Tech Stack:** TypeScript (erasable syntax only, run by Node type stripping on the server), Three.js, Vite, `node:sqlite`, `ws`, Node test runner, Playwright drive scripts.

**Spec:** `docs/superpowers/specs/2026-09-23-two-sided-postcard-design.md` (extends `docs/superpowers/specs/2026-09-23-treasure-boxes-design.md`).

## Global Constraints

- Shared and server code runs under Node type stripping: no enums, no namespaces, no parameter properties, explicit `.ts` extensions on imports (`erasableSyntaxOnly` is on in `tsconfig.json`).
- Limits, verbatim: `BOX_TEXT_MAX_LEN = 2000`, `BOX_MEDIA_MAX = 6`, `BOX_STAMP_MAX = 2`, `BOX_PLACE_MAX_LEN = 40`, `NAME_MAX_LEN = 24`, `PICTURE_CAPTION_MAX = 60` graphemes, `PICTURE_ZOOM_MIN = 1`, `PICTURE_ZOOM_MAX = 3`.
- A postcard is filled when it has words or a picture; a note when it has words; a photo box when it has at least one print.
- A postcard box holds only the card: no loose prints for the postcard style.
- Copy, verbatim: pill "picture side ↻" / "writing side ↻"; empty face "The picture side", "📷 Take a picture", "Upload a photo"; caption placeholder "A caption (optional)…"; photo mode "Back to the card", hint "Drag to look around · scroll or pinch to zoom · walk as usual".
- The writing face of the card does not change: same markup, classes and CSS as today.
- Never use the em dash character anywhere (code, copy, docs, commit messages).
- Commit messages are one line, no trailers, no `Co-Authored-By`.
- Markdown edits (spec, README): one sentence per line.
- Tasks 1 to 4 leave `npm run typecheck` red in `src/` files that still use the old fields; each of those tasks checks that `shared/` and `server/` are clean with `npx tsc --noEmit 2>&1 | grep -E '^(shared|server)/' ; echo "exit $?"` expecting no lines and `exit 1`. Task 5 makes the whole typecheck green again and every later task keeps it green.

## Review Focus

- A postcard whose picture file no longer exists on the server: the reader sees the writing face with no pill, not a broken image (Task 6 handles the image `error` event; Task 10 drives it).
- A `contents` column holding corrupt JSON: the store returns an empty postcard instead of throwing (Task 2 test).
- A drag or pinch on the photo interrupted by `pointercancel`: the photo stays where it is and the next drag works (Task 6 handler; Task 10 drives it).
- The shutter pressed twice quickly: one shot, photo mode closes once, one photo staged (Task 7 guard; Task 10 drives it).
- A message in the old flat shape from a stale tab: refused with `invalid`, and the welcome's build id makes that tab reload (Task 3 smoke; Task 9).

---

### Task 1: Typed contents in the shared protocol and the server parser

**Files:**
- Modify: `shared/protocol.ts`
- Create: `server/contents.ts`
- Test: `server/contents.test.ts`

**Interfaces:**
- Produces: `Picture`, `Writing`, `BoxContents`, `mediaOf(c: BoxContents): MediaRef[]`, constants `PICTURE_CAPTION_MAX`, `PICTURE_ZOOM_MIN`, `PICTURE_ZOOM_MAX`; `Box.contents?: BoxContents`; messages `box-place { size, contents, announce, loc, tiles, fwd }`, `box-edit { id, contents, announce }`, `welcome.build: string`; `parseContents(raw: unknown, fileExists: (name: string) => boolean): BoxContents | null`.

- [ ] **Step 1: Rewrite the box section of `shared/protocol.ts`**

Replace everything from the line `export const BOX_TEXT_MAX_LEN = 2000;` down to and including the `Box` type with:

```ts
export const BOX_TEXT_MAX_LEN = 2000; // words on a postcard or a note, and the caption of a photo box
export const BOX_MEDIA_MAX = 6; // prints in a note or a photo box
export const BOX_LABEL_MAX_LEN = 40;
export const BOX_STAMP_MAX = 2; // graphemes on the stamp: one emoji, or two
export const BOX_PLACE_MAX_LEN = 40; // the place written on the postmark and the address line
export const PICTURE_CAPTION_MAX = 60; // graphemes written over the picture side
export const PICTURE_ZOOM_MIN = 1; // the photo just covers the card
export const PICTURE_ZOOM_MAX = 3;

// What a box holds: a full postcard, a plain sheet of paper with words, or
// just photos and videos (with an optional caption).
export type BoxStyle = "postcard" | "note" | "media";

/** The picture side of a postcard: an uploaded photo and how the sender framed it. */
export type Picture = {
  image: MediaRef; // kind "image"
  focus: { x: number; y: number }; // 0..1: the point of the photo the card centres on
  zoom: number; // PICTURE_ZOOM_MIN..PICTURE_ZOOM_MAX
  caption: string; // handwriting over the picture; may be empty
};

/** The writing side of a postcard: the message and the dressing as the sender typed it (empty = default). */
export type Writing = { text: string; stamp: string; place: string; to: string; from: string };

// One typed unit per style. A postcard box holds only the card.
export type BoxContents =
  | { style: "postcard"; picture: Picture | null; writing: Writing }
  | { style: "note"; text: string; media: MediaRef[] }
  | { style: "media"; caption: string; media: MediaRef[] };

/** Every file a box's contents refer to. */
export function mediaOf(c: BoxContents): MediaRef[] {
  return c.style === "postcard" ? (c.picture ? [c.picture.image] : []) : c.media;
}

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
  contents?: BoxContents; // only present when the recipient may see them
};
```

The `BoxCard` type is gone. `BoxSize` and `Vec3` stay where they are above this block.

- [ ] **Step 2: Rewrite the two box messages and the welcome**

In `ClientMessage`, replace the `box-place` and `box-edit` members with:

```ts
  | {
      t: "box-place";
      size: BoxSize;
      contents: BoxContents;
      announce: boolean;
      loc: string;
      tiles: number[];
      fwd: Vec3;
    }
```

```ts
  | { t: "box-edit"; id: number; contents: BoxContents; announce: boolean } // change what a sealed box you left holds
```

In the `welcome` member of `ServerMessage`, add after `boxes: Box[]; // ...`:

```ts
      build: string; // the server's build id; a tab running another bundle reloads once (see main.ts)
```

- [ ] **Step 3: Write the failing parser tests**

Create `server/contents.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaOf, type BoxContents } from "../shared/protocol.ts";
import { parseContents } from "./contents.ts";

const exists = (name: string) => name === "ok.jpg" || name === "clip.mp4";
const parse = (raw: unknown) => parseContents(raw, exists);
const img = { url: "/media/ok.jpg", kind: "image" as const };
const vid = { url: "/media/clip.mp4", kind: "video" as const };
const writing = { text: "hello", stamp: "🐝", place: "the lake", to: "you", from: "me" };

test("a postcard with words and no picture", () => {
  assert.deepEqual(parse({ style: "postcard", picture: null, writing }), { style: "postcard", picture: null, writing });
});

test("a postcard with a picture keeps the crop and the caption", () => {
  const c = parse({
    style: "postcard",
    picture: { image: img, focus: { x: 0.25, y: 0.75 }, zoom: 1.5, caption: "  dusk  " },
    writing: { ...writing, text: "" },
  });
  assert.deepEqual(c, {
    style: "postcard",
    picture: { image: img, focus: { x: 0.25, y: 0.75 }, zoom: 1.5, caption: "dusk" },
    writing: { ...writing, text: "" },
  });
});

test("focus and zoom are clamped, the caption is cut at 60 graphemes", () => {
  const c = parse({
    style: "postcard",
    picture: { image: img, focus: { x: -2, y: 7 }, zoom: 9, caption: "🐝".repeat(70) },
    writing,
  });
  assert.ok(c && c.style === "postcard" && c.picture);
  assert.deepEqual(c.picture.focus, { x: 0, y: 1 });
  assert.equal(c.picture.zoom, 3);
  assert.equal(c.picture.caption, "🐝".repeat(60));
});

test("a picture must be an existing image file with a focus", () => {
  assert.equal(parse({ style: "postcard", picture: { image: vid, focus: { x: 0.5, y: 0.5 }, zoom: 1, caption: "" }, writing }), null);
  assert.equal(
    parse({ style: "postcard", picture: { image: { url: "/media/gone.jpg", kind: "image" }, focus: { x: 0.5, y: 0.5 }, zoom: 1, caption: "" }, writing }),
    null,
  );
  assert.equal(parse({ style: "postcard", picture: { image: img, zoom: 1, caption: "" }, writing }), null);
  assert.equal(parse({ style: "postcard", picture: { image: img, focus: { x: "a", y: 0.5 }, zoom: 1, caption: "" }, writing }), null);
});

test("a postcard needs words or a picture", () => {
  assert.equal(parse({ style: "postcard", picture: null, writing: { ...writing, text: "   " } }), null);
});

test("the dressing is cut to its limits and non-strings become empty", () => {
  const c = parse({
    style: "postcard",
    picture: null,
    writing: { text: "x".repeat(2100), stamp: "🐝🐝🐝", place: "p".repeat(100), to: 42, from: { no: 1 } },
  });
  assert.ok(c && c.style === "postcard");
  assert.equal(c.writing.text.length, 2000);
  assert.equal(c.writing.stamp, "🐝🐝");
  assert.equal(c.writing.place.length, 40);
  assert.equal(c.writing.to, "");
  assert.equal(c.writing.from, "");
});

test("a note needs words and keeps at most six existing prints", () => {
  assert.equal(parse({ style: "note", text: "", media: [img] }), null);
  const c = parse({ style: "note", text: " words ", media: [img, vid, { url: "/media/gone.png", kind: "image" }, "junk", img, img, img, img, img] });
  assert.ok(c && c.style === "note");
  assert.equal(c.text, "words");
  assert.equal(c.media.length, 6);
  assert.deepEqual(c.media[1], vid);
});

test("a photo box needs a print and cuts its caption like text", () => {
  assert.equal(parse({ style: "media", caption: "words", media: [] }), null);
  const c = parse({ style: "media", caption: "c".repeat(2100), media: [img] });
  assert.ok(c && c.style === "media");
  assert.equal(c.caption.length, 2000);
  assert.deepEqual(c.media, [img]);
});

test("anything else is refused, including the old flat shape", () => {
  assert.equal(parse(undefined), null);
  assert.equal(parse("postcard"), null);
  assert.equal(parse({ style: "letter", text: "x" }), null);
  assert.equal(parse({ style: "postcard", text: "old tab", media: [] }), null);
});

test("mediaOf lists the picture or the prints", () => {
  const postcard: BoxContents = { style: "postcard", picture: { image: img, focus: { x: 0.5, y: 0.5 }, zoom: 1, caption: "" }, writing };
  assert.deepEqual(mediaOf(postcard), [img]);
  assert.deepEqual(mediaOf({ style: "postcard", picture: null, writing }), []);
  assert.deepEqual(mediaOf({ style: "note", text: "x", media: [img, vid] }), [img, vid]);
  assert.deepEqual(mediaOf({ style: "media", caption: "", media: [vid] }), [vid]);
});
```

Note the last test on the old flat shape: `{ style: "postcard", text, media }` has no `writing` and no `picture`, so the postcard is unfilled and refused.

- [ ] **Step 4: Run the tests to see them fail**

Run: `node --test server/contents.test.ts`
Expected: FAIL, `Cannot find module '.../server/contents.ts'`.

- [ ] **Step 5: Write `server/contents.ts`**

```ts
// Turns the raw `contents` of a box request into a clean BoxContents, or
// null when it makes no valid box. No network code here so the unit tests
// can drive it directly; `fileExists` answers whether the upload endpoint
// really stored a file of that name.
import {
  BOX_MEDIA_MAX,
  BOX_PLACE_MAX_LEN,
  BOX_STAMP_MAX,
  BOX_TEXT_MAX_LEN,
  NAME_MAX_LEN,
  PICTURE_CAPTION_MAX,
  PICTURE_ZOOM_MAX,
  PICTURE_ZOOM_MIN,
  type BoxContents,
  type MediaRef,
  type Picture,
  type Writing,
} from "../shared/protocol.ts";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The first `max` characters as a person counts them (an emoji is one), trimmed; non-strings are empty. */
function cut(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return [...graphemes.segment(v)]
    .map((g) => g.segment)
    .slice(0, max)
    .join("")
    .trim();
}

/** Free text: cut by length and trimmed, as the chat does. */
const words = (v: unknown) => (typeof v === "string" ? v.slice(0, BOX_TEXT_MAX_LEN).trim() : "");

/** A finite number clamped into [lo, hi], or null. */
function num(v: unknown, lo: number, hi: number): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;
}

export function parseContents(raw: unknown, fileExists: (name: string) => boolean): BoxContents | null {
  if (!isObj(raw)) return null;
  // a reference the upload endpoint could have produced (one safe segment) to a file that is still there
  const isRef = (m: unknown): m is MediaRef =>
    isObj(m) &&
    typeof m.url === "string" &&
    /^\/media\/[\w.-]+$/.test(m.url) &&
    (m.kind === "image" || m.kind === "video") &&
    fileExists(m.url.slice("/media/".length));
  const refs = (v: unknown): MediaRef[] =>
    Array.isArray(v) ? v.filter(isRef).map((m) => ({ url: m.url, kind: m.kind })).slice(0, BOX_MEDIA_MAX) : [];

  if (raw.style === "postcard") {
    const w = isObj(raw.writing) ? raw.writing : {};
    const writing: Writing = {
      text: words(w.text),
      stamp: cut(w.stamp, BOX_STAMP_MAX),
      place: cut(w.place, BOX_PLACE_MAX_LEN),
      to: cut(w.to, NAME_MAX_LEN),
      from: cut(w.from, NAME_MAX_LEN),
    };
    let picture: Picture | null = null;
    if (raw.picture !== null && raw.picture !== undefined) {
      const p = raw.picture;
      if (!isObj(p) || !isRef(p.image) || p.image.kind !== "image" || !isObj(p.focus)) return null;
      const x = num(p.focus.x, 0, 1);
      const y = num(p.focus.y, 0, 1);
      const zoom = num(p.zoom, PICTURE_ZOOM_MIN, PICTURE_ZOOM_MAX);
      if (x === null || y === null || zoom === null) return null;
      picture = { image: { url: p.image.url, kind: "image" }, focus: { x, y }, zoom, caption: cut(p.caption, PICTURE_CAPTION_MAX) };
    }
    if (!writing.text && !picture) return null;
    return { style: "postcard", picture, writing };
  }
  if (raw.style === "note") {
    const text = words(raw.text);
    if (!text) return null;
    return { style: "note", text, media: refs(raw.media) };
  }
  if (raw.style === "media") {
    const media = refs(raw.media);
    if (media.length === 0) return null;
    return { style: "media", caption: words(raw.caption), media };
  }
  return null;
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `node --test server/contents.test.ts`
Expected: 10 tests pass.

- [ ] **Step 7: Check the shared and server files typecheck on their own**

Run: `npx tsc --noEmit 2>&1 | grep -E '^(shared|server)/' ; echo "exit $?"`
Expected: `server/store.ts` and `server/index.ts` still report errors (they are migrated in Tasks 2 and 3), so lines appear. Confirm that none of them name `shared/protocol.ts` or `server/contents.ts`.

- [ ] **Step 8: Commit**

```bash
git add shared/protocol.ts server/contents.ts server/contents.test.ts
git commit -m "Protocol: typed box contents per style with a picture side, and a server parser for them"
```

---

### Task 2: Store the contents in one column and migrate old databases

**Files:**
- Modify: `server/store.ts`
- Test: `server/store.test.ts`

**Interfaces:**
- Consumes: `BoxContents`, `Writing`, `MediaRef` from Task 1.
- Produces: `FullBox = Box & { contents: BoxContents }`, `NewBox = { creator, size, contents, announce, loc, tiles, fwd }`, `Store.addBox(NewBox)`, `Store.editBox(id, contents: BoxContents, announce: boolean)`. The `BoxContents` type is no longer exported from the store.

- [ ] **Step 1: Rewrite the store tests for the new shape**

Replace the whole of `server/store.test.ts` with:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { BoxContents, Vec3 } from "../shared/protocol.ts";
import { Store } from "./store.ts";

const fresh = () => new Store(":memory:");
const img = { url: "/media/a.jpg", kind: "image" as const };
const postcard: BoxContents = {
  style: "postcard",
  picture: { image: img, focus: { x: 0.4, y: 0.6 }, zoom: 1.2, caption: "dusk" },
  writing: { text: "for you", stamp: "🐝", place: "Sydney", to: "my love", from: "your bee" },
};
const draft = {
  creator: 0 as const,
  size: "m" as const,
  contents: postcard,
  announce: true,
  loc: "globe",
  tiles: [10, 11, 26, 27],
  fwd: [0, 0, 1] as Vec3,
};

test("a new box is sealed, unowned, stands where it was left and keeps its contents", () => {
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
  assert.deepEqual(box.contents, postcard);
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
    assert.deepEqual(again.getBox(1)?.contents, postcard);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("notes and photo boxes keep their own shape", () => {
  const s = fresh();
  const note = s.addBox({ ...draft, contents: { style: "note", text: "a note", media: [img] }, tiles: [40], size: "s" });
  assert.deepEqual(note.contents, { style: "note", text: "a note", media: [img] });
  const photos = s.addBox({ ...draft, contents: { style: "media", caption: "", media: [img] }, tiles: [41], size: "s" });
  assert.deepEqual(photos.contents, { style: "media", caption: "", media: [img] });
});

const OLD_COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT, creator INTEGER NOT NULL, owner INTEGER, size TEXT NOT NULL,
  text TEXT NOT NULL, media TEXT NOT NULL, announce INTEGER NOT NULL, created INTEGER NOT NULL,
  opened INTEGER, label TEXT, origin TEXT NOT NULL, loc TEXT, tiles TEXT NOT NULL, fwd TEXT NOT NULL`;

test("a database from before styles folds its boxes into postcards with an empty dressing", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-store-old-"));
  const path = join(dir, "planet.db");
  try {
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE boxes (${OLD_COLUMNS});
      INSERT INTO boxes (creator, owner, size, text, media, announce, created, opened, label, origin, loc, tiles, fwd)
      VALUES (0, NULL, 's', 'old words', '[]', 1, 1000, NULL, NULL, 'globe', 'globe', '[5]', '[0,0,1]');
    `);
    old.close();
    const s = new Store(path);
    const box = s.getBox(1)!;
    assert.deepEqual(box.contents, {
      style: "postcard",
      picture: null,
      writing: { text: "old words", stamp: "", place: "", to: "", from: "" },
    });
    assert.equal(box.created, 1000);
    assert.deepEqual(box.tiles, [5]);
    const next = s.addBox({ ...draft, tiles: [6], size: "s" });
    assert.equal(next.id, 2, "ids carry on after the rebuild");
    const cols = (new DatabaseSync(path).prepare("PRAGMA table_info(boxes)").all() as { name: string }[]).map((c) => c.name);
    assert.ok(cols.includes("contents") && !cols.includes("text") && !cols.includes("style"), "the old columns are gone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a database with the flat style and card columns folds every style", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-store-flat-"));
  const path = join(dir, "planet.db");
  try {
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE boxes (${OLD_COLUMNS}, style TEXT NOT NULL DEFAULT 'postcard', card TEXT);
      INSERT INTO boxes (id, creator, owner, size, text, media, announce, created, opened, label, origin, loc, tiles, fwd, style, card) VALUES
        (3, 0, 1, 's', 'dear you', '[]', 1, 1000, 2000, 'lake', 'globe', NULL, '[]', '[0,0,1]', 'postcard', '{"stamp":"🌙","place":"Sydney","to":"my love","from":"your bee"}'),
        (5, 1, NULL, 'm', 'kettle is on', '[{"url":"/media/k.jpg","kind":"image"}]', 0, 1100, NULL, NULL, 'ger', 'ger', '[12,13,17,18]', '[1,0,0]', 'note', NULL),
        (8, 1, NULL, 's', 'the view', '[{"url":"/media/v.mp4","kind":"video"}]', 1, 1200, NULL, NULL, 'globe', 'globe', '[300]', '[0,0,1]', 'media', NULL);
    `);
    old.close();
    const s = new Store(path);
    assert.deepEqual(s.getBox(3)!.contents, {
      style: "postcard",
      picture: null,
      writing: { text: "dear you", stamp: "🌙", place: "Sydney", to: "my love", from: "your bee" },
    });
    assert.equal(s.getBox(3)!.owner, 1);
    assert.equal(s.getBox(3)!.opened, 2000);
    assert.equal(s.getBox(3)!.label, "lake");
    assert.deepEqual(s.getBox(5)!.contents, { style: "note", text: "kettle is on", media: [{ url: "/media/k.jpg", kind: "image" }] });
    assert.deepEqual(s.getBox(8)!.contents, { style: "media", caption: "the view", media: [{ url: "/media/v.mp4", kind: "video" }] });
    assert.deepEqual(
      s.boxes().map((b) => b.id),
      [3, 5, 8],
    );
    assert.equal(s.addBox({ ...draft, tiles: [6], size: "s" }).id, 9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("corrupt contents read as an empty postcard instead of throwing", () => {
  const s = fresh();
  const { id } = s.addBox(draft);
  s.debugSetContents(id, "{not json");
  assert.deepEqual(s.getBox(id)!.contents, {
    style: "postcard",
    picture: null,
    writing: { text: "", stamp: "", place: "", to: "", from: "" },
  });
});

test("deleting a box removes it for good", () => {
  const s = fresh();
  const { id } = s.addBox(draft);
  s.addBox({ ...draft, tiles: [7], size: "s" });
  s.deleteBox(id);
  assert.equal(s.getBox(id), null);
  assert.deepEqual(
    s.boxes().map((b) => b.id),
    [2],
  );
  assert.deepEqual(s.boxesIn("globe").map((b) => b.id), [2]);
});

test("editing replaces the contents and the announce flag, nothing else", () => {
  const s = fresh();
  const before = s.addBox(draft);
  s.editBox(before.id, { style: "note", text: "changed my mind", media: [{ url: "/media/b.jpg", kind: "image" }] }, false);
  const after = s.getBox(before.id)!;
  assert.deepEqual(after.contents, { style: "note", text: "changed my mind", media: [{ url: "/media/b.jpg", kind: "image" }] });
  assert.equal(after.announce, false);
  assert.equal(after.size, before.size);
  assert.equal(after.loc, before.loc);
  assert.deepEqual(after.tiles, before.tiles);
  assert.equal(after.created, before.created);
  assert.equal(after.opened, null);
});

test("lifting takes the box out of the world but gives it no owner", () => {
  const s = fresh();
  const { id } = s.addBox(draft);
  s.liftBox(id);
  const box = s.getBox(id)!;
  assert.equal(box.loc, null);
  assert.deepEqual(box.tiles, []);
  assert.equal(box.owner, null);
  assert.equal(box.creator, 0);
  assert.deepEqual(s.boxesIn("globe"), []);
  s.putBox(id, "ger", [12], [1, 0, 0]);
  assert.equal(s.getBox(id)?.loc, "ger");
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test server/store.test.ts`
Expected: FAIL (the store still writes `text`/`media` columns and has no `debugSetContents`).

- [ ] **Step 3: Rewrite the box types, the row mapping and the schema in `server/store.ts`**

Change the import to:

```ts
import type { Box, BoxContents, BoxSize, ChatEntry, MediaRef, PlayerId, StateData, Vec3, Writing } from "../shared/protocol.ts";
```

Replace `FullBox`, `NewBox`, `BoxContents`, `BoxRow` and `rowToBox` with:

```ts
/** A box as stored: contents always present (the server strips them per viewer). */
export type FullBox = Box & { contents: BoxContents };

export type NewBox = {
  creator: PlayerId;
  size: BoxSize;
  contents: BoxContents;
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
  contents: string;
  announce: number;
  created: number;
  opened: number | null;
  label: string | null;
  origin: string;
  loc: string | null;
  tiles: string;
  fwd: string;
};

/** A row from before `contents`: the flat columns, with `style` and `card` missing on the oldest databases. */
type FlatBoxRow = Omit<BoxRow, "contents"> & { text: string; media: string; style?: string; card?: string | null };

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_POSTCARD: BoxContents = {
  style: "postcard",
  picture: null,
  writing: { text: "", stamp: "", place: "", to: "", from: "" },
};

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
    contents: parseJson<BoxContents>(r.contents, EMPTY_POSTCARD),
  };
}

/** An old flat row folded into `contents`. Prints on an old postcard are dropped: no such box exists in the live database. */
function foldContents(r: FlatBoxRow): BoxContents {
  const media = parseJson<MediaRef[]>(r.media, []);
  const style = r.style ?? "postcard";
  if (style === "note") return { style: "note", text: r.text, media };
  if (style === "media") return { style: "media", caption: r.text, media };
  const card = r.card ? parseJson<Partial<Writing> | null>(r.card, null) : null;
  return {
    style: "postcard",
    picture: null,
    writing: { text: r.text, stamp: card?.stamp ?? "", place: card?.place ?? "", to: card?.to ?? "", from: card?.from ?? "" },
  };
}

const BOX_COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator INTEGER NOT NULL,
  owner INTEGER,
  size TEXT NOT NULL,
  contents TEXT NOT NULL,
  announce INTEGER NOT NULL,
  created INTEGER NOT NULL,
  opened INTEGER,
  label TEXT,
  origin TEXT NOT NULL,
  loc TEXT,
  tiles TEXT NOT NULL,
  fwd TEXT NOT NULL`;
```

In the constructor's `CREATE TABLE IF NOT EXISTS boxes (...)` statement, replace the column list with `${BOX_COLUMNS}` (the `exec` call already uses a template literal). Delete the two `ALTER TABLE boxes ADD COLUMN ...` blocks for `style` and `card` and the `boxCols` lookup. Keep the `messages.media` migration. After the players are seeded, call `this.migrateBoxes();`.

Add the migration method inside the class, after the constructor:

```ts
  /** One-time rebuild from the flat `text`/`media`/`style`/`card` columns into `contents`. */
  private migrateBoxes() {
    const cols = (this.db.prepare("PRAGMA table_info(boxes)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("text")) return; // already the contents shape
    const rows = this.db.prepare("SELECT * FROM boxes ORDER BY id").all() as FlatBoxRow[];
    this.db.exec("BEGIN");
    try {
      this.db.exec(`CREATE TABLE boxes_v2 (${BOX_COLUMNS})`);
      const insert = this.db.prepare(
        `INSERT INTO boxes_v2 (id, creator, owner, size, contents, announce, created, opened, label, origin, loc, tiles, fwd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of rows) {
        insert.run(r.id, r.creator, r.owner, r.size, JSON.stringify(foldContents(r)), r.announce, r.created, r.opened, r.label, r.origin, r.loc, r.tiles, r.fwd);
      }
      this.db.exec("DROP TABLE boxes");
      this.db.exec("ALTER TABLE boxes_v2 RENAME TO boxes");
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    console.log(`[planet] migrated ${rows.length} treasure box(es) to typed contents`);
  }
```

- [ ] **Step 4: Rewrite `addBox` and `editBox`, add the test hook**

```ts
  addBox(input: NewBox): FullBox {
    const res = this.db
      .prepare(
        `INSERT INTO boxes (creator, owner, size, contents, announce, created, opened, label, origin, loc, tiles, fwd)
         VALUES (?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      )
      .run(
        input.creator,
        input.size,
        JSON.stringify(input.contents),
        input.announce ? 1 : 0,
        Date.now(),
        input.loc,
        input.loc,
        JSON.stringify(input.tiles),
        JSON.stringify(input.fwd),
      );
    return this.getBox(Number(res.lastInsertRowid))!;
  }
```

```ts
  /** The creator changed a sealed box; where it stands, its size and its history stay. */
  editBox(id: number, contents: BoxContents, announce: boolean) {
    this.db.prepare("UPDATE boxes SET contents = ?, announce = ? WHERE id = ?").run(JSON.stringify(contents), announce ? 1 : 0, id);
  }

  /** Tests only: write a raw contents string to check the corrupt-row fallback. */
  debugSetContents(id: number, raw: string) {
    this.db.prepare("UPDATE boxes SET contents = ? WHERE id = ?").run(raw, id);
  }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test server/store.test.ts`
Expected: 15 tests pass, and the two migration tests print `[planet] migrated ...`.

- [ ] **Step 6: Check the shared and server files**

Run: `npx tsc --noEmit 2>&1 | grep -E '^(shared|server)/' ; echo "exit $?"`
Expected: only `server/index.ts` lines remain (Task 3).

- [ ] **Step 7: Commit**

```bash
git add server/store.ts server/store.test.ts
git commit -m "Store: one contents column per box, rebuilt once from the flat columns"
```

---

### Task 3: The server speaks contents, announces its build id, and the smoke test covers the picture

**Files:**
- Modify: `server/index.ts`
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: `parseContents` (Task 1), `mediaOf` (Task 1), `Store.addBox`/`editBox` (Task 2).
- Produces: `welcome.build` is the trimmed text of `dist/build-id`, or `dev` when that file is missing (Task 9 writes it at build time).

- [ ] **Step 1: Fix the imports and add the build id**

In `server/index.ts` change the `node:fs` import to include `readFileSync`:

```ts
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
```

Change the value import from the protocol to:

```ts
import {
  BOX_LABEL_MAX_LEN,
  CHAT_MAX_LEN,
  MEDIA_MAX_BYTES,
  N,
  NAME_MAX_LEN,
  PASS_MIN_LEN,
  RECALL_WINDOW_MS,
  SETUP_CREATOR,
  boxTileCount,
  mediaOf,
} from "../shared/protocol.ts";
```

Change the type import to drop `BoxCard` and `BoxStyle`:

```ts
import type {
  Box,
  BoxDenyReason,
  BoxOp,
  BoxSize,
  ClientMessage,
  MediaRef,
  PlayerId,
  ServerMessage,
  StateData,
  Vec3,
} from "../shared/protocol.ts";
import { parseContents } from "./contents.ts";
import { Store, type FullBox } from "./store.ts";
```

After `const serveStatic = ...` add:

```ts
// the build writes its id next to the bundle (vite.config.ts); a tab running
// another bundle reloads when it sees a different id in the welcome
const BUILD_ID = existsSync(join(distDir, "build-id")) ? readFileSync(join(distDir, "build-id"), "utf8").trim() || "dev" : "dev";
```

- [ ] **Step 2: Replace `viewOf` and the old parsing helpers**

Replace `viewOf` with:

```ts
/** What `viewer` may see of a box: contents only for the creator, or once opened. */
function viewOf(box: FullBox, viewer: PlayerId): Box {
  if (box.creator === viewer || box.opened !== null) return box;
  const { contents: _hidden, ...sealed } = box;
  return sealed;
}
```

Delete `isMediaRef`, `isStyle`, the `graphemes` segmenter, `cleanCard` and the old `parseContents` function from `server/index.ts`. In their place add:

```ts
const fileExists = (name: string) => existsSync(join(MEDIA_DIR, name));
/** Style, words, picture or prints of a box request, cleaned; null when they make no valid box. */
const contentsOf = (raw: unknown) => parseContents(raw, fileExists);
```

If `noUnusedLocals` complains about `_hidden`, write the strip as `const sealed = { ...box }; delete (sealed as Partial<FullBox>).contents; return sealed;` instead.

- [ ] **Step 3: Update the four handlers and the welcome**

In the `welcome` send, after `boxes: ...,` add `build: BUILD_ID,`.

`box-place`: replace `const contents = parseContents(msg);` with `const contents = contentsOf(msg.contents);` and the `store.addBox(...)` call with:

```ts
      const box = store.addBox({ creator: id, size: msg.size, contents, announce: !!msg.announce, loc, tiles: msg.tiles, fwd: msg.fwd });
```

`box-delete`: replace `for (const m of box.media) removeMediaFile(m.url);` with `for (const m of mediaOf(box.contents)) removeMediaFile(m.url);`.

`box-edit`: replace from `const contents = parseContents(msg);` to the `broadcastBox` line with:

```ts
      const contents = contentsOf(msg.contents);
      if (!contents) {
        deny(ws, "edit", "invalid", boxId);
        return;
      }
      store.editBox(box.id, contents, !!msg.announce);
      // files the new version no longer uses are gone for good (a replaced picture included)
      const stillUsed = new Set(mediaOf(contents).map((m) => m.url));
      for (const m of mediaOf(box.contents)) if (!stillUsed.has(m.url)) removeMediaFile(m.url);
      broadcastBox(store.getBox(box.id)!);
```

- [ ] **Step 4: Typecheck shared and server**

Run: `npx tsc --noEmit 2>&1 | grep -E '^(shared|server)/' ; echo "exit $?"`
Expected: no lines, `exit 1`.

- [ ] **Step 5: Rewrite the box section of `scripts/smoke.mjs`**

Every `box-place` and `box-edit` message changes shape, and every assertion on `box.text`, `box.media`, `box.card` or `box.style` moves under `box.contents`. Apply these rules throughout the file:

| old | new |
| --- | --- |
| `style: "postcard", card: C, text: T, media: M, announce: A` | `contents: { style: "postcard", picture: null, writing: { text: T, ...C } }, announce: A` (with `stamp: "", place: "", to: "", from: ""` when there was no card) |
| `style: "note", text: T, media: M, announce: A` | `contents: { style: "note", text: T, media: M }, announce: A` |
| `style: "media", text: T, media: M, announce: A` | `contents: { style: "media", caption: T, media: M }, announce: A` |
| `box.text === X` | `box.contents.writing.text === X` (postcards) or `box.contents.text === X` (notes) |
| `box.text === undefined` / `box.media === undefined` / `box.card === undefined` | `box.contents === undefined` |
| `box.style === "postcard"` on the partner's sealed view | `box.contents === undefined && box.style === undefined` |
| `box.card.to === X` | `box.contents.writing.to === X` |
| `box.media.length` on a postcard | remove: postcards carry no prints |

Then make these content changes:

1. First welcome: where the smoke first receives a `welcome` for A, add `expect(typeof w.build === "string" && w.build.length > 0, "welcome carries the server's build id");` (the variable name is whatever that welcome is bound to).
2. The first box A leaves becomes a postcard with a picture. Keep the `media2` upload and send:

```js
  a.send({
    t: "box-place",
    size: "s",
    contents: {
      style: "postcard",
      picture: { image: media2, focus: { x: 0.3, y: 0.7 }, zoom: 1.5, caption: "the lake at dusk" },
      writing: { text: "meet me where the lake is bluest", stamp: "🐝", place: "the lake", to: "my love", from: "your bee" },
    },
    announce: true,
    loc: "globe",
    tiles: [43],
    fwd: [0, 0, 1],
  });
```

and assert on `pa`:

```js
  expect(
    pa.t === "box" &&
      pa.box.contents.style === "postcard" &&
      pa.box.contents.writing.text === "meet me where the lake is bluest" &&
      pa.box.contents.writing.to === "my love" &&
      pa.box.contents.picture.image.url === media2.url &&
      pa.box.contents.picture.focus.x === 0.3 &&
      pa.box.contents.picture.zoom === 1.5 &&
      pa.box.contents.picture.caption === "the lake at dusk",
    "creator sees the postcard she left: words, dressing, picture and its crop",
  );
```

and on `pb`: `pb.box.contents === undefined && pb.box.style === undefined` in place of the old three `undefined` checks and the `style === "postcard"` check, with the message "partner sees the sealed box but neither its contents nor its style".

3. Replace the "media must be a file the upload endpoint stored" refusal with three picture refusals plus the old shape (upload a tiny `video/mp4` first):

```js
  const upVid = await fetch(`http://localhost:${PORT}/media`, {
    method: "POST",
    headers: { "content-type": "video/mp4", "x-planet-pass": PASS },
    body: Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]),
  });
  const clip = await upVid.json();
  const picturePlace = (picture, tiles = [300]) => ({
    t: "box-place",
    size: "s",
    contents: { style: "postcard", picture, writing: { text: "", stamp: "", place: "", to: "", from: "" } },
    announce: false,
    loc: "globe",
    tiles,
    fwd: [0, 0, 1],
  });
  b.send(picturePlace({ image: clip, focus: { x: 0.5, y: 0.5 }, zoom: 1, caption: "" }));
  expect((await b.next()).reason === "invalid", "a video cannot be the picture side");
  b.send(picturePlace({ image: { url: "/media/1-deadbeef.png", kind: "image" }, focus: { x: 0.5, y: 0.5 }, zoom: 1, caption: "" }));
  expect((await b.next()).reason === "invalid", "the picture must be a file the upload endpoint stored");
  b.send(picturePlace(null));
  expect((await b.next()).reason === "invalid", "a postcard needs words or a picture");
  b.send({ t: "box-place", size: "s", style: "postcard", text: "old tab", media: [], announce: false, loc: "globe", tiles: [300], fwd: [0, 0, 1] });
  expect((await b.next()).reason === "invalid", "a message in the old flat shape is refused");
```

4. Replace the "a tab from before styles still leaves a postcard" block (`legacy`) with a clamping check, keeping the variable name `legacy` so the later cleanup loop still works:

```js
  a.send(picturePlace({ image: media2, focus: { x: 2, y: -1 }, zoom: 9, caption: "🌙".repeat(70) }, [303]));
  const legacy = await a.next();
  await b.next();
  expect(
    legacy.t === "box" &&
      legacy.box.contents.picture.focus.x === 1 &&
      legacy.box.contents.picture.focus.y === 0 &&
      legacy.box.contents.picture.zoom === 3 &&
      [...legacy.box.contents.picture.caption].length === 60,
    "focus and zoom are clamped and the caption is cut at 60",
  );
```

The server deletes a box's files without reference counting, so this box must not share `media2` with the first box: upload a separate file `mediaClamp` (the same `fetch` as `media2` with a different byte), use it as `image` here instead of `media2`, and let the existing cleanup loop delete the box and its file.

5. The "odd card" block becomes a `writing` with the odd fields, asserting `odd.box.contents.writing.stamp === "🐝🐝"`, `.place.length === 40`, `.to === ""`, `.from === ""`.
6. The "a note never carries a card" block: send `contents: { style: "note", text: "a note", media: [] }` and assert `noted.box.contents.style === "note" && noted.box.contents.writing === undefined`.
7. The first edit replaces the picture (and the old file goes):

```js
  a.send({
    t: "box-edit",
    id: boxId,
    contents: {
      style: "postcard",
      picture: { image: media4, focus: { x: 0.5, y: 0.5 }, zoom: 1, caption: "dusk, later" },
      writing: { text: "meet me where the lake is bluest, at dusk", stamp: "🐝", place: "the lake", to: "sweetheart", from: "your bee" },
    },
    announce: false,
  });
```

asserting `editedA.box.contents.writing.text`, `.writing.to === "sweetheart"`, `.picture.image.url === media4.url`, `.picture.caption === "dusk, later"`, `editedA.box.announce === false`; `editedB.box.contents === undefined`; and `media2` is 404 with the message "the picture the edit replaced is deleted from disk".

8. The "second edit keeps one photo and adds another" block becomes: edit again keeping `media4` as the picture with a new caption `"still dusk"`, then assert `again.box.contents.picture.caption === "still dusk"` and `media4` is 200 with the message "a picture kept through an edit stays on disk". Drop the `media5` upload.
9. Opening: `ob.box.contents.writing.text === "meet me where the lake is bluest, at dusk" && ob.box.contents.writing.stamp === "🐝" && ob.box.contents.picture.caption === "still dusk"`.
10. The two "too late" edits send `contents: { style: "postcard", picture: null, writing: { text: "too late", stamp: "", place: "", to: "", from: "" } }`.
11. Notes elsewhere (`third`, the b `box-edit` refusal) follow the table. The `third` assertion becomes `third.box.contents.style === "note" && third.box.contents.media.length === 1`.
12. Reconnect: `x.contents.writing.text === "meet me where the lake is bluest, at dusk"`.

- [ ] **Step 6: Run the smoke test**

Run: `npm run smoke`
Expected: `SMOKE PASSED`. Fix any assertion the rewrite missed by reading the server's actual answer, not by weakening the check.

- [ ] **Step 7: Run the unit tests**

Run: `npm test`
Expected: all pass (22 before this plan, now 22 minus the 11 replaced store tests plus 15 store plus 10 contents; the count printed is what matters, with 0 failures).

- [ ] **Step 8: Commit**

```bash
git add server/index.ts scripts/smoke.mjs
git commit -m "Server: parse typed contents, strip them for the partner, delete a replaced picture, report the build id"
```

---

### Task 4: Pure crop math

**Files:**
- Create: `src/crop.ts`
- Test: `src/crop.test.ts`

**Interfaces:**
- Produces: `type Size = { w: number; h: number }`, `type Focus = { x: number; y: number }`, `type Placement = { left: number; top: number; width: number; height: number }`, `placePicture(frame: Size, photo: Size, focus: Focus, zoom: number): Placement`, `focusFrom(frame: Size, placed: Placement): Focus`, `clampZoom(z: number): number`.

- [ ] **Step 1: Write the failing tests**

Create `src/crop.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test src/crop.test.ts`
Expected: FAIL, cannot find `src/crop.ts`.

- [ ] **Step 3: Write `src/crop.ts`**

```ts
// Where a photo sits inside the picture face. Pure math, no DOM, so the Node
// test runner can drive it; compose and read both call placePicture so the
// finder sees exactly the crop the sender left.
import { PICTURE_ZOOM_MAX, PICTURE_ZOOM_MIN } from "../shared/protocol.ts";

export type Size = { w: number; h: number };
export type Focus = { x: number; y: number };
export type Placement = { left: number; top: number; width: number; height: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The photo covers the frame (the larger of the two cover ratios, times the
 * zoom) with `focus` at the frame's centre, then shifts just enough that no
 * frame edge shows photo-free space.
 */
export function placePicture(frame: Size, photo: Size, focus: Focus, zoom: number): Placement {
  const scale = Math.max(frame.w / photo.w, frame.h / photo.h) * zoom;
  const width = photo.w * scale;
  const height = photo.h * scale;
  const left = clamp(frame.w / 2 - focus.x * width, frame.w - width, 0);
  const top = clamp(frame.h / 2 - focus.y * height, frame.h - height, 0);
  return { left, top, width, height };
}

/** The focus that reproduces a (clamped) placement: what to store after a drag. */
export function focusFrom(frame: Size, placed: Placement): Focus {
  return { x: (frame.w / 2 - placed.left) / placed.width, y: (frame.h / 2 - placed.top) / placed.height };
}

export function clampZoom(z: number): number {
  return clamp(z, PICTURE_ZOOM_MIN, PICTURE_ZOOM_MAX);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test src/crop.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/crop.ts src/crop.test.ts
git commit -m "Crop math for the picture side: cover, focus, zoom, clamping and the inverse"
```

---

### Task 5: The client speaks contents (no picture UI yet)

**Files:**
- Create: `src/dom.ts`
- Modify: `src/net.ts`, `src/chat.ts`, `src/postcard.ts`, `src/treasures.ts`

**Interfaces:**
- Consumes: `BoxContents`, `Picture`, `Writing`, `mediaOf` (Task 1).
- Produces: `Net.placeBox({ size, contents, announce, loc, tiles, fwd })`, `Net.editBox(id, contents, announce)`; `uploadMedia(file: Blob)`; in `postcard.ts`: `Dressing = { stamp; place; to; from }`, `PictureDraft = { source: MediaRef | Blob; focus: Focus; zoom: number; caption: string }`, `Draft = { style, text, dressing, picture, keep, files, size, announce }`, `ComposeOptions.initial?: { contents: BoxContents; announce: boolean }`, `ReadOptions.box: Box & { contents: BoxContents }`; `src/dom.ts` exports `el` and `graphemes` (re-exported from `postcard.ts` so existing imports keep working).

- [ ] **Step 1: Move `el` and `graphemes` into `src/dom.ts`**

Create `src/dom.ts` with the two functions exactly as they are in `postcard.ts` (including the `segmenter` constant), then in `postcard.ts` delete them and add:

```ts
import { el, graphemes } from "./dom.ts";
export { el, graphemes };
```

- [ ] **Step 2: Network and upload**

In `src/net.ts` replace `placeBox` and `editBox`:

```ts
  placeBox(msg: { size: BoxSize; contents: BoxContents; announce: boolean; loc: string; tiles: number[]; fwd: Vec3 }) {
    this.send({ t: "box-place", ...msg });
  }
```

```ts
  editBox(id: number, contents: BoxContents, announce: boolean) {
    this.send({ t: "box-edit", id, contents, announce });
  }
```

and fix the type import (`BoxContents` instead of `BoxCard`, `BoxStyle`, `MediaRef` if they become unused).

In `src/chat.ts` change the signature `export async function uploadMedia(file: File)` to `export async function uploadMedia(file: Blob)`; the body only uses `type` and `size`, which `Blob` has.

- [ ] **Step 3: Draft and options in `src/postcard.ts`**

Replace the `Contents`, `Draft`, `ComposeOptions.initial` and `ReadOptions.box` declarations:

```ts
/** The postcard's dressing as the sender typed it; empty fields mean "the default". */
export type Dressing = { stamp: string; place: string; to: string; from: string };

/** The picture side while composing: the photo (on the server already, or a new file or shot) and its framing. */
export type PictureDraft = { source: MediaRef | Blob; focus: { x: number; y: number }; zoom: number; caption: string };

export type Draft = {
  style: BoxStyle;
  /** The words: the postcard or note text, or the photo box caption. */
  text: string;
  dressing: Dressing;
  /** Postcards only; null for an empty picture side. */
  picture: PictureDraft | null;
  /** Prints already on the server that stay (editing a note or a photo box). */
  keep: MediaRef[];
  /** New prints to upload. */
  files: File[];
  /** The chest size; null when editing, since the chest already stands. */
  size: BoxSize | null;
  announce: boolean;
};
```

```ts
  /** Editing a box that already exists: prefill from it and hide the size picker. */
  initial?: { contents: BoxContents; announce: boolean };
```

```ts
  box: Box & { contents: BoxContents };
```

Update the protocol import: drop `BoxCard`, add `BoxContents`. `cardInputs(mark, card: Dressing | null)` keeps its body, only the parameter type changes.

- [ ] **Step 4: Compose reads and writes contents**

In `compose()`:

```ts
    const initial = opts.initial;
    const editing = initial !== undefined;
    const c = initial?.contents;
    const startText = c === undefined ? "" : c.style === "postcard" ? c.writing.text : c.style === "note" ? c.text : c.caption;
    const keep: MediaRef[] = c !== undefined && c.style !== "postcard" ? [...c.media] : [];
    const files: File[] = [];
    const urls: string[] = [];
    let size: BoxSize | null = editing ? null : (ORDER.find((s) => opts.fits[s]) ?? null);
    let style: BoxStyle = c?.style ?? "postcard";
    // the picture side arrives in Task 6; until then an edit keeps whatever picture the box had
    let picture: PictureDraft | null =
      c?.style === "postcard" && c.picture
        ? { source: c.picture.image, focus: { ...c.picture.focus }, zoom: c.picture.zoom, caption: c.picture.caption }
        : null;
```

`textarea.value = startText;` and `const fields = this.cardInputs(opts.mark, c?.style === "postcard" ? c.writing : null);`.

In `render()`, the postcard branch appends only the card: `body.append(card);` (no prints). The `.pc-add` button and the prints belong to notes and photo boxes only, so hide the add button in the postcard branch (`addBtn.hidden = true` there, and let `renderPrints` set it for the other two styles).

The "missing" check for the postcard style becomes `text || picture ? null : "Write something or add a picture first"`.

The send builds the draft:

```ts
        await opts.onSend({
          style,
          text,
          dressing: {
            stamp: fields.stamp.value.trim(),
            place: fields.place.value.trim(),
            to: fields.to.value.trim(),
            from: fields.from.value.trim(),
          },
          picture: style === "postcard" ? picture : null,
          keep: [...keep],
          files: [...files],
          size,
          announce: check.checked,
        });
```

`start` and `changed()`: replace `text: initial?.text ?? ""` with `text: startText`, `media: initial?.media.length ?? 0` with `media: keep.length` (read once at the start), `stamp: initial?.card?.stamp || opts.mark.stamp` with `stamp: (c?.style === "postcard" && c.writing.stamp) || opts.mark.stamp` and the same pattern for `place`, `to`, `from`, and `style: initial?.style ?? "postcard"` with `style: c?.style ?? "postcard"`.

- [ ] **Step 5: Read shows contents**

In `read()` replace the body-building part (from `const prints = ...` to the end of the `else` that appends the card) with:

```ts
    const c = box.contents;
    const prints = el("div", "pc-prints");
    if (c.style !== "postcard") {
      for (const m of c.media) {
        const print = el("div", "pc-print");
        print.append(mediaElement(m, "row"));
        prints.append(print);
      }
    }
    const body = el("div", "pc-body");
    const wordsEl = (words: string) => {
      const text = el("div", "pc-text");
      if (words) text.textContent = words;
      else {
        text.textContent = "(no words, just the pictures)";
        text.classList.add("pc-empty");
      }
      return text;
    };
    if (c.style === "media") {
      prints.classList.add("pc-big");
      body.append(prints);
      if (c.caption) body.append(el("div", "pc-caption-read", c.caption));
    } else if (c.style === "note") {
      const sheet = el("div", "pc-note");
      sheet.append(wordsEl(c.text));
      body.append(sheet, prints);
    } else {
      body.append(this.card(mark, wordsEl(c.writing.text)));
    }
```

- [ ] **Step 6: Treasures builds contents**

In `src/treasures.ts`:

Import `mediaOf` is not needed here; import types `BoxContents`, `Picture` from the protocol and `PictureDraft` is not needed. Replace the `uploadAll` method with:

```ts
  /** What the box will hold: the kept files plus everything new uploaded, shaped for the style. */
  private async contentsOf(draft: Draft): Promise<BoxContents> {
    if (draft.style === "postcard") {
      const p = draft.picture;
      const picture: Picture | null = p
        ? { image: p.source instanceof Blob ? await uploadMedia(p.source) : p.source, focus: p.focus, zoom: p.zoom, caption: p.caption }
        : null;
      return { style: "postcard", picture, writing: { text: draft.text, ...draft.dressing } };
    }
    const media: MediaRef[] = [...draft.keep];
    for (const f of draft.files) media.push(await uploadMedia(f));
    return draft.style === "note" ? { style: "note", text: draft.text, media } : { style: "media", caption: draft.text, media };
  }
```

In `compose()`'s `onSend`: `const contents = await this.contentsOf(draft);` and

```ts
            this.hooks.net.placeBox({ size, contents, announce: draft.announce, loc: world.id, tiles, fwd: vec(forward) }),
```

In `edit(box)`: guard `const contents = box.contents; if (!contents) return;` at the top, `initial: { contents, announce: box.announce }`, and in `onSend`: `const contents = await this.contentsOf(draft);` then `this.hooks.net.editBox(box.id, contents, draft.announce)`.

`apply()`: the merge becomes

```ts
    const box = prev?.contents !== undefined && incoming.contents === undefined ? { ...incoming, contents: prev.contents } : incoming;
```

Every `box.text !== undefined` / `current.text !== undefined` check becomes `box.contents !== undefined` / `current.contents !== undefined` (in `apply`, `refreshReading`, `open`).

`showRead(box)`: start with `const contents = box.contents; if (!contents) return;`, replace the `card` lookup with `const card = contents.style === "postcard" ? contents.writing : null;` (the `mark` construction stays the same), and pass `box: { ...box, contents }` to `this.postcard.read`.

`row(box, kind)`: the thumbnail source becomes

```ts
    const c = box.contents;
    const first = c === undefined ? undefined : c.style === "postcard" ? c.picture?.image : c.media[0];
```

- [ ] **Step 7: Typecheck, tests, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean for the whole project, all tests pass, build succeeds.

- [ ] **Step 8: Try it in the browser**

Run `npm run dev` in the background, open two tabs (identities 0 and 1 with the dev pass), leave a postcard, a note and a photo box, open them as the partner, edit the postcard, take one back. Everything behaves as before this plan, except a postcard offers no "add photos or videos" button. Stop the dev server afterwards.

- [ ] **Step 9: Commit**

```bash
git add src/dom.ts src/net.ts src/chat.ts src/postcard.ts src/treasures.ts
git commit -m "Client: boxes carry typed contents; postcards hold only the card"
```

---

### Task 6: The flip card and the picture face

**Files:**
- Create: `src/picture.ts`
- Modify: `src/postcard.ts`, `index.html`

**Interfaces:**
- Consumes: `placePicture`, `focusFrom`, `clampZoom` (Task 4), `PictureDraft`, `el`, `graphemes` (Task 5).
- Produces: `pictureEditor(initial, hooks): PictureEditor` and `pictureView(picture, onBroken): HTMLElement` in `src/picture.ts`; `ComposeOptions.takePicture?: () => Promise<Blob | null>` (wired in Task 8; the "Take a picture" button shows only when it is provided); the flip DOM `.pc-flip > .pc-flipper > .pc-face.pc-face-writing + .pc-face.pc-face-picture`, plus `button.pc-turn`; class `pc-flipped` on `.pc-flipper` while the picture face shows.

- [ ] **Step 1: Write `src/picture.ts`**

```ts
// The picture side of a postcard. Compose: drag to move, wheel / pinch /
// slider to zoom, a caption in handwriting, and buttons to take, upload or
// remove the photo. Read: the stored crop and caption. Both place the photo
// with the same crop math so the finder sees what the sender saw.
import { PICTURE_CAPTION_MAX, type MediaRef, type Picture } from "../shared/protocol.ts";
import { clampZoom, focusFrom, placePicture, type Focus, type Placement } from "./crop.ts";
import { el, graphemes } from "./dom.ts";

export type PictureDraft = { source: MediaRef | Blob; focus: Focus; zoom: number; caption: string };

export type PictureEditor = {
  root: HTMLElement;
  /** The current draft, or null while the face is empty. */
  draft(): PictureDraft | null;
  /** Has anything changed since the editor was created? */
  dirty(): boolean;
  /** A new photo or shot (focus centred, zoom 1, caption kept), or null to empty the face. */
  set(source: MediaRef | Blob | null): void;
  /** Release object URLs and observers. */
  destroy(): void;
};

export type PictureHooks = {
  /** Photo mode; absent when the world cannot take pictures (the button is not shown then). */
  takePicture?: () => Promise<Blob | null>;
  /** Something failed (a shot, a bad file): show this to the sender. */
  onError(message: string): void;
};

const ICON = {
  camera:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  frame:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/></svg>',
  cross:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

const urlOf = (source: MediaRef | Blob) => (source instanceof Blob ? URL.createObjectURL(source) : source.url);

/** Lays a photo out in `root` and keeps it laid out as the frame resizes. Returns a re-layout function. */
function mountPhoto(root: HTMLElement, img: HTMLImageElement, state: { focus: Focus; zoom: number }, onLayout?: (p: Placement) => void) {
  const layout = () => {
    if (!img.naturalWidth) return;
    const frame = { w: root.clientWidth, h: root.clientHeight };
    if (!frame.w || !frame.h) return;
    const p = placePicture(frame, { w: img.naturalWidth, h: img.naturalHeight }, state.focus, state.zoom);
    img.style.left = `${p.left}px`;
    img.style.top = `${p.top}px`;
    img.style.width = `${p.width}px`;
    img.style.height = `${p.height}px`;
    onLayout?.(p);
  };
  img.addEventListener("load", layout);
  const ro = new ResizeObserver(layout);
  ro.observe(root);
  layout();
  return { layout, stop: () => ro.disconnect() };
}

export function pictureView(picture: Picture, onBroken: () => void): HTMLElement {
  const root = el("div", "pc-picture");
  const img = el("img", "pc-photo");
  img.draggable = false;
  img.alt = "";
  img.addEventListener("error", onBroken, { once: true });
  root.append(img);
  if (picture.caption) root.append(el("div", "pc-cap", picture.caption));
  mountPhoto(root, img, { focus: picture.focus, zoom: picture.zoom });
  img.src = picture.image.url;
  return root;
}

export function pictureEditor(initial: PictureDraft | null, hooks: PictureHooks): PictureEditor {
  const root = el("div", "pc-picture");
  const file = el("input", "pc-picture-file");
  file.type = "file";
  file.accept = "image/*";
  file.hidden = true;
  let draft: PictureDraft | null = initial ? { ...initial, focus: { ...initial.focus } } : null;
  let dirty = false;
  let objectUrl: string | null = null;
  let stop: (() => void) | null = null;

  const release = () => {
    stop?.();
    stop = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  const pick = () => {
    file.value = "";
    file.click();
  };
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      hooks.onError("Only a photo can be the picture side");
      return;
    }
    set(f);
  });

  const take = async () => {
    if (!hooks.takePicture) return;
    try {
      const shot = await hooks.takePicture();
      if (shot) set(shot);
    } catch (err) {
      hooks.onError(err instanceof Error ? err.message : "Could not take the picture");
    }
  };

  const renderEmpty = () => {
    const frame = el("div", "pc-picture-frame");
    frame.append(el("small", undefined, "The picture side"));
    if (hooks.takePicture) {
      const snap = el("button", "pc-primary", "📷 Take a picture");
      snap.id = "pc-snap";
      snap.type = "button";
      snap.addEventListener("click", take);
      frame.append(snap);
    }
    const upload = el("button", "pc-secondary", "Upload a photo");
    upload.id = "pc-upload";
    upload.type = "button";
    upload.addEventListener("click", pick);
    frame.append(upload);
    root.classList.add("pc-picture-empty");
    root.replaceChildren(frame, file);
  };

  const renderPhoto = (d: PictureDraft) => {
    root.classList.remove("pc-picture-empty");
    const img = el("img", "pc-photo");
    img.draggable = false;
    img.alt = "";
    const state = { focus: d.focus, zoom: d.zoom };
    let placed: Placement | null = null;
    const mounted = mountPhoto(root, img, state, (p) => (placed = p));
    stop = mounted.stop;
    const frame = () => ({ w: root.clientWidth, h: root.clientHeight });
    // after any move or zoom the stored focus is re-derived from the clamped
    // position, so what is saved is exactly what is on screen
    const settle = () => {
      mounted.layout();
      if (placed) d.focus = focusFrom(frame(), placed);
      state.focus = d.focus;
      dirty = true;
    };
    const setZoom = (z: number) => {
      d.zoom = clampZoom(z);
      state.zoom = d.zoom;
      slider.value = String(d.zoom);
      settle();
    };

    // drag with one pointer, pinch with two
    const pointers = new Map<number, { x: number; y: number }>();
    let dragStart: { x: number; y: number; left: number; top: number } | null = null;
    let pinchStart: { dist: number; zoom: number } | null = null;
    const dist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    img.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      img.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1 && placed) dragStart = { x: e.clientX, y: e.clientY, left: placed.left, top: placed.top };
      else if (pointers.size === 2) {
        dragStart = null;
        pinchStart = { dist: dist(), zoom: d.zoom };
      }
    });
    img.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinchStart) {
        setZoom((pinchStart.zoom * dist()) / pinchStart.dist);
      } else if (pointers.size === 1 && dragStart && placed) {
        const f = frame();
        const left = Math.min(0, Math.max(f.w - placed.width, dragStart.left + (e.clientX - dragStart.x)));
        const top = Math.min(0, Math.max(f.h - placed.height, dragStart.top + (e.clientY - dragStart.y)));
        d.focus = focusFrom(f, { ...placed, left, top });
        state.focus = d.focus;
        mounted.layout();
        dirty = true;
      }
    });
    const lift = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      dragStart = null;
      pinchStart = null;
      if (pointers.size === 1 && placed) {
        const [p] = [...pointers.values()];
        dragStart = { x: p.x, y: p.y, left: placed.left, top: placed.top };
      }
    };
    img.addEventListener("pointerup", lift);
    img.addEventListener("pointercancel", lift);
    img.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        setZoom(d.zoom * Math.exp(-e.deltaY * 0.002));
      },
      { passive: false },
    );

    const caption = el("input", "pc-cap-in");
    caption.value = d.caption;
    caption.placeholder = "A caption (optional)…";
    caption.spellcheck = false;
    caption.autocomplete = "off";
    caption.addEventListener("input", () => {
      const g = graphemes(caption.value);
      if (g.length > PICTURE_CAPTION_MAX) caption.value = g.slice(0, PICTURE_CAPTION_MAX).join("");
      d.caption = caption.value;
      dirty = true;
    });
    caption.addEventListener("keydown", (e) => {
      // Enter must not reach the chat's "Enter focuses the chat box" listener
      if (e.key === "Enter") {
        e.preventDefault();
        caption.blur();
      }
      e.stopPropagation();
    });

    const tools = el("div", "pc-tools");
    const tool = (svg: string, title: string, id: string, onClick: () => void) => {
      const b = el("button", "pc-tool");
      b.type = "button";
      b.id = id;
      b.title = title;
      b.innerHTML = svg;
      b.addEventListener("click", onClick);
      return b;
    };
    if (hooks.takePicture) tools.append(tool(ICON.camera, "Take another picture", "pc-retake", take));
    tools.append(tool(ICON.frame, "Upload another photo", "pc-replace", pick));
    tools.append(tool(ICON.cross, "Remove the picture", "pc-remove", () => set(null)));

    const slider = el("input", "pc-zoom");
    slider.type = "range";
    slider.min = "1";
    slider.max = "3";
    slider.step = "0.01";
    slider.value = String(d.zoom);
    slider.title = "Zoom";
    slider.addEventListener("input", () => setZoom(Number(slider.value)));

    root.replaceChildren(img, caption, tools, slider, file);
    objectUrl = d.source instanceof Blob ? URL.createObjectURL(d.source) : null;
    img.src = objectUrl ?? urlOf(d.source);
  };

  const render = () => {
    release();
    if (draft) renderPhoto(draft);
    else renderEmpty();
  };

  const set = (source: MediaRef | Blob | null) => {
    dirty = true;
    draft = source ? { source, focus: { x: 0.5, y: 0.5 }, zoom: 1, caption: draft?.caption ?? "" } : null;
    render();
  };

  render();
  return {
    root,
    draft: () => (draft ? { ...draft, focus: { ...draft.focus } } : null),
    dirty: () => dirty,
    set,
    destroy: release,
  };
}
```

Move the `PictureDraft` type here and make `postcard.ts` import it from `./picture.ts` (and re-export it for `treasures.ts`, which imports `Draft` from `postcard.ts`).

- [ ] **Step 2: The flip container in `src/postcard.ts`**

Add a private method:

```ts
  /**
   * The two faces of a postcard on one flip card, plus the pill that names the
   * other face. `picture` null means "no picture side": the pill stays hidden
   * and the card never turns.
   */
  private flipCard(
    writing: HTMLElement,
    picture: HTMLElement | null,
    mode: "compose" | "read",
    startOnPicture: boolean,
  ): { root: HTMLElement; flip(to?: "writing" | "picture"): void; setPicture(face: HTMLElement | null): void } {
    const root = el("div", "pc-flip");
    const flipper = el("div", "pc-flipper");
    const front = el("div", "pc-face pc-face-writing");
    const back = el("div", "pc-face pc-face-picture");
    front.append(writing);
    if (picture) back.append(picture);
    const pill = el("button", "pc-turn");
    pill.type = "button";
    pill.id = "pc-turn";
    flipper.append(front, back);
    root.append(flipper, pill);
    let showing: "writing" | "picture" = "writing";
    const apply = () => {
      flipper.classList.toggle("pc-flipped", showing === "picture");
      front.inert = showing === "picture";
      back.inert = showing === "writing";
      pill.textContent = showing === "writing" ? "picture side ↻" : "writing side ↻";
      pill.hidden = back.childElementCount === 0;
    };
    const flip = (to?: "writing" | "picture") => {
      if (back.childElementCount === 0) return;
      showing = to ?? (showing === "writing" ? "picture" : "writing");
      apply();
    };
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      flip();
    });
    if (mode === "read") {
      // a click or tap anywhere flips; a drag (selecting text) does not
      let down: { x: number; y: number } | null = null;
      root.addEventListener("pointerdown", (e) => {
        down = { x: e.clientX, y: e.clientY };
      });
      root.addEventListener("pointerup", (e) => {
        if (!down || (e.target instanceof Element && e.target.closest(".pc-turn"))) return;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) flip();
        down = null;
      });
    } else {
      // the paper of the writing face flips, its inputs do not; the picture face only flips by the pill
      front.addEventListener("click", (e) => {
        if (e.target instanceof Element && e.target.closest("input, textarea, button")) return;
        flip("picture");
      });
    }
    showing = startOnPicture && picture ? "picture" : "writing";
    apply();
    return {
      root,
      flip,
      setPicture: (face) => {
        back.replaceChildren(...(face ? [face] : []));
        if (!face) showing = "writing";
        apply();
      },
    };
  }
```

`HTMLElement.inert` exists in the DOM lib; if the typecheck lacks it, declare `interface HTMLElement { inert: boolean }` in `src/vite-env.d.ts`.

- [ ] **Step 3: Compose uses the editor and the flip**

In `compose()`:

- Replace the `let picture: PictureDraft | null = ...` line with the editor:

```ts
    const editor = pictureEditor(
      c?.style === "postcard" && c.picture
        ? { source: c.picture.image, focus: { ...c.picture.focus }, zoom: c.picture.zoom, caption: c.picture.caption }
        : null,
      {
        takePicture: opts.takePicture,
        onError: (m) => (error.textContent = m),
      },
    );
    let flipper: ReturnType<Postcard["flipCard"]> | null = null;
```

- In `render()`'s postcard branch, build the flip once and re-use it (the editor's root must not be re-created on a style switch):

```ts
      if (style === "postcard") {
        textarea.placeholder = `Dear ${fields.to.value.trim() || opts.mark.to},`;
        const card = this.card(opts.mark, textarea, fields);
        card.querySelector(".pc-msg")!.append(count);
        addBtn.hidden = true;
        flipper = this.flipCard(card, editor.root, "compose", false);
        body.append(flipper.root);
      }
```

- The draft passes `picture: style === "postcard" ? editor.draft() : null`.
- `changed()` adds `|| editor.dirty()`.
- The "missing" check for postcards uses `editor.draft()`.
- `this.cleanup` also calls `editor.destroy()`.
- Add `takePicture?: () => Promise<Blob | null>;` to `ComposeOptions` with the doc comment `/** Photo mode: hides the dialog, returns a JPEG of the world, or null when cancelled. Absent when unavailable. */`. Task 8 wraps it so the dialog steps aside and comes back on the picture face; in this task, with no `takePicture` passed, the button does not appear.

- [ ] **Step 4: Read uses the view and the flip**

In `read()`'s postcard branch:

```ts
    } else {
      const card = this.card(mark, wordsEl(c.writing.text));
      let flipper: ReturnType<Postcard["flipCard"]>;
      const face = c.picture ? pictureView(c.picture, () => flipper.setPicture(null)) : null;
      flipper = this.flipCard(card, face, "read", face !== null);
      body.append(flipper.root);
    }
```

A broken image (the file is gone) drops the picture face: the card shows the writing face and the pill disappears.

- [ ] **Step 5: Styles in `index.html`**

Add after the `.pc-body` rule:

```css
      /* --- the two faces of a postcard ------------------------------------ */
      .pc-flip {
        position: relative;
        perspective: 1400px;
      }
      .pc-flipper {
        position: relative;
        transform-style: preserve-3d;
        transition: transform 0.6s cubic-bezier(0.4, 0.15, 0.2, 1);
      }
      .pc-flipper.pc-flipped {
        transform: rotateY(180deg);
      }
      .pc-face {
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
      }
      .pc-face-picture {
        position: absolute;
        inset: 0;
        transform: rotateY(180deg);
      }
      .pc-face[inert] {
        pointer-events: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .pc-flipper {
          transition: none;
        }
      }
      .pc-turn {
        position: absolute;
        left: 50%;
        bottom: 8px;
        transform: translateX(-50%);
        border: none;
        border-radius: 999px;
        padding: 4px 10px;
        font: inherit;
        font-size: 11px;
        background: rgba(47, 58, 90, 0.55);
        color: #fff;
        cursor: pointer;
        z-index: 2;
        white-space: nowrap;
      }
      .pc-turn:hover {
        background: rgba(47, 58, 90, 0.75);
      }
      .pc-turn[hidden] {
        display: none;
      }
      /* --- the picture face ---------------------------------------------- */
      .pc-picture {
        position: absolute;
        inset: 0;
        border-radius: 6px;
        overflow: hidden;
        background: #fbf6e9;
        box-shadow: 0 12px 32px rgba(20, 30, 40, 0.4);
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }
      .pc-photo {
        position: absolute;
        display: block;
        max-width: none;
        max-height: none;
        cursor: grab;
      }
      .pc-photo:active {
        cursor: grabbing;
      }
      .pc-picture-frame {
        position: absolute;
        inset: 14px;
        border: 2px dashed #c9bda3;
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        color: #8a7a50;
      }
      .pc-picture-frame small {
        font-size: 10px;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        font-weight: 600;
        margin-bottom: 6px;
      }
      .pc-cap,
      .pc-cap-in {
        position: absolute;
        left: 18px;
        bottom: 12px;
        max-width: 58%;
        font-family: Caveat, "Segoe Print", "Bradley Hand", cursive;
        font-weight: 500;
        font-size: 26px;
        line-height: 1.2;
        color: #fff;
        text-shadow:
          0 1px 4px rgba(0, 0, 0, 0.65),
          0 0 12px rgba(0, 0, 0, 0.35);
        white-space: pre-wrap;
        overflow-wrap: break-word;
      }
      .pc-cap-in {
        width: 58%;
        background: transparent;
        border: none;
        border-bottom: 1px dashed transparent;
        outline: none;
        padding: 0;
        white-space: nowrap;
      }
      .pc-cap-in::placeholder {
        color: rgba(255, 255, 255, 0.7);
      }
      .pc-cap-in:focus {
        border-bottom-color: rgba(255, 255, 255, 0.7);
      }
      .pc-tools {
        position: absolute;
        top: 10px;
        right: 10px;
        display: flex;
        gap: 6px;
      }
      .pc-tool {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: none;
        padding: 0;
        background: rgba(20, 25, 35, 0.55);
        color: #fff;
        display: grid;
        place-items: center;
        cursor: pointer;
      }
      .pc-tool svg {
        width: 17px;
        height: 17px;
      }
      .pc-tool:hover {
        background: rgba(20, 25, 35, 0.8);
      }
      .pc-zoom {
        position: absolute;
        right: 14px;
        bottom: 16px;
        width: 90px;
        height: 4px;
        margin: 0;
        accent-color: #fff;
        opacity: 0.85;
        cursor: pointer;
      }
```

No change to `.pc-card` or any other writing-face rule.

- [ ] **Step 6: Typecheck and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 7: Check it in the browser**

With `npm run dev` running: compose a postcard, click the pill, see the empty picture face with "The picture side" and only "Upload a photo" (no photo mode yet). Upload a portrait phone photo: it covers the face; drag it, scroll to zoom, move the slider, type a caption with 70 emoji and see it stop at 60. Flip back, write, leave the box. As the partner, open it: the picture face shows first with the caption; click the card: it turns to the writing. Resize the window below 560 px: both faces share the portrait shape and the crop still covers. Take screenshots of both faces and look at them closely: the pill centred, the caption legible over light and dark photos, nothing clipped. Fix what looks off.

- [ ] **Step 8: Commit**

```bash
git add src/picture.ts src/postcard.ts index.html
git commit -m "Postcard: a picture face behind the writing, flipped by a pill or a click, with drag, zoom and caption"
```

---

### Task 7: Camera look offsets and photo mode

**Files:**
- Modify: `src/camera.ts`, `index.html`, `src/main.ts`
- Create: `src/photo.ts`

**Interfaces:**
- Produces: `FollowCamera.setLook(yaw: number, tilt: number)`, `FollowCamera.clearLook()`, `FollowCamera.look: { yaw: number; tilt: number }`; `new PhotoMode(renderer: WebGLRenderer, cam: FollowCamera, renderFrame: () => void)` with `take(): Promise<Blob | null>` and `isActive: boolean`; `body.photo` class while photo mode is on; markup `#photo` with `#ph-window`, `#ph-back`, `#ph-hint`, `#ph-shutter`, `#ph-flash`.

- [ ] **Step 1: Look offsets in `src/camera.ts`**

Add module constants and scratch vectors:

```ts
const _dir = new Vector3();
const _right = new Vector3();

const TILT_MIN = -0.26; // a little below the usual view
const TILT_MAX = 1.31; // nearly straight up
```

Add fields and methods to `FollowCamera`:

```ts
  // photo mode: the camera walks around the character (yaw) and tilts its view
  private yaw = 0;
  private tilt = 0;
  private targetYaw = 0;
  private targetTilt = 0;

  /** Photo mode: turn the camera around the character by `yaw` radians and tilt the view by `tilt` radians (up is positive). */
  setLook(yaw: number, tilt: number) {
    this.targetYaw = yaw;
    this.targetTilt = Math.min(TILT_MAX, Math.max(TILT_MIN, tilt));
  }

  /** Ease back to the usual view behind the character. */
  clearLook() {
    this.targetYaw = 0;
    this.targetTilt = 0;
  }

  get look() {
    return { yaw: this.targetYaw, tilt: this.targetTilt };
  }
```

In `desired()`, after `_fwd.set(0, 0, 1).applyQuaternion(player.quat);` add `_fwd.applyAxisAngle(_up, this.yaw);`.

In `snap()`, before computing the position: `this.yaw = this.targetYaw; this.tilt = this.targetTilt;`.

In `update()`, after the zoom easing:

```ts
    this.yaw += (this.targetYaw - this.yaw) * dampFactor(10, dt);
    this.tilt += (this.targetTilt - this.tilt) * dampFactor(10, dt);
```

In `finish()`, replace `this.camera.lookAt(_look);` with:

```ts
    if (Math.abs(this.tilt) > 1e-4) {
      // pitch the view about the camera's own position: the character stays in the foreground
      _dir.subVectors(_look, this.camera.position);
      _right.crossVectors(_dir, _up).normalize();
      _dir.applyAxisAngle(_right, this.tilt);
      _look.copy(this.camera.position).add(_dir);
    }
    this.camera.lookAt(_look);
```

A positive tilt raises the view (rotating the forward direction about the right axis turns it toward up).

- [ ] **Step 2: Photo mode markup and styles in `index.html`**

Before `<div id="lightbox" hidden></div>` add:

```html
    <div id="photo" hidden>
      <div id="ph-window"><span class="ph-corner tl"></span><span class="ph-corner tr"></span><span class="ph-corner bl"></span><span class="ph-corner br"></span></div>
      <button type="button" id="ph-back">← Back to the card</button>
      <div id="ph-hint">Drag to look around · scroll or pinch to zoom · walk as usual</div>
      <button type="button" id="ph-shutter" title="Take the picture"></button>
      <div id="ph-flash"></div>
    </div>
```

Add styles after the `.pc-danger` rule:

```css
      /* --- photo mode: a viewfinder over the world -------------------------- */
      #photo[hidden] {
        display: none;
      }
      #photo {
        position: fixed;
        inset: 0;
        z-index: 2;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        cursor: grab;
      }
      #photo.ph-dragging {
        cursor: grabbing;
      }
      #ph-window {
        position: absolute;
        left: 50%;
        top: 45%;
        width: min(92vw, 105vh);
        aspect-ratio: 3 / 2;
        transform: translate(-50%, -50%);
        box-shadow: 0 0 0 200vmax rgba(10, 14, 22, 0.55);
        border-radius: 4px;
        pointer-events: none;
      }
      .ph-corner {
        position: absolute;
        width: 26px;
        height: 26px;
        border: 2px solid rgba(255, 255, 255, 0.9);
      }
      .ph-corner.tl { left: -2px; top: -2px; border-right: none; border-bottom: none; }
      .ph-corner.tr { right: -2px; top: -2px; border-left: none; border-bottom: none; }
      .ph-corner.bl { left: -2px; bottom: -2px; border-right: none; border-top: none; }
      .ph-corner.br { right: -2px; bottom: -2px; border-left: none; border-top: none; }
      #ph-back {
        position: absolute;
        left: 16px;
        top: 16px;
        border: none;
        border-radius: 14px;
        padding: 9px 14px;
        font: inherit;
        font-size: 14px;
        background: rgba(255, 255, 253, 0.9);
        color: var(--ink);
        cursor: pointer;
      }
      #ph-hint {
        position: absolute;
        left: 50%;
        top: calc(45% + min(92vw, 105vh) / 3 + 14px);
        transform: translateX(-50%);
        color: rgba(255, 255, 255, 0.85);
        font-size: 12px;
        text-align: center;
        white-space: nowrap;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
        pointer-events: none;
      }
      #ph-shutter {
        position: absolute;
        left: 50%;
        bottom: 28px;
        transform: translateX(-50%);
        width: 68px;
        height: 68px;
        border-radius: 50%;
        border: 4px solid rgba(255, 255, 255, 0.9);
        background: rgba(255, 255, 255, 0.25);
        cursor: pointer;
        box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.25);
      }
      #ph-shutter::after {
        content: "";
        position: absolute;
        inset: 6px;
        border-radius: 50%;
        background: #fff;
      }
      #ph-shutter:active::after {
        inset: 9px;
      }
      #ph-flash {
        position: absolute;
        inset: 0;
        background: #fff;
        opacity: 0;
        pointer-events: none;
      }
      #ph-flash.ph-go {
        animation: ph-flash 0.35s ease-out;
      }
      @keyframes ph-flash {
        from { opacity: 0.9; }
        to { opacity: 0; }
      }
      /* while the viewfinder is up the HUD steps aside; the d-pad and the zoom slider stay on top */
      body.photo #chat-panel,
      body.photo #chat-open,
      body.photo #treasure-open,
      body.photo #treasure-panel,
      body.photo #actions,
      body.photo #bubbles,
      body.photo #status,
      body.photo #toast {
        display: none !important;
      }
      body.photo.touch #dpad,
      body.photo.touch #zoom-slider {
        z-index: 3;
      }
      body.photo.touch #ph-shutter {
        bottom: 100px;
      }
      /* the postcard dialog steps aside during photo mode without closing */
      #postcard.pc-away {
        display: none;
      }
```

Check that `#dpad` and `#zoom-slider` are `position: fixed` (they are in `body.touch #dpad` / `body.touch #zoom-slider`) so the `z-index` applies.

- [ ] **Step 3: Write `src/photo.ts`**

```ts
// Photo mode: a viewfinder over the world. Drag to look around (the camera
// walks around the character and tilts up to the sky), zoom and walk as
// usual, then the shutter renders one high-resolution frame, cuts out exactly
// the window and hands back a JPEG.
import type { WebGLRenderer } from "three";
import type { FollowCamera } from "./camera.ts";

const YAW_PER_PX = 0.005;
const TILT_PER_PX = 0.004;
const SHOT_MIN_WIDTH = 1500; // device pixels across the window, where the device allows
const MAX_RATIO = 3;

export class PhotoMode {
  private renderer: WebGLRenderer;
  private cam: FollowCamera;
  private renderFrame: () => void;
  private root: HTMLElement;
  private window: HTMLElement;
  private flash: HTMLElement;
  private active = false;
  private taking = false;

  constructor(renderer: WebGLRenderer, cam: FollowCamera, renderFrame: () => void) {
    this.renderer = renderer;
    this.cam = cam;
    this.renderFrame = renderFrame;
    const $ = (id: string) => {
      const e = document.getElementById(id);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    this.root = $("photo");
    this.window = $("ph-window");
    this.flash = $("ph-flash");
  }

  get isActive() {
    return this.active;
  }

  /** Shows the viewfinder; resolves with the JPEG when the shutter fires, or null on "Back" / Escape. */
  take(): Promise<Blob | null> {
    if (this.active) return Promise.reject(new Error("Already taking a picture"));
    this.active = true;
    this.taking = false;
    document.body.classList.add("photo");
    this.root.hidden = false;
    const start = this.cam.look;
    let yaw = start.yaw;
    let tilt = start.tilt;

    return new Promise<Blob | null>((resolve, reject) => {
      let failure: Error | null = null;
      let drag: { id: number; x: number; y: number } | null = null;
      const onDown = (e: PointerEvent) => {
        if (e.target instanceof Element && e.target.closest("button")) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        this.root.setPointerCapture(e.pointerId);
        this.root.classList.add("ph-dragging");
      };
      const onMove = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        // drag right looks right, drag up looks up
        yaw -= (e.clientX - drag.x) * YAW_PER_PX;
        tilt -= (e.clientY - drag.y) * TILT_PER_PX;
        drag = { id: drag.id, x: e.clientX, y: e.clientY };
        this.cam.setLook(yaw, tilt);
        tilt = this.cam.look.tilt; // stay within the camera's clamp
      };
      const onUp = (e: PointerEvent) => {
        if (drag && e.pointerId === drag.id) drag = null;
        this.root.classList.remove("ph-dragging");
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code === "Escape") {
          e.stopImmediatePropagation();
          e.preventDefault();
          finish(null);
        } else if (e.code === "Space" || e.code === "Enter") {
          e.stopImmediatePropagation();
          e.preventDefault();
          void shoot();
        } else if (e.code === "KeyE") {
          e.stopImmediatePropagation();
        }
      };
      const back = document.getElementById("ph-back")!;
      const shutter = document.getElementById("ph-shutter")!;
      const onBack = () => finish(null);
      const onShutter = () => void shoot();

      const shoot = async () => {
        if (this.taking) return;
        this.taking = true;
        try {
          const blob = await this.capture();
          this.flash.classList.remove("ph-go");
          void this.flash.offsetWidth; // restart the animation
          this.flash.classList.add("ph-go");
          finish(blob);
        } catch {
          failure = new Error("Could not take the picture");
          finish(null);
        }
      };

      let done = false;
      const finish = (blob: Blob | null) => {
        if (done) return;
        done = true;
        this.root.removeEventListener("pointerdown", onDown);
        this.root.removeEventListener("pointermove", onMove);
        this.root.removeEventListener("pointerup", onUp);
        this.root.removeEventListener("pointercancel", onUp);
        removeEventListener("keydown", onKey, true);
        back.removeEventListener("click", onBack);
        shutter.removeEventListener("click", onShutter);
        this.cam.clearLook();
        this.root.hidden = true;
        document.body.classList.remove("photo");
        this.active = false;
        this.taking = false;
        if (failure) reject(failure);
        else resolve(blob);
      };

      this.root.addEventListener("pointerdown", onDown);
      this.root.addEventListener("pointermove", onMove);
      this.root.addEventListener("pointerup", onUp);
      this.root.addEventListener("pointercancel", onUp);
      addEventListener("keydown", onKey, true);
      back.addEventListener("click", onBack);
      shutter.addEventListener("click", onShutter);
    });
  }

  /** One frame at up to MAX_RATIO device pixels per CSS pixel, cropped to the window, as a JPEG. */
  private async capture(): Promise<Blob> {
    const win = this.window.getBoundingClientRect();
    const usual = this.renderer.getPixelRatio();
    const wanted = Math.min(MAX_RATIO, Math.max(usual, SHOT_MIN_WIDTH / win.width));
    this.renderer.setPixelRatio(wanted);
    this.renderer.setSize(innerWidth, innerHeight, false);
    try {
      this.renderFrame();
      const canvas = this.renderer.domElement;
      // the browser may cap the buffer below what we asked for: scale from what it really is
      const ratio = canvas.width / innerWidth;
      const out = document.createElement("canvas");
      out.width = Math.round(win.width * ratio);
      out.height = Math.round(win.height * ratio);
      out.getContext("2d")!.drawImage(canvas, win.left * ratio, win.top * ratio, out.width, out.height, 0, 0, out.width, out.height);
      return await new Promise<Blob>((resolve, reject) =>
        out.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the picture"))), "image/jpeg", 0.92),
      );
    } finally {
      this.renderer.setPixelRatio(usual);
      this.renderer.setSize(innerWidth, innerHeight, false);
    }
  }
}
```

A failed capture stores the error in `failure`, tears photo mode down through the same `finish`, and rejects the promise; the picture editor (Task 6) shows the message in the dialog's error line.

- [ ] **Step 4: Wire it in `src/main.ts`**

Import `PhotoMode` and, after `setupTouchControls(input, cam);`, add:

```ts
  const photo = new PhotoMode(renderer, cam, () => renderer.render(player.world.scene, cam.camera));
```

Add `takePicture: () => photo.take(),` to the `Treasures` hooks object (Task 8 adds the hook type; until then TypeScript flags the extra property, so do this step together with Task 8's hook or leave `photo` referenced in the `__tp` dev hooks: `photo: () => photo.take(),` inside the `__tp` object so nothing is unused).

- [ ] **Step 5: Typecheck and try it from the console**

Run: `npm run typecheck`
Expected: clean.

With `npm run dev` running, in the browser console: `__tp.photo().then(b => console.log(b.size))`. The viewfinder appears, the HUD hides, dragging up shows the sky over your character, WASD still walks, the wheel zooms, Escape leaves with the camera easing back, the shutter or Space flashes and logs a size in the tens of kilobytes. Try on a phone viewport in devtools (touch emulation): the d-pad and zoom slider stay usable, the shutter sits above the d-pad row.

- [ ] **Step 6: Commit**

```bash
git add src/camera.ts src/photo.ts src/main.ts index.html
git commit -m "Photo mode: a viewfinder over the world with look-around, a shutter and a high-resolution JPEG cut to the window"
```

---

### Task 8: Photo mode inside the postcard, and the box goes where you stand

**Files:**
- Modify: `src/postcard.ts`, `src/treasures.ts`, `src/main.ts`

**Interfaces:**
- Consumes: `PhotoMode.take()` (Task 7), `ComposeOptions.takePicture` (Task 6).
- Produces: `TreasureHooks.takePicture(): Promise<Blob | null>`; `Postcard.setAway(on: boolean)`; `ComposeOptions.fitsNow?: () => Record<BoxSize, boolean>`.

- [ ] **Step 1: The dialog steps aside without closing**

In `Postcard` add:

```ts
  private away = false;

  /** Photo mode: hide the dialog (it stays open, nothing is lost) and bring it back. */
  setAway(on: boolean) {
    this.away = on;
    this.root.classList.toggle("pc-away", on);
  }
```

Change the Escape listener to `if (e.code === "Escape" && this.isOpen && !this.away) this.close();`.

- [ ] **Step 2: Compose wraps photo mode and refreshes the sizes**

Add to `ComposeOptions`:

```ts
  /** Which sizes fit where the player stands now: asked again when photo mode returns (new boxes only). */
  fitsNow?: () => Record<BoxSize, boolean>;
```

In `compose()`, pass the editor a wrapped `takePicture`:

```ts
        takePicture: opts.takePicture
          ? async () => {
              this.setAway(true);
              try {
                return await opts.takePicture!();
              } finally {
                this.setAway(false);
                flipper?.flip("picture");
                if (opts.fitsNow) applyFits(opts.fitsNow());
              }
            }
          : undefined,
```

`applyFits` lives next to the size buttons (move the `sizeBtns` creation above the editor if needed, or declare `let applyFits: (f: Record<BoxSize, boolean>) => void` before and assign it after the buttons exist):

```ts
    const applyFits = (fits: Record<BoxSize, boolean>) => {
      for (const b of sizeBtns) {
        const s = b.dataset.size as BoxSize;
        b.disabled = !fits[s];
        b.title = fits[s] ? "" : "no room here";
      }
      if (size && !fits[size]) {
        size = null;
        for (const b of sizeBtns) b.classList.remove("picked");
        error.textContent = "Pick a size that fits where you stand now";
      }
      const someOut = ORDER.some((s) => !fits[s]);
      hint.hidden = !someOut;
    };
```

For `hint` to be toggled it must always exist: create it unconditionally (`const hint = el("span", "pc-hint", "Sizes greyed out do not fit where you stand"); hint.hidden = editing || ORDER.every((s) => opts.fits[s]);`) and append it always; add `.pc-hint[hidden] { display: none; }` to `index.html`.

- [ ] **Step 3: Treasures leaves the box where the sender stands**

Add to `TreasureHooks`:

```ts
  /** Photo mode: a JPEG of the world, or null when the sender came back without a shot. */
  takePicture(): Promise<Blob | null>;
```

Add a helper and rewrite `compose()`:

```ts
  private fitsAt(spot: PlayerSpot): Record<BoxSize, boolean> {
    const { world, tile, forward } = spot;
    const free = (k: number) => this.hooks.canPlaceOn(world, k);
    return {
      s: footprintFor(world, tile, forward, "s", free) !== null,
      m: footprintFor(world, tile, forward, "m", free) !== null,
      l: footprintFor(world, tile, forward, "l", free) !== null,
    };
  }

  /** Walking is allowed while framing a shot; the dialog is muted again afterwards. */
  private async photo(): Promise<Blob | null> {
    this.hooks.onDialog(false);
    try {
      return await this.hooks.takePicture();
    } finally {
      this.hooks.onDialog(true);
    }
  }

  private compose() {
    if (this.postcard.isOpen) return;
    const spot = this.hooks.player();
    if (spot.moving) {
      this.toast("Stand still first");
      return;
    }
    this.setPanelOpen(false);
    this.postcard.compose({
      mark: this.mark(this.me, spot.world.id, new Date()),
      fits: this.fitsAt(spot),
      fitsNow: () => this.fitsAt(this.hooks.player()),
      takePicture: () => this.photo(),
      onSend: async (draft) => {
        const size = draft.size;
        if (!size) throw new Error("Pick a size first");
        // the sender may have walked during photo mode: the box goes where they stand now
        const now = this.hooks.player();
        if (now.moving) throw new Error("Stand still first");
        const { world, tile } = now;
        const forward = now.forward.clone();
        const contents = await this.contentsOf(draft);
        const tiles = footprintFor(world, tile, forward, size, (k) => this.hooks.canPlaceOn(world, k));
        if (!tiles) throw new Error("No room for that size here anymore");
        await this.request(
          "place",
          undefined,
          (b, isNew) => isNew && b.creator === this.me,
          () => this.hooks.net.placeBox({ size, contents, announce: draft.announce, loc: world.id, tiles, fwd: vec(forward) }),
        );
      },
    });
  }
```

In `edit(box)` pass `takePicture: () => this.photo()` and no `fitsNow`.

- [ ] **Step 4: `main.ts` provides the hook**

In the `Treasures` hooks object add `takePicture: () => photo.take(),` and remove the temporary `photo` entry from `__tp` if Task 7 added one (or keep it; it is harmless).

- [ ] **Step 5: Typecheck, build, and walk through it**

Run: `npm run typecheck && npm run build`
Expected: clean.

In the browser: compose a postcard, flip to the picture face, click "📷 Take a picture". The dialog disappears, the viewfinder shows; walk three tiles, drag up toward the sky, press the shutter. The dialog returns on the picture face with the shot staged; the size picker still offers the sizes that fit where you now stand. Leave it here: the chest appears in front of where you stand now, not where you started. Edit a sealed box, retake its picture, save: the box has not moved. Press Escape in photo mode: back on the picture face with no new picture. Press Enter in photo mode: it takes the picture; the chat box does not open.

- [ ] **Step 6: Commit**

```bash
git add src/postcard.ts src/treasures.ts src/main.ts index.html
git commit -m "Photo mode from the card: the dialog steps aside, comes back on the picture face, and the box goes where you stand"
```

---

### Task 9: A build id so stale tabs reload

**Files:**
- Modify: `vite.config.ts`, `src/vite-env.d.ts`, `src/main.ts`

**Interfaces:**
- Consumes: `welcome.build` (Task 3).
- Produces: compile-time constant `__BUILD_ID__`, the file `dist/build-id` after `npm run build`.

- [ ] **Step 1: `vite.config.ts`**

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { defineConfig } from "vite";

// One id per build, baked into the bundle and written next to it, so the
// server can tell a tab that runs an older bundle to reload (main.ts).
const BUILD_ID = process.env.BUILD_ID ?? Date.now().toString(36);

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    {
      name: "build-id",
      apply: "build",
      closeBundle() {
        mkdirSync("dist", { recursive: true });
        writeFileSync("dist/build-id", BUILD_ID);
      },
    },
  ],
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:3001", ws: true },
      "/media": { target: "http://localhost:3001" },
    },
  },
});
```

- [ ] **Step 2: Declare the constant**

Append to `src/vite-env.d.ts`:

```ts
declare const __BUILD_ID__: string;
```

- [ ] **Step 3: Reload once in `src/main.ts`**

Add near the top of the file (outside `boot`):

```ts
/** True when this tab runs an older bundle than the server serves and has not reloaded for it yet. */
function staleBundle(serverBuild: string): boolean {
  if (serverBuild === "dev" || serverBuild === __BUILD_ID__) return false;
  const key = "tp-reloaded-for";
  try {
    if (sessionStorage.getItem(key) === serverBuild) return false; // reloaded already; carry on rather than loop
    sessionStorage.setItem(key, serverBuild);
  } catch {
    return false;
  }
  return true;
}
```

At the very start of `case "welcome": {` add:

```ts
          if (staleBundle(msg.build)) {
            location.reload();
            break;
          }
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build && cat dist/build-id && grep -o "$(cat dist/build-id)" dist/assets/*.js | head -1`
Expected: the id prints, and the same id is found inside the bundle.

Then `npm run preview` (build and start on 3001), open the app, join: no reload loop (the network tab shows one welcome). Stop it, run `npm run build` again (a new id) and `npm start`, and reload nothing: the open tab, when its socket reconnects, receives the new id and reloads once, then stays. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts src/vite-env.d.ts src/main.ts
git commit -m "Build id: a tab running an older bundle reloads once when the server tells it so"
```

---

### Task 10: Playwright drive, README, and the visual pass

**Files:**
- Modify: `scripts/drive-treasure.mjs`, `README.md`

**Interfaces:**
- Consumes: DOM ids and classes from Tasks 6 to 8: `#pc-turn`, `.pc-flipper.pc-flipped`, `.pc-picture-file`, `.pc-photo`, `.pc-cap-in`, `.pc-cap`, `.pc-zoom`, `#pc-snap`, `#pc-retake`, `#pc-remove`, `#photo`, `#ph-shutter`, `#ph-back`, `body.photo`, `#postcard.pc-away`.

- [ ] **Step 1: Rewrite act 1 of `scripts/drive-treasure.mjs` for the two-sided postcard**

Replace the block from `const photo = await b.screenshot();` through `await a.fill("#postcard .pc-from-in", "your bee");` with:

```js
const photo = await b.screenshot(); // any real PNG will do as the "photo"
// the sender dresses the card herself: stamp, recipient, place, signature
await a.fill("#postcard .pc-stamp-in", "🌙");
await a.fill("#postcard .pc-to-in", "my love");
await a.fill("#postcard .pc-place-in", "Sydney");
await a.fill("#postcard .pc-from-in", "your bee");
// the picture side: flip, upload, drag, zoom, caption
await a.click("#pc-turn");
check((await a.locator("#postcard .pc-flipper.pc-flipped").count()) === 1, "the pill turns the card to the picture side");
check((await a.textContent("#pc-turn")) === "writing side ↻", "the pill now names the writing side");
await a.setInputFiles("#postcard .pc-picture-file", { name: "view.png", mimeType: "image/png", buffer: photo });
await a.waitForFunction(() => document.querySelector("#postcard .pc-photo")?.naturalWidth > 0);
const before = await a.evaluate(() => document.querySelector("#postcard .pc-photo").style.left);
const face = await a.locator("#postcard .pc-face-picture").boundingBox();
await a.mouse.move(face.x + face.width / 2, face.y + face.height / 2);
await a.mouse.down();
await a.mouse.move(face.x + face.width / 2 - 120, face.y + face.height / 2 - 40, { steps: 8 });
await a.mouse.up();
// an interrupted drag leaves the photo where it is and the next drag still works
await a.evaluate(() => document.querySelector("#postcard .pc-photo").dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 })));
await a.mouse.move(face.x + face.width / 2, face.y + face.height / 2);
await a.mouse.down();
await a.mouse.move(face.x + face.width / 2 - 40, face.y + face.height / 2, { steps: 4 });
await a.mouse.up();
await a.locator("#postcard .pc-zoom").fill("1.6");
const after = await a.evaluate(() => document.querySelector("#postcard .pc-photo").style.left);
check(before !== after, "dragging and zooming move the photo inside the card");
await a.fill("#postcard .pc-cap-in", "🌙".repeat(70));
check([...(await a.inputValue("#postcard .pc-cap-in"))].length === 60, "the caption stops at 60 graphemes");
await a.fill("#postcard .pc-cap-in", "the view from the hill");
await a.evaluate(() => document.fonts.ready);
await shot(a, "A0-picture-side");
await a.click("#pc-turn");
check((await a.locator("#postcard .pc-flipper.pc-flipped").count()) === 0, "the pill turns the card back to the writing");
```

Remove the earlier `await a.setInputFiles("#pc-file", ...)` line for the postcard (postcards have no prints).

Where B opens the box (after `await shot(b, "B4-postcard")`), add:

```js
check((await b.locator("#postcard .pc-flipper.pc-flipped").count()) === 1, "the finder sees the picture side first");
check((await b.textContent("#postcard .pc-cap")) === "the view from the hill", "the caption is on the picture");
const savedLeft = await b.evaluate(() => document.querySelector("#postcard .pc-photo").style.left);
check(savedLeft !== "0px", "the finder sees the sender's crop, not the default");
await shot(b, "B4a-picture-side");
await b.click("#postcard .pc-face-picture");
await b.waitForTimeout(700);
check((await b.locator("#postcard .pc-flipper.pc-flipped").count()) === 0, "a click on the card turns it to the writing");
// a picture whose file is gone drops the picture side rather than showing a broken image
await b.evaluate(() => {
  const img = document.querySelector("#postcard .pc-photo");
  img.src = "/media/gone-" + Date.now() + ".jpg";
});
await b.waitForFunction(() => document.querySelector("#pc-turn")?.hidden === true);
check(true, "a missing picture file hides the pill and keeps the writing face");
await b.click("#pc-leave");
await b.click("#box-btn");
await b.waitForSelector("#postcard .pc-flipper");
```

(That reopen is needed because the broken-image check destroyed the picture face; the following `#pc-keep` click continues as before. Adjust `#pc-leave` / `#box-btn` to how the script currently reaches the reading view.)

- [ ] **Step 2: Add a photo mode act**

Before the "Act 2" comment, add:

```js
// ---- Act 1b: a postcard with a picture taken inside the world --------------
await a.click("#treasure-open");
await a.click("#treasure-leave");
await a.waitForSelector("#postcard textarea.pc-text");
await a.fill("#postcard textarea.pc-text", "Look at our sky tonight.");
await a.click("#pc-turn");
await a.click("#pc-snap");
await a.waitForSelector("body.photo #photo:not([hidden])");
check((await a.locator("#postcard.pc-away").count()) === 1, "the card steps aside while the viewfinder is up");
check((await a.isHidden("#chat-panel")) && (await a.isHidden("#treasure-open")), "the HUD hides in photo mode");
await shot(a, "D1-viewfinder");
const mid = { x: 640, y: 360 };
await a.mouse.move(mid.x, mid.y);
await a.mouse.down();
await a.mouse.move(mid.x, mid.y + 160, { steps: 10 }); // a drag down: the tilt stops at its lower limit
await a.mouse.up();
await a.mouse.move(mid.x, mid.y);
await a.mouse.down();
await a.mouse.move(mid.x, mid.y - 260, { steps: 10 });
await a.mouse.up();
await a.keyboard.press("KeyW");
await a.waitForTimeout(600);
await shot(a, "D2-aimed-at-the-sky");
await a.click("#ph-shutter");
await a.click("#ph-shutter"); // a second press must not take a second shot
await a.waitForSelector("#postcard:not(.pc-away)");
await a.waitForFunction(() => document.querySelector("#postcard .pc-photo")?.naturalWidth > 0);
check((await a.locator("#postcard .pc-photo").count()) === 1, "one shot, staged on the picture face");
check((await a.locator("#postcard .pc-flipper.pc-flipped").count()) === 1, "the card comes back on the picture side");
check((await a.locator("body.photo").count()) === 0, "photo mode is over");
await shot(a, "D3-shot-staged");
await a.click("#pc-retake");
await a.waitForSelector("body.photo");
await a.keyboard.press("Escape");
await a.waitForSelector("#postcard:not(.pc-away)");
check((await a.locator("#postcard .pc-photo").count()) === 1, "Escape leaves photo mode with the old shot untouched");
await a.click('#postcard [data-size="s"]');
await a.click("#pc-send");
await a.waitForFunction(() => window.__tp.treasures.list().filter((b) => b.creator === 0 && b.loc !== null).length >= 2);
const skyBox = (await a.evaluate(() => window.__tp.treasures.list())).find((b) => b.contents?.writing?.text === "Look at our sky tonight.");
check(skyBox && skyBox.contents.picture && skyBox.contents.picture.image.url.startsWith("/media/"), "the shot was uploaded and the box carries it");
```

For the mobile run (`MOBILE=1`), use `a.touchscreen.tap` on the buttons where `click` fails and skip the mouse drags; the important checks are that both faces share the same size (`boundingBox` of `.pc-face-writing .pc-card` equals `.pc-face-picture`'s within a pixel) and that photo mode shows the d-pad (`#dpad` visible) with the shutter above it.

- [ ] **Step 3: Update act 2's photo box and note selectors**

Act 2 still uses `#pc-file` for the note and the photo box: unchanged. Its caption selector `textarea.pc-caption` is unchanged.

- [ ] **Step 4: Run the drive on desktop and phone**

Start a fresh server: `DB_PATH=/tmp/tp-drive.db PLANET_PASS=planet npm run dev` in the background (delete `/tmp/tp-drive.db` first). Run `node scripts/drive-treasure.mjs`, then delete the database again and run `MOBILE=1 node scripts/drive-treasure.mjs`. Expected: every `ok:` line, no `FAIL`, exit code 0 both times.

- [ ] **Step 5: Look at every screenshot**

Open `/tmp/tinyplanet-treasure-A0-picture-side.png`, `B4a-picture-side.png`, `D1-viewfinder.png`, `D2-aimed-at-the-sky.png`, `D3-shot-staged.png` and the phone versions. Check: the pill is centred and readable on both faces; the caption sits bottom left with a legible shadow; the three tool buttons do not overlap the pill or the caption; the zoom slider sits bottom right; the viewfinder window is 3:2 with four corner marks, the hint under it, the shutter centred; the shot shows sky and the character; on the phone the two faces are the same size and the shutter clears the d-pad. Fix anything that looks off in `index.html` and re-run.

- [ ] **Step 6: README**

In `README.md`, in the "Treasure boxes" section, after the sentence about typing your own stamp, place, "To" and "from", add (one sentence per line):

```
A postcard has two sides: click the card, or the little "picture side" pill, to flip it.
On the picture side, **Take a picture** opens a viewfinder over the world - drag to look around, even straight up at the sky, walk and zoom as usual, and press the shutter - or **Upload a photo** from your device.
Drag the photo to frame it, scroll or pinch to zoom, and write a short caption over it in the same handwriting.
The finder sees the picture first and flips the card to read your words.
```

Also change "Write a postcard, a plain note, or just tuck in photos and videos" to "Write a postcard with a picture on the back, a plain note with photos and videos, or just tuck in photos and videos".

- [ ] **Step 7: Full check and commit**

Run: `npm run typecheck && npm test && npm run smoke && npm run build`
Expected: all green.

```bash
git add scripts/drive-treasure.mjs README.md
git commit -m "Drive and README: the picture side, the flip and photo mode"
```

---

## Self-review notes

- Spec coverage: model and limits (Task 1), storage and migration (Task 2), protocol, filtering, media lifecycle, build id on the server (Task 3), crop (Task 4), client contents and panel thumbnail (Task 5), flip, pill, faces, caption, tools, broken image (Task 6), photo mode, look offsets, HUD, shutter, high-resolution frame, Enter and E handling (Task 7), dialog steps aside, placement spot, size refresh, editing does not move (Task 8), stale tabs (Task 9), Playwright, README (Task 10). The spec's "Phones" section is exercised by the mobile drive in Task 10 and the same CSS as the writing face (Task 6).
- Type consistency: `PictureDraft` is defined once in `src/picture.ts` and re-exported through `postcard.ts`; `Draft.dressing` is a `Dressing`; `contentsOf` returns `BoxContents`; `takePicture` is `() => Promise<Blob | null>` everywhere; `fitsNow` returns `Record<BoxSize, boolean>`.
- Known gap left on purpose: no unit test for `staleBundle` (it needs `sessionStorage`); Task 9 verifies it by hand and the smoke asserts `welcome.build` exists.
