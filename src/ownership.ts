// The client's mirror of who owns which building, the open grants and the
// knocks, plus the pure decisions made at a door. The server is the source of
// truth; this only follows its welcome, building, door and knock messages.
// No DOM or three.js here, so the unit tests drive it directly.
import { FIXED_OWNERS, KNOCK_TTL_MS, type DoorGrant, type PlayerId } from "../shared/protocol.ts";

/** How the sign speaks of each player: gloria is she, khurlee is he. */
const PRONOUN: [string, string] = ["she", "he"];

export type OwnershipSnapshot = {
  owners: Record<string, PlayerId>;
  grants: DoorGrant[];
  knocks: { id: string; from: PlayerId }[];
};

export class Ownership {
  private now: () => number;
  private owners = new Map<string, PlayerId>();
  private grants = new Map<string, PlayerId>(); // building id -> guest
  private knocks = new Map<string, { from: PlayerId; at: number }>(); // knocks at buildings this player owns
  private sent = new Map<string, number>(); // knocks this player sent, by building, with when

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Replace everything from a welcome (also after a reconnect). */
  reset(w: {
    buildings: { id: string; owner: PlayerId }[];
    doors: DoorGrant[];
    knocks: { id: string; from: PlayerId; ageMs: number }[];
  }) {
    this.owners = new Map(w.buildings.map((b) => [b.id, b.owner]));
    this.grants = new Map(w.doors.map((d) => [d.id, d.guest]));
    // a knock keeps its age across a reconnect, so it still expires ten minutes after it was made
    this.knocks = new Map(w.knocks.map((k) => [k.id, { from: k.from, at: this.now() - k.ageMs }]));
    this.sent.clear();
  }

  ownerOf(id: string): PlayerId | null {
    if (Object.hasOwn(FIXED_OWNERS, id)) return FIXED_OWNERS[id];
    return this.owners.get(id) ?? null;
  }

  /** A `building` message. Opening to both drops any knock there: the knocker may simply walk in. */
  setOwner(id: string, owner: PlayerId | null) {
    if (owner === null) this.owners.delete(id);
    else this.owners.set(id, owner);
    this.knocks.delete(id);
    if (owner === null) this.sent.delete(id);
  }

  /** A `knock` message: someone knocks at a building this player owns (again renews it). */
  knocked(id: string, from: PlayerId) {
    this.knocks.set(id, { from, at: this.now() });
  }

  /** The owner pressed Let in: the knock is answered here and now, so the button cannot fire twice. */
  answered(id: string) {
    this.knocks.delete(id);
  }

  /** A `door` message: a grant started or ended. */
  door(id: string, guest: PlayerId, open: boolean) {
    if (open) {
      this.grants.set(id, guest);
      this.knocks.delete(id);
    } else if (this.grants.get(id) === guest) {
      this.grants.delete(id);
      this.sent.delete(id);
    }
  }

  /** This player knocked at `id`. */
  knockSent(id: string) {
    this.sent.set(id, this.now());
  }

  /** The server refused that knock (the owner is away, or the door is open anyway). */
  knockDenied(id: string) {
    this.sent.delete(id);
  }

  mayEnter(p: PlayerId, id: string): boolean {
    const owner = this.ownerOf(id);
    return owner === null || owner === p || this.grants.get(id) === p;
  }

  /** The live knock at `id`, or null. */
  pendingKnock(id: string): PlayerId | null {
    const k = this.knocks.get(id);
    if (!k) return null;
    if (this.now() - k.at >= KNOCK_TTL_MS) {
      this.knocks.delete(id);
      return null;
    }
    return k.from;
  }

  /** `p` knocked at `id` and is still waiting, or holds a grant there. */
  waiting(p: PlayerId, id: string): boolean {
    if (this.grants.get(id) === p) return true;
    const at = this.sent.get(id);
    return at !== undefined && this.now() - at < KNOCK_TTL_MS;
  }

  snapshot(): OwnershipSnapshot {
    const owners: Record<string, PlayerId> = { ...FIXED_OWNERS };
    for (const [id, owner] of this.owners) owners[id] = owner;
    const knocks: { id: string; from: PlayerId }[] = [];
    for (const id of [...this.knocks.keys()]) {
      const from = this.pendingKnock(id);
      if (from !== null) knocks.push({ id, from });
    }
    return { owners, grants: [...this.grants].map(([id, guest]) => ({ id, guest })), knocks };
  }
}

/** What the door button does for `me` at `id`: walk in, or knock first. */
export function doorChoice(me: PlayerId, id: string, o: Ownership): "enter" | "knock" {
  return o.mayEnter(me, id) ? "enter" : "knock";
}

/** The pending knocker `me` may let in at `id`, when `me` owns it; otherwise null. */
export function letIn(me: PlayerId, id: string, o: Ownership): PlayerId | null {
  return o.ownerOf(id) === me ? o.pendingKnock(id) : null;
}

/** "the crooked house", "your crooked house" or "gloria's crooked house". */
export function buildingPhrase(name: string, owner: PlayerId | null, me: PlayerId, names: [string, string]): string {
  if (owner === null) return `the ${name}`;
  return owner === me ? `your ${name}` : `${names[owner]}'s ${name}`;
}

/** The sign at a doorstep: its sentence and the one change it offers, if any. */
export function signText(
  id: string,
  name: string,
  owner: PlayerId | null,
  me: PlayerId,
  names: [string, string],
): { text: string; action: "claim" | "open" | null } {
  if (Object.hasOwn(FIXED_OWNERS, id)) {
    return { text: `This is ${buildingPhrase(name, owner, me, names)}.`, action: null };
  }
  const The = `The ${name}`;
  if (owner === null) return { text: `${The} is open to both.`, action: "claim" };
  if (owner === me) return { text: `${The} is yours.`, action: "open" };
  return { text: `${The} is ${names[owner]}'s. Knock and ${PRONOUN[owner]} can let you in.`, action: null };
}
