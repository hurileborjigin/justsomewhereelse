// Pure building-ownership rules: claiming, opening, knocking and letting in.
// No network or storage code here, so the unit tests drive it directly; the
// server wires it to the store's owners and to Date.now.
import { FIXED_OWNERS, KNOCK_TTL_MS, type BuildingDenyReason, type DoorGrant, type PlayerId } from "../shared/protocol.ts";

type Knock = { from: PlayerId; at: number };
type Grant = { guest: PlayerId; entered: boolean; at: number };

export class Access {
  private ownerOf: (id: string) => PlayerId | null;
  private now: () => number;
  private knocks = new Map<string, Knock>();
  private grantsById = new Map<string, Grant>();
  private ended: DoorGrant[] = [];

  constructor(ownerOf: (id: string) => PlayerId | null, now: () => number) {
    this.ownerOf = ownerOf;
    this.now = now;
  }

  /** The existing world-id pattern, minus the globe itself (never a building); a non-string is refused too. */
  validBuildingId(id: string): boolean {
    return typeof id === "string" && /^[a-z0-9_-]{1,32}$/.test(id) && id !== "globe";
  }

  /** `owner` is the sender's own id to claim, or null to open the building to both. */
  claim(me: PlayerId, id: string, owner: PlayerId | null): BuildingDenyReason | null {
    this.ended = [];
    if (!this.validBuildingId(id)) return "invalid";
    if (Object.hasOwn(FIXED_OWNERS, id)) return "fixed";
    const current = this.ownerOf(id);
    if (owner !== null) {
      if (current !== null || owner !== me) return "owner";
    } else if (current !== me) {
      return "owner";
    }
    if (owner === null) {
      this.knocks.delete(id);
      const grant = this.grantsById.get(id);
      if (grant) {
        this.grantsById.delete(id);
        this.ended = [{ id, guest: grant.guest }];
      }
    }
    return null;
  }

  /** Grants ended by the most recent claim() call (opening a building with a live guest inside). */
  lastEnded(): DoorGrant[] {
    return this.ended;
  }

  knock(me: PlayerId, id: string, ownerOnline: boolean): BuildingDenyReason | null {
    if (!this.validBuildingId(id)) return "invalid";
    const owner = this.ownerOf(id);
    if (owner === null || owner === me) return "open";
    if (!ownerOnline) return "away";
    this.knocks.set(id, { from: me, at: this.now() });
    return null;
  }

  open(me: PlayerId, id: string): { guest: PlayerId } | BuildingDenyReason {
    if (!this.validBuildingId(id)) return "invalid";
    if (this.ownerOf(id) !== me) return "owner";
    const knock = this.knocks.get(id);
    if (!knock || this.now() - knock.at >= KNOCK_TTL_MS) return "noknock";
    this.knocks.delete(id);
    const guest = knock.from;
    this.grantsById.set(id, { guest, entered: false, at: this.now() });
    return { guest };
  }

  mayEnter(p: PlayerId, id: string): boolean {
    const owner = this.ownerOf(id);
    if (owner === null || owner === p) return true;
    const grant = this.grantsById.get(id);
    return !!grant && grant.guest === p;
  }

  /** Marks entry when `p` reaches a building they hold a grant for; ends the grant once they leave it. */
  moved(p: PlayerId, loc: string): DoorGrant[] {
    const ended: DoorGrant[] = [];
    for (const [id, grant] of this.grantsById) {
      if (grant.guest !== p) continue;
      if (loc === id) {
        grant.entered = true;
      } else if (grant.entered) {
        this.grantsById.delete(id);
        ended.push({ id, guest: p });
      }
    }
    return ended;
  }

  /** Ends every grant `p` held (their disconnect). */
  left(p: PlayerId): DoorGrant[] {
    const ended: DoorGrant[] = [];
    for (const [id, grant] of this.grantsById) {
      if (grant.guest === p) ended.push({ id, guest: p });
    }
    for (const g of ended) this.grantsById.delete(g.id);
    return ended;
  }

  /** Drops knocks and unentered grants older than KNOCK_TTL_MS; returns the ended grants. */
  expire(): DoorGrant[] {
    const now = this.now();
    for (const [id, k] of this.knocks) {
      if (now - k.at >= KNOCK_TTL_MS) this.knocks.delete(id);
    }
    const ended: DoorGrant[] = [];
    for (const [id, g] of this.grantsById) {
      if (!g.entered && now - g.at >= KNOCK_TTL_MS) ended.push({ id, guest: g.guest });
    }
    for (const g of ended) this.grantsById.delete(g.id);
    return ended;
  }

  grants(): DoorGrant[] {
    return [...this.grantsById].map(([id, g]) => ({ id, guest: g.guest }));
  }

  /** Live pending knocks at buildings this owner owns. */
  knocksFor(owner: PlayerId): { id: string; from: PlayerId }[] {
    const now = this.now();
    const result: { id: string; from: PlayerId }[] = [];
    for (const [id, k] of this.knocks) {
      if (now - k.at < KNOCK_TTL_MS && this.ownerOf(id) === owner) result.push({ id, from: k.from });
    }
    return result;
  }
}
