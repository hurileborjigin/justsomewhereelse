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
