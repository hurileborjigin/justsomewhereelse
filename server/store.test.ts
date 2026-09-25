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

test("liftBoxesOff clears boxes standing on the given tiles, keeps the rest, and is idempotent", () => {
  const s = fresh();
  const onHouse = s.addBox({ ...draft, loc: "globe", tiles: [880, 881] }).id; // one tile under the Hive
  const kept = s.addBox({ ...draft, loc: "globe", tiles: [728] }).id; // on the Copper Hall doorstep
  s.keepBox(kept, 1, "mine");
  s.putBox(kept, "globe", [728], [1, 0, 0]);
  const beside = s.addBox({ ...draft, loc: "globe", tiles: [500, 501] }).id;
  const inRoom = s.addBox({ ...draft, loc: "hive", tiles: [881] }).id; // tile 881 of a room is not the globe's
  assert.deepEqual(s.liftBoxesOff("globe", [882, 881, 883, 727, 726, 728]), [onHouse, kept]);
  for (const id of [onHouse, kept]) {
    const box = s.getBox(id)!;
    assert.equal(box.loc, null);
    assert.deepEqual(box.tiles, []);
  }
  assert.equal(s.getBox(onHouse)!.owner, null, "an unkept box goes back to its creator's pocket");
  assert.equal(s.getBox(kept)!.owner, 1, "a kept box stays its owner's");
  assert.deepEqual(s.getBox(beside)!.tiles, [500, 501]);
  assert.equal(s.getBox(inRoom)!.loc, "hive");
  assert.deepEqual(s.liftBoxesOff("globe", [882, 881, 883, 727, 726, 728]), [], "a second run finds nothing");
});

// --- building ownership ------------------------------------------------

test("owners round-trip through setOwner and ownerOf", () => {
  const s = fresh();
  assert.equal(s.ownerOf("house1"), null);
  s.setOwner("house1", 0);
  assert.equal(s.ownerOf("house1"), 0);
  s.setOwner("house1", 1);
  assert.equal(s.ownerOf("house1"), 1);
});

test("setting an owner to null deletes the row", () => {
  const s = fresh();
  s.setOwner("house1", 0);
  s.setOwner("house1", null);
  assert.equal(s.ownerOf("house1"), null);
  assert.deepEqual(
    s.owners().sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "hall", owner: 1 },
      { id: "hive", owner: 0 },
    ],
  );
});

test("the fixed houses are answered from code, without any row", () => {
  const s = fresh();
  assert.equal(s.ownerOf("hive"), 0);
  assert.equal(s.ownerOf("hall"), 1);
});

test("owners lists every owned building plus the fixed houses", () => {
  const s = fresh();
  s.setOwner("house1", 0);
  s.setOwner("house2", 1);
  assert.deepEqual(
    s.owners().sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "hall", owner: 1 },
      { id: "hive", owner: 0 },
      { id: "house1", owner: 0 },
      { id: "house2", owner: 1 },
    ],
  );
});

test("'constructor' and '__proto__' are never mistaken for fixed houses", () => {
  const s = fresh();
  assert.equal(s.ownerOf("constructor"), null);
  assert.equal(s.ownerOf("__proto__"), null);
  s.setOwner("constructor", 0);
  assert.equal(s.ownerOf("constructor"), 0);
  assert.deepEqual(
    s.owners().sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "constructor", owner: 0 },
      { id: "hall", owner: 1 },
      { id: "hive", owner: 0 },
    ],
  );
});

test("a music session and a Spotify refresh token survive a new store", () => {
  const dir = mkdtempSync(join(tmpdir(), "haven-music-"));
  const path = join(dir, "planet.db");
  try {
    const first = new Store(path);
    const session = first.musicSession(0);
    session.track = { uri: "spotify:track:a", name: "A", artists: "Bee", image: null, durationMs: 1000 };
    session.paused = false;
    first.saveMusicSession(0, session);
    first.setSpotifyRefresh(1, "refresh-1");
    first.close();
    const second = new Store(path);
    assert.equal(second.musicSession(0).track?.uri, "spotify:track:a");
    assert.equal(second.musicSession(1).track, null);
    assert.equal(second.spotifyRefresh(1), "refresh-1");
    assert.equal(second.spotifyRefresh(0), null);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
