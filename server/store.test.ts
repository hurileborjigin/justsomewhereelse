import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { BoxCard, Vec3 } from "../shared/protocol.ts";
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
  style: "postcard" as const,
  card: null,
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

test("a box remembers its style and the postcard dressing the sender chose", () => {
  const s = fresh();
  const card: BoxCard = { stamp: "🐝", place: "Sydney", to: "my love", from: "your bee" };
  const dressed = s.addBox({ ...draft, card });
  assert.equal(dressed.style, "postcard");
  assert.deepEqual(dressed.card, card);
  const note = s.addBox({ ...draft, style: "note", card: null, tiles: [40] , size: "s" });
  assert.equal(note.style, "note");
  assert.equal(note.card, null);
  const photos = s.addBox({ ...draft, style: "media", text: "", tiles: [41], size: "s" });
  assert.equal(photos.style, "media");
  assert.equal(photos.text, "");
});

test("a database from before styles gains the columns and reads its old boxes as postcards", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-store-old-"));
  const path = join(dir, "planet.db");
  try {
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE boxes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, creator INTEGER NOT NULL, owner INTEGER, size TEXT NOT NULL,
        text TEXT NOT NULL, media TEXT NOT NULL, announce INTEGER NOT NULL, created INTEGER NOT NULL,
        opened INTEGER, label TEXT, origin TEXT NOT NULL, loc TEXT, tiles TEXT NOT NULL, fwd TEXT NOT NULL
      );
      INSERT INTO boxes (creator, owner, size, text, media, announce, created, opened, label, origin, loc, tiles, fwd)
      VALUES (0, NULL, 's', 'old words', '[]', 1, 1000, NULL, NULL, 'globe', 'globe', '[5]', '[0,0,1]');
    `);
    old.close();
    const s = new Store(path);
    const box = s.getBox(1)!;
    assert.equal(box.style, "postcard");
    assert.equal(box.card, null);
    assert.equal(box.text, "old words");
    const fresh2 = s.addBox({ ...draft, tiles: [6], size: "s", card: { stamp: "🫏", place: "Munich", to: "g", from: "k" } });
    assert.equal(fresh2.id, 2);
    assert.equal(fresh2.card?.place, "Munich");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
