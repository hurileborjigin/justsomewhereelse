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
