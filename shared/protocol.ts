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

export type ChatEntry = { from: PlayerId; text: string; ts: number };

// Identity 0 (gloria by default) chooses the shared secret word on the very
// first visit; after that everyone joins with it.
export const SETUP_CREATOR: PlayerId = 0;
export const PASS_MIN_LEN = 3;

export type ClientMessage =
  | { t: "join"; id: PlayerId; pass: string; create?: boolean }
  | ({ t: "state" } & StateData)
  | { t: "rename"; name: string }
  | { t: "chat"; text: string };

export type ServerMessage =
  // open = the planet currently requires no secret word (PLANET_OPEN=1)
  | { t: "lobby"; names: [string, string]; online: [boolean, boolean]; setup: boolean; open: boolean }
  | { t: "deny"; reason: "pass" | "taken" | "setup" | "exists" }
  | {
      t: "welcome";
      id: PlayerId;
      names: [string, string];
      state: StateData | null; // your persisted position (resume where you were)
      peer: { online: boolean; state: StateData | null };
      history: ChatEntry[];
    }
  | ({ t: "state"; id: PlayerId } & StateData)
  | { t: "names"; names: [string, string] }
  | ({ t: "chat" } & ChatEntry)
  | { t: "peer-joined"; id: PlayerId }
  | { t: "peer-left"; id: PlayerId };
