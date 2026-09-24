// Single source of truth for world constants and network messages.
// Imported by the Vite client and by the Node server (via type stripping),
// so: no enums, no namespaces, explicit .ts extensions when importing this.

export const R = 20; // globe radius (baked into globe.glb too)
export const N = 16; // tiles per cube-face edge -> 6*N*N tiles total
export const SURFACE = R + 0.06; // tile tops are raised by the Blender inset
export const SEED = 20260921; // world scatter seed - same world for both players
export const SEND_HZ = 15;
export const TURN_SPEED = 8; // rad/s

export type CharacterId = "bee" | "donkey";
export type PlayerId = 0 | 1;

// Fixed casting: identity 0 (gloria) is the bee, identity 1 (khurlee) is the
// donkey. Forever.
export const CHARACTER_OF: [CharacterId, CharacterId] = ["bee", "donkey"];

export const CHARACTERS: Record<CharacterId, { speed: number; hover: number; fly: boolean }> = {
  bee: { speed: 4.5, hover: 0.6, fly: true },
  donkey: { speed: 4.0, hover: 0, fly: false },
};

// Lake tiles as (face, i, j) - keep in sync with assets/blender/globe.py.
// Water blocks walkers (the donkey); flyers (the bee) cross freely.
export const LAKE: [number, number, number][] = [
  [2, 3, 3],
  [2, 4, 3],
  [2, 5, 3],
  [2, 3, 4],
  [2, 4, 4],
  [2, 5, 4],
  [2, 4, 5],
  [2, 5, 5],
];

export const CHAT_MAX_LEN = 200;
export const NAME_MAX_LEN = 24;

export type StateData = {
  p: [number, number, number];
  q: [number, number, number, number];
  m: 0 | 1; // moving flag (drives remote walk animation)
  loc: string; // which world: "globe" or a building instance id
  tile: number; // current tile in that world (persisted for resume)
};

export const MEDIA_MAX_BYTES = 25 * 1024 * 1024; // photos & videos, per file
export const RECALL_WINDOW_MS = 5 * 60 * 1000; // messages can be recalled for 5 minutes

export type MediaRef = { url: string; kind: "image" | "video" };

export type ChatEntry = { id: number; from: PlayerId; text: string; ts: number; media?: MediaRef };

// ---- treasure boxes -------------------------------------------------------

export type BoxSize = "s" | "m" | "l";
export type Vec3 = [number, number, number];

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

export type BoxDenyReason =
  | "invalid"
  | "overlap"
  | "partner"
  | "creator" // keeping a box you left yourself
  | "owner"
  | "missing"
  | "notcreator" // taking back, changing or moving a box someone else left
  | "opened" // taking back or changing a box that has been opened
  | "kept"; // changing or moving a box your partner has kept
export type BoxOp = "place" | "open" | "keep" | "label" | "put" | "delete" | "edit" | "lift";

// Identity 0 (gloria by default) chooses the shared secret word on the very
// first visit; after that everyone joins with it.
export const SETUP_CREATOR: PlayerId = 0;
export const PASS_MIN_LEN = 3;

export type ClientMessage =
  | { t: "join"; id: PlayerId; pass: string; create?: boolean }
  | ({ t: "state" } & StateData)
  | { t: "rename"; name: string }
  | { t: "chat"; text: string; media?: MediaRef }
  | { t: "recall"; id: number }
  | {
      t: "box-place";
      size: BoxSize;
      contents: BoxContents;
      announce: boolean;
      loc: string;
      tiles: number[];
      fwd: Vec3;
    }
  | { t: "box-open"; id: number }
  | { t: "box-keep"; id: number; label?: string }
  | { t: "box-label"; id: number; label: string }
  | { t: "box-put"; id: number; loc: string; tiles: number[]; fwd: Vec3 }
  | { t: "box-delete"; id: number } // take back your own box while it is still sealed
  | { t: "box-edit"; id: number; contents: BoxContents; announce: boolean } // change what a sealed box you left holds
  | { t: "box-lift"; id: number }; // pick your own box up to move it, until your partner keeps it

export type ServerMessage =
  // open = the planet currently requires no secret word (PLANET_OPEN=1)
  | {
      t: "lobby";
      names: [string, string];
      online: [boolean, boolean];
      setup: boolean;
      open: boolean;
      build: string; // the server's build id, so a stale tab can reload before it even logs in
    }
  | { t: "deny"; reason: "pass" | "taken" | "setup" | "exists" }
  | {
      t: "welcome";
      id: PlayerId;
      names: [string, string];
      state: StateData | null; // your persisted position (resume where you were)
      peer: { online: boolean; state: StateData | null };
      history: ChatEntry[];
      boxes: Box[]; // every box, contents stripped unless you may see them
      build: string; // the server's build id; a tab running another bundle reloads once (see main.ts)
    }
  | ({ t: "state"; id: PlayerId } & StateData)
  | { t: "names"; names: [string, string] }
  | ({ t: "chat" } & ChatEntry)
  | { t: "recalled"; id: number }
  | { t: "peer-joined"; id: PlayerId }
  | { t: "peer-left"; id: PlayerId }
  | { t: "box"; box: Box } // one box changed (or answers your box-open)
  | { t: "box-gone"; id: number } // a sealed box was taken back by its creator
  | { t: "box-deny"; op: BoxOp; id?: number; reason: BoxDenyReason }; // id present whenever the request named a box (place has none)
