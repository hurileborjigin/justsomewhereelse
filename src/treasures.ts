import { Vector3, type Group, type Object3D } from "three";
import {
  CHARACTER_OF,
  SURFACE,
  type Box,
  type BoxDenyReason,
  type BoxOp,
  type BoxSize,
  type MediaRef,
  type PlayerId,
  type Vec3,
} from "../shared/protocol.ts";
import { node, type AssetName, type Assets } from "./assets.ts";
import { EMOJI, mediaElement, uploadMedia } from "./chat.ts";
import { footprintFor } from "./footprint.ts";
import { tangentFrameQuat } from "./math.ts";
import type { Net } from "./net.ts";
import { Postcard, TAKE_BACK_CONFIRM, chestIcon, el, type Postmark } from "./postcard.ts";
import type { World } from "./world.ts";

const LID_OPEN = -1.75; // radians around the hinge (about 100 degrees); 0 = sealed
const LID_SPEED = 4; // rad/s
const REQUEST_TIMEOUT_MS = 15_000;
const CHEST: Record<BoxSize, AssetName> = { s: "chest_s", m: "chest_m", l: "chest_l" };
const SIZE_NAME: Record<BoxSize, string> = { s: "S", m: "M", l: "L" };
// How far below the tile tops a chest's center sits on the globe. A flat base
// spanning several curved tiles would float at its ends; sinking by about the
// sagitta of its corners (d^2 / 2R, plus a little for the flat tile facets)
// lets the corners touch the grass while the middle settles in. Measured with
// a raycast from each base corner: L's corners float 0.34-0.42 at a 0.03 sink.
const SINK: Record<BoxSize, number> = { s: 0.03, m: 0.15, l: 0.42 };

const DENY_TEXT: Record<BoxDenyReason, string> = {
  invalid: "The planet didn't accept that box.",
  overlap: "Another box is already standing there.",
  partner: "Your partner is standing right there!",
  creator: "You can't keep a box you left yourself.",
  owner: "Only its owner can do that.",
  missing: "That box isn't there anymore.",
  notcreator: "Only the one who left it can do that.",
  opened: "It has been opened already, so it stays as it is.",
  kept: "Your partner has kept it already, so it stays as it is.",
};

export type PlayerSpot = { world: World; tile: number; forward: Vector3; moving: boolean };

export type TreasureHooks = {
  /** The local player's whereabouts right now. */
  player(): PlayerSpot;
  /** The globe, or a room that has already been created; null otherwise. */
  resolveWorld(loc: string): World | null;
  /** "Tiny Planet" or "the crooked house": for postmarks and panel rows. */
  placeName(loc: string): string;
  /** Per-tile placement rule for `world`: terrain, doors, spawns, the partner. */
  canPlaceOn(world: World, tile: number): boolean;
  /** A postcard dialog opened or closed (walking is muted while open). */
  onDialog(open: boolean): void;
  /** The treasures panel was opened (small screens tidy other panels). */
  onPanelOpen(): void;
  net: Pick<Net, "placeBox" | "openBox" | "keepBox" | "labelBox" | "putBox" | "deleteBox" | "editBox" | "liftBox">;
};

type Mounted = { box: Box; group: Group; lid: Object3D; world: World };
type Pending = {
  op: BoxOp;
  id?: number;
  matches(box: Box, isNew: boolean): boolean;
  resolve(): void;
  reject(err: Error): void;
  timer: number;
};

const _dir = new Vector3();
const _p = new Vector3();
const vec = (v: Vector3): Vec3 => [v.x, v.y, v.z];
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/**
 * Everything treasure: the box list mirrored from the server, the chests in
 * the 3D worlds (with their blocked tiles), the adjacency check behind the
 * action button, the Treasures panel, and the requests to the server.
 */
export class Treasures {
  private assets: Assets;
  private hooks: TreasureHooks;
  private postcard: Postcard;
  private boxes = new Map<number, Box>();
  private mounted = new Map<number, Mounted>();
  private me: PlayerId = 0;
  private names: [string, string] = ["…", "…"];
  private pendingOpen: number | null = null; // box we asked the server to open
  private pending: Pending | null = null; // a place / put waiting for its answer
  private toastTimer = 0;
  private ui: {
    openBtn: HTMLElement;
    badge: HTMLElement;
    panel: HTMLElement;
    waiting: HTMLElement;
    mine: HTMLElement;
    left: HTMLElement;
    toast: HTMLElement;
  };

  constructor(assets: Assets, hooks: TreasureHooks) {
    this.assets = assets;
    this.hooks = hooks;
    this.postcard = new Postcard((open) => hooks.onDialog(open));
    const $ = (id: string) => {
      const e = document.getElementById(id);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    this.ui = {
      openBtn: $("treasure-open"),
      badge: $("treasure-badge"),
      panel: $("treasure-panel"),
      waiting: $("treasure-waiting"),
      mine: $("treasure-mine"),
      left: $("treasure-left"),
      toast: $("toast"),
    };
    this.ui.openBtn.addEventListener("click", () => this.setPanelOpen(true));
    $("treasure-min").addEventListener("click", () => this.setPanelOpen(false));
    $("treasure-leave").addEventListener("click", () => this.compose());
    // the toast floats above the door/box buttons however many are showing
    const actions = $("actions");
    new ResizeObserver(() =>
      document.documentElement.style.setProperty("--actions-h", `${actions.offsetHeight}px`),
    ).observe(actions);
    this.setPanelOpen(false);
  }

  get dialogOpen() {
    return this.postcard.isOpen;
  }

  setPanelOpen(open: boolean) {
    this.ui.panel.hidden = !open;
    this.ui.openBtn.hidden = open;
    if (open) this.hooks.onPanelOpen();
  }

  setIdentity(me: PlayerId, names: [string, string]) {
    this.me = me;
    this.names = names;
    this.renderPanel();
  }

  /** Replace everything (welcome, also after a reconnect). */
  setAll(boxes: Box[]) {
    for (const id of [...this.mounted.keys()]) this.unmount(id);
    this.boxes.clear();
    for (const b of boxes) {
      this.boxes.set(b.id, b);
      this.mount(b);
    }
    this.renderPanel();
  }

  /** One box changed, or the server answered our own request. */
  apply(incoming: Box) {
    const prev = this.boxes.get(incoming.id);
    // never forget contents we were already allowed to see
    const box =
      prev?.text !== undefined && incoming.text === undefined
        ? { ...incoming, text: prev.text, media: prev.media, card: prev.card }
        : incoming;
    this.boxes.set(box.id, box);
    // re-mount, but let an already-standing lid keep its angle so update() swings it
    const lidNow = this.mounted.get(box.id)?.lid.rotation.x;
    this.unmount(box.id);
    this.mount(box, lidNow);
    this.renderPanel();
    if (this.pending?.matches(box, !prev)) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.resolve();
    }
    if (this.pendingOpen === box.id && box.text !== undefined) {
      this.pendingOpen = null;
      this.showRead(box);
    }
  }

  /** The server refused a box request; matched to the pending place/put by op and id, or toasted otherwise. */
  deny(msg: { op: BoxOp; id?: number; reason: BoxDenyReason }) {
    if (this.pending && this.pending.op === msg.op && (this.pending.id === undefined || this.pending.id === msg.id)) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.reject(new Error(DENY_TEXT[msg.reason]));
      return;
    }
    if (msg.op === "open" && this.pendingOpen === msg.id) this.pendingOpen = null;
    this.toast(DENY_TEXT[msg.reason]);
  }

  /** A sealed box was taken back by its creator: gone from the world and from every list. */
  remove(id: number) {
    this.unmount(id);
    this.boxes.delete(id);
    if (this.pendingOpen === id) this.pendingOpen = null;
    this.renderPanel();
  }

  /** A room was just created on this client: its boxes can stand in it now. */
  mountWorld(world: World) {
    for (const b of this.boxes.values()) {
      if (b.loc === world.id && !this.mounted.has(b.id)) this.mount(b);
    }
  }

  /** Every frame: lids swing toward sealed or open. */
  update(dt: number) {
    for (const m of this.mounted.values()) {
      const target = m.box.opened !== null ? LID_OPEN : 0;
      const cur = m.lid.rotation.x;
      const step = LID_SPEED * dt;
      m.lid.rotation.x = Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step;
    }
  }

  /** The box the action button offers from `tile` (closest to the facing), or null. */
  actionAt(world: World, tile: number, forward: Vector3): Box | null {
    let best: Box | null = null;
    let bestDot = -Infinity;
    for (const m of this.mounted.values()) {
      if (m.world !== world) continue;
      for (const t of m.box.tiles) {
        if (!world.areNeighbors(tile, t)) continue;
        const d = world.dirBetween(tile, t, _dir).dot(forward);
        const better = d > bestDot + 1e-6 || (best !== null && Math.abs(d - bestDot) <= 1e-6 && m.box.id < best.id);
        if (better) {
          bestDot = d;
          best = m.box;
        }
      }
    }
    return best;
  }

  /** E on a box, or Open in the panel. Asks the server only when contents are unknown. */
  open(box: Box) {
    const current = this.boxes.get(box.id) ?? box;
    if (current.text !== undefined) {
      this.showRead(current);
      return;
    }
    this.pendingOpen = current.id;
    this.hooks.net.openBox(current.id);
  }

  list(): Box[] {
    return [...this.boxes.values()];
  }

  // ---- placing ----------------------------------------------------------------

  private compose() {
    if (this.postcard.isOpen) return;
    const spot = this.hooks.player();
    if (spot.moving) {
      this.toast("Stand still first");
      return;
    }
    const { world, tile } = spot;
    const forward = spot.forward.clone();
    const free = (k: number) => this.hooks.canPlaceOn(world, k);
    const fits: Record<BoxSize, boolean> = {
      s: footprintFor(world, tile, forward, "s", free) !== null,
      m: footprintFor(world, tile, forward, "m", free) !== null,
      l: footprintFor(world, tile, forward, "l", free) !== null,
    };
    this.setPanelOpen(false);
    this.postcard.compose({
      mark: this.mark(this.me, world.id, new Date()),
      fits,
      onSend: async (draft) => {
        const media: MediaRef[] = [];
        for (const f of draft.files) media.push(await uploadMedia(f));
        const tiles = footprintFor(world, tile, forward, draft.size, free);
        if (!tiles) throw new Error("No room for that size here anymore");
        await this.request(
          "place",
          undefined,
          (b, isNew) => isNew && b.creator === this.me,
          () =>
            this.hooks.net.placeBox({
              size: draft.size,
              style: draft.style,
              card: draft.card,
              text: draft.text,
              media,
              announce: draft.announce,
              loc: world.id,
              tiles,
              fwd: vec(forward),
            }),
        );
      },
    });
  }

  private place(box: Box) {
    const spot = this.hooks.player();
    if (spot.moving) {
      this.toast("Stand still first");
      return;
    }
    const { world, tile } = spot;
    const forward = spot.forward.clone();
    const tiles = footprintFor(world, tile, forward, box.size, (k) => this.hooks.canPlaceOn(world, k));
    if (!tiles) {
      this.toast(`No room for an ${SIZE_NAME[box.size]} box here. Step somewhere more open.`);
      return;
    }
    this.request(
      "put",
      box.id,
      (b) => b.id === box.id && b.loc === world.id,
      () => this.hooks.net.putBox(box.id, world.id, tiles, vec(forward)),
    ).then(
      () => this.toast("Placed it here"),
      (e: Error) => this.toast(e.message),
    );
  }

  private relabel(box: Box) {
    const label = prompt("Label for this treasure:", box.label ?? "");
    if (label === null) return;
    this.hooks.net.labelBox(box.id, label.trim());
  }

  /** Send one request; settle on the matching `box` message or on the `box-deny` naming this `op`/`id`. */
  private request(op: BoxOp, id: number | undefined, matches: Pending["matches"], send: () => void): Promise<void> {
    if (this.pending) return Promise.reject(new Error("Still waiting for the planet…"));
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (this.pending?.timer !== timer) return;
        this.pending = null;
        reject(new Error("No answer from the planet. Try again."));
      }, REQUEST_TIMEOUT_MS);
      this.pending = { op, id, matches, resolve, reject, timer };
      send();
    });
  }

  // ---- reading ----------------------------------------------------------------

  private showRead(box: Box) {
    const role = box.creator === this.me ? "creator" : box.loc !== null ? "finder" : "owner";
    const base = this.mark(box.creator, box.origin, new Date(box.created));
    // whatever the sender typed on the card wins; empty fields keep the defaults
    const card = box.card;
    const mark: Postmark = card
      ? {
          stamp: card.stamp || base.stamp,
          from: card.from || base.from,
          to: card.to || base.to,
          place: card.place || base.place,
          date: base.date,
        }
      : base;
    const mine = box.creator === this.me;
    this.postcard.read({
      box,
      mark,
      role,
      openedBy: this.names[1 - box.creator],
      isOwner: box.owner === this.me,
      onKeep: (label) => this.hooks.net.keepBox(box.id, label || undefined),
      ...(mine && box.opened === null ? { onDelete: () => this.hooks.net.deleteBox(box.id) } : {}),
    });
  }

  /** The default dressing: the sender's character on the stamp, the world's name, the players' names. */
  private mark(from: PlayerId, loc: string, date: Date): Postmark {
    return {
      stamp: EMOJI[CHARACTER_OF[from]],
      from: this.names[from],
      to: this.names[1 - from],
      place: this.hooks.placeName(loc),
      date,
    };
  }

  private takeBack(box: Box) {
    if (!confirm(TAKE_BACK_CONFIRM)) return;
    this.hooks.net.deleteBox(box.id);
  }

  // ---- 3D ---------------------------------------------------------------------

  private mount(box: Box, lidAngle?: number) {
    if (box.loc === null || box.tiles.length === 0) return;
    const world = this.hooks.resolveWorld(box.loc);
    if (!world) return; // a room not created yet - mountWorld() catches up later
    if (!box.tiles.every((t) => world.hasTile(t))) {
      console.warn(`[treasures] box #${box.id} names tiles that don't exist in ${box.loc}; skipped`, box.tiles);
      return;
    }
    const group = this.assets[CHEST[box.size]].clone(true);
    const lid = node(group, "Lid");
    // stand at the footprint's center, front toward the player who left it
    const center = new Vector3();
    for (const t of box.tiles) center.add(world.tilePos(t, 0, _p));
    center.divideScalar(box.tiles.length);
    if (world.isGlobe) center.normalize().multiplyScalar(SURFACE - SINK[box.size]);
    else center.y = 0;
    group.position.copy(center);
    const up = world.up(center, new Vector3());
    tangentFrameQuat(up, new Vector3(-box.fwd[0], -box.fwd[1], -box.fwd[2]), group.quaternion);
    lid.rotation.x = lidAngle ?? (box.opened !== null ? LID_OPEN : 0);
    world.scene.add(group);
    world.setBlocked(box.tiles, true);
    this.mounted.set(box.id, { box, group, lid, world });
  }

  private unmount(id: number) {
    const m = this.mounted.get(id);
    if (!m) return;
    m.group.removeFromParent();
    m.world.setBlocked(m.box.tiles, false);
    this.mounted.delete(id);
  }

  // ---- panel ------------------------------------------------------------------

  private renderPanel() {
    const me = this.me;
    const all = [...this.boxes.values()].sort((a, b) => b.created - a.created);
    const waiting = all.filter((b) => b.loc !== null && b.creator !== me && b.opened === null && b.announce).length;
    if (waiting === 0) this.ui.waiting.textContent = "Nothing announced… but who knows 👀";
    else {
      const line = waiting === 1 ? "1 sealed box is waiting for you somewhere " : `${waiting} sealed boxes are waiting for you somewhere `;
      this.ui.waiting.replaceChildren(line, chestIcon());
    }
    this.ui.badge.hidden = waiting === 0;
    this.ui.badge.textContent = String(waiting);
    this.ui.mine.replaceChildren(...all.filter((b) => b.owner === me).map((b) => this.row(b, "mine")));
    this.ui.left.replaceChildren(...all.filter((b) => b.creator === me).map((b) => this.row(b, "left")));
  }

  private whereText(box: Box): string {
    if (box.loc === null) return box.owner === this.me ? "in your pocket" : `kept by ${this.names[box.owner ?? 0]}`;
    return box.loc === "globe" ? "on the planet" : `in ${this.hooks.placeName(box.loc)}`;
  }

  private row(box: Box, kind: "mine" | "left"): HTMLElement {
    const row = el("div", "tr-row");
    const thumb = el("div", "tr-thumb");
    const first = box.media?.[0];
    if (first) thumb.append(mediaElement(first, "row"));
    else thumb.append(chestIcon());

    const main = el("div");
    const title = el("div", "tr-title");
    if (box.label) title.textContent = box.label;
    else {
      title.textContent = kind === "mine" ? "no label yet" : `${SIZE_NAME[box.size]} box`;
      title.classList.add("faint");
    }
    const meta = el("div", "tr-meta");
    const facts =
      kind === "mine"
        ? [
            `from ${this.names[box.creator]}`,
            SIZE_NAME[box.size],
            `found ${fmtDate(box.opened ?? box.created)}`,
            this.whereText(box),
          ]
        : [SIZE_NAME[box.size], box.opened === null ? "sealed" : "opened", this.whereText(box)];
    // each fact stays on one line; the row wraps only between them
    facts.forEach((f, i) => {
      if (i > 0) meta.append(" · ");
      meta.append(el("span", undefined, f));
    });
    main.append(title, meta);

    const actions = el("div", "tr-actions");
    const button = (label: string, cls: string, onClick: () => void) => {
      const b = el("button", cls, label);
      b.type = "button";
      b.addEventListener("click", onClick);
      return b;
    };
    actions.append(button("Open", "tr-open", () => this.open(box)));
    if (kind === "mine") {
      actions.append(button("Label ✏️", "tr-label", () => this.relabel(box)));
      if (box.loc === null) actions.append(button("Place here", "tr-place", () => this.place(box)));
    } else if (box.opened === null) {
      actions.append(button("Take back", "tr-take", () => this.takeBack(box)));
    }
    row.append(thumb, main, actions);
    return row;
  }

  private toast(text: string) {
    this.ui.toast.textContent = text;
    this.ui.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.ui.toast.hidden = true;
    }, 3200);
  }
}
