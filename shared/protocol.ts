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

export const CHARACTERS: Record<CharacterId, { speed: number; hover: number }> = {
  bee: { speed: 4.5, hover: 0.6 },
  donkey: { speed: 4.0, hover: 0 },
};

export type StateData = {
  p: [number, number, number];
  q: [number, number, number, number];
  m: 0 | 1; // moving flag (drives remote walk animation)
};

export type ClientMessage =
  | { t: "hello" }
  | ({ t: "state" } & StateData)
  | { t: "swap" };

export type ServerMessage =
  | {
      t: "welcome";
      id: number;
      character: CharacterId;
      peer?: { id: number; character: CharacterId; state?: StateData };
    }
  | { t: "full" }
  | ({ t: "state"; id: number } & StateData)
  | { t: "characters"; assign: [CharacterId, CharacterId] }
  | { t: "peer-joined"; id: number; character: CharacterId }
  | { t: "peer-left"; id: number };
