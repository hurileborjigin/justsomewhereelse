import { Vector3, type Group, type Object3D } from "three";
import {
  CHARACTER_OF,
  SURFACE,
  type Box,
  type BoxContents,
  type BoxDenyReason,
  type BoxOp,
  type BoxSize,
  type MediaRef,
  type Picture,
  type PlayerId,
  type Vec3,
} from "../shared/protocol.ts";
import { node, type AssetName, type Assets } from "./assets.ts";
import { EMOJI, mediaElement, uploadMedia } from "./chat.ts";
import { el, toast } from "./dom.ts";
import type { CameraFade, FadeState } from "./fade.ts";
import type { LabeledBox } from "./labels.ts";
import { tangentFrameQuat } from "./math.ts";
import type { Net } from "./net.ts";
import type { Placing } from "./placing.ts";
import { Postcard, TAKE_BACK_CONFIRM, chestIcon, type Draft, type Postmark } from "./postcard.ts";
import type { World } from "./world.ts";

const LID_OPEN = -1.75; // radians around the hinge (about 100 degrees); 0 = sealed
const LID_SPEED = 4; // rad/s
const REQUEST_TIMEOUT_MS = 15_000;
const LANDED_LATE = "Your box went down after all.";
const POCKETED = "On your back now: place it from Treasures.";
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

export type TreasureHooks = {
  /** The world the local player is in right now. */
  currentWorld(): World;
  /** The globe, or a room that has already been created; null otherwise. */
  resolveWorld(loc: string): World | null;
  /** "Haven" or "the crooked house": for postmarks and panel rows. */
  placeName(loc: string): string;
  /** Placing mode: where a new or kept box goes down. */
  placing: Pick<Placing, "start" | "active" | "finish">;
  /** A postcard dialog opened or closed (walking is muted while open). */
  onDialog(open: boolean): void;
  /** The treasures panel was opened (small screens tidy other panels). */
  onPanelOpen(): void;
  /** Photo mode: a JPEG of the world, or null when the sender came back without a shot. */
  takePicture(): Promise<Blob | null>;
  /** Ends photo mode without a shot, when the card it was taken for is closed or replaced from outside. */
  cancelPicture(): void;
  /** The camera fade: a chest between the camera and the character fades like a building. */
  fade: Pick<CameraFade, "track" | "untrack">;
  net: Pick<Net, "placeBox" | "openBox" | "keepBox" | "labelBox" | "putBox" | "deleteBox" | "editBox" | "liftBox">;
};

type Mounted = { box: Box; group: Group; lid: Object3D; world: World };
/**
 * One compose card, from "Leave it here" until it closes. A place request that
 * times out remembers the card that sent it, so its late box settles that card
 * and never whichever card is open by then.
 */
type Card = {
  /** While this card's box is being placed: ends placing mode and closes the card as if its confirm went through. */
  placing: (() => void) | null;
};
/** One compose dialog's uploads, by file: each file goes up once however often the box is sent. */
type Uploads = Map<Blob, Promise<MediaRef>>;
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
const SIZE_RANK: Record<BoxSize, number> = { s: 0, m: 1, l: 2 };
/** Who has a box in their pocket: its owner once kept, its creator while nobody has; null while it stands somewhere. */
const holderOf = (box: Box): PlayerId | null => (box.loc !== null ? null : (box.owner ?? box.creator));

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
  private reading: number | null = null; // box shown in the read view, redrawn or closed when it changes
  private pending: Pending | null = null; // a place / put waiting for its answer
  /** The card whose new box's request timed out unanswered: it may still land, so no second one goes out until it is settled. */
  private latePlace: Card | null = null;
  /** The compose card on screen, if any. */
  private card: Card | null = null;
  private ui: {
    openBtn: HTMLElement;
    badge: HTMLElement;
    panel: HTMLElement;
    waiting: HTMLElement;
    pocket: HTMLElement;
    carried: HTMLElement;
  };

  constructor(assets: Assets, hooks: TreasureHooks) {
    this.assets = assets;
    this.hooks = hooks;
    this.postcard = new Postcard((open) => {
      hooks.onDialog(open);
      if (!open) {
        this.reading = null;
        this.card = null;
      }
    });
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
      pocket: $("treasure-pocket"),
      carried: $("treasure-carried"),
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

  /** True while a new box's request that timed out is still unsettled (placing mode waits meanwhile). */
  get unanswered() {
    return this.latePlace !== null;
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
    const known = new Set(this.boxes.keys());
    for (const id of [...this.mounted.keys()]) this.unmount(id);
    this.boxes.clear();
    for (const b of boxes) {
      this.boxes.set(b.id, b);
      this.mount(b);
    }
    this.renderPanel();
    // a request sent before the line dropped: this snapshot shows whether it went through, or it was lost with the line
    const p = this.pending;
    if (p) {
      this.pending = null;
      clearTimeout(p.timer);
      const through = (p.op === "place" || p.op === "put") && boxes.some((b) => p.matches(b, !known.has(b.id)));
      if (through) p.resolve();
      else p.reject(new Error("The line to the planet dropped. Try again."));
    }
    if (this.latePlace) {
      if (boxes.some((b) => !known.has(b.id) && b.creator === this.me)) this.landedLate();
      else this.latePlace = null; // lost with the line: placing may try again
    }
  }

  /**
   * The box of a request that timed out landed after all. Its card is done: still
   * placing, placing ends as if it had been answered; back on screen after a
   * Cancel, it closes (nothing on it is left to send); gone already, only the
   * toast says so. Any other card open by then is left alone.
   */
  private landedLate() {
    const card = this.latePlace;
    if (!card) return;
    this.latePlace = null;
    if (card.placing) card.placing();
    else if (this.card === card && this.postcard.isOpen) {
      if (this.postcard.isAway) this.hooks.cancelPicture();
      this.postcard.dismiss();
    }
    this.toast(LANDED_LATE);
  }

  /** One box changed, or the server answered our own request. */
  apply(incoming: Box) {
    const prev = this.boxes.get(incoming.id);
    // never forget contents we were already allowed to see
    const box = prev?.contents !== undefined && incoming.contents === undefined ? { ...incoming, contents: prev.contents } : incoming;
    this.boxes.set(box.id, box);
    // re-mount, but let an already-standing lid keep its angle so update() swings it
    const lidNow = this.mounted.get(box.id)?.lid.rotation.x;
    const faded = this.unmount(box.id);
    this.mount(box, lidNow, faded);
    this.renderPanel();
    if (prev && holderOf(prev) !== this.me && holderOf(box) === this.me) this.toast(POCKETED);
    if (this.pending?.matches(box, !prev)) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.resolve();
    } else if (!prev && box.creator === this.me) {
      // nobody is waiting for this new box of ours: the answer to a request that timed out
      this.landedLate();
    }
    if (this.pendingOpen === box.id && box.contents !== undefined) {
      this.pendingOpen = null;
      this.showRead(box);
    }
    this.refreshReading(box);
  }

  /** The box on the reader's screen changed under them: redraw its buttons, or close it once it left their reach. */
  private refreshReading(box: Box) {
    if (this.reading !== box.id || !this.postcard.isOpen) return;
    // the card below the viewfinder is about to close or change: the viewfinder goes first
    if (this.postcard.isAway) this.hooks.cancelPicture();
    const mine = box.creator === this.me;
    if (!mine && box.loc === null && box.owner !== this.me) {
      this.postcard.close();
      this.toast(`${this.names[box.creator]} picked that box up.`);
      return;
    }
    if (box.contents !== undefined) this.showRead(box);
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
    if (msg.op === "place") this.latePlace = null; // the late answer to a new box: refused, so placing may try again
    this.toast(DENY_TEXT[msg.reason]);
  }

  /** A sealed box was taken back by its creator: gone from the world and from every list. */
  remove(id: number) {
    this.unmount(id);
    this.boxes.delete(id);
    if (this.pendingOpen === id) this.pendingOpen = null;
    if (this.reading === id && this.postcard.isOpen) {
      if (this.postcard.isAway) this.hooks.cancelPicture();
      this.postcard.close();
      this.toast("That box was taken back.");
    }
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
    if (current.contents !== undefined) {
      this.showRead(current);
      return;
    }
    this.pendingOpen = current.id;
    this.hooks.net.openBox(current.id);
  }

  list(): Box[] {
    return [...this.boxes.values()];
  }

  /** The largest box `player` has in their pocket, carried on their back; null with empty pockets. */
  carrying(player: PlayerId): BoxSize | null {
    let size: BoxSize | null = null;
    for (const b of this.boxes.values()) {
      if (holderOf(b) === player && (size === null || SIZE_RANK[b.size] > SIZE_RANK[size])) size = b.size;
    }
    return size;
  }

  /** Every box standing somewhere right now, for the floating labels (src/labels.ts). */
  mountedBoxes(): LabeledBox[] {
    // a chest faded out of the camera's way hides its label too
    return [...this.mounted.values()].map((m) => ({ box: m.box, pos: m.group.position, world: m.world, visible: m.group.visible }));
  }

  // ---- placing ----------------------------------------------------------------

  /** Walking is allowed while framing a shot; the dialog is muted again afterwards. */
  private async photo(): Promise<Blob | null> {
    this.hooks.onDialog(false);
    try {
      return await this.hooks.takePicture();
    } finally {
      // a cancelled shot may come back to a card that was closed meanwhile
      this.hooks.onDialog(this.postcard.isOpen);
    }
  }

  private compose() {
    if (this.postcard.isOpen || this.hooks.placing.active) return;
    this.setPanelOpen(false);
    // every file is uploaded once for the life of the card: a refused or cancelled placement
    // tried again sends the same prints; only a new picture or print uploads anew
    const uploads: Uploads = new Map();
    const card: Card = { placing: null };
    this.postcard.compose({
      mark: this.mark(this.me, this.hooks.currentWorld().id, new Date()),
      takePicture: () => this.photo(),
      // the card steps aside and the shade decides where the box goes; Cancel brings the card back
      onSend: (draft) =>
        new Promise<boolean>((resolve) => {
          this.postcard.setAway(true);
          const placed = () => {
            card.placing = null;
            resolve(true);
          };
          card.placing = () => {
            this.hooks.placing.finish();
            placed();
          };
          this.hooks.placing.start({
            size: null,
            onConfirm: async (tiles, size, world, forward) => {
              const contents = await this.contentsOf(draft, uploads);
              await this.request(
                "place",
                undefined,
                (b, isNew) => isNew && b.creator === this.me,
                () => this.hooks.net.placeBox({ size, contents, announce: draft.announce, loc: world.id, tiles, fwd: vec(forward) }),
                card,
              );
              placed();
            },
            onCancel: () => {
              card.placing = null;
              this.postcard.setAway(false);
              resolve(false);
            },
          });
        }),
    });
    this.card = card;
  }

  /** What the box will hold: the kept files plus everything new uploaded (each file once, through `uploads`), shaped for the style. */
  private async contentsOf(draft: Draft, uploads: Uploads): Promise<BoxContents> {
    const upload = (file: Blob) => {
      let sent = uploads.get(file);
      if (!sent) {
        sent = uploadMedia(file);
        uploads.set(file, sent);
        sent.catch(() => uploads.delete(file)); // a failed upload is tried again next time
      }
      return sent;
    };
    if (draft.style === "postcard") {
      const p = draft.picture;
      const picture: Picture | null = p
        ? { image: p.source instanceof Blob ? await upload(p.source) : p.source, focus: p.focus, zoom: p.zoom, caption: p.caption }
        : null;
      return { style: "postcard", picture, writing: { text: draft.text, ...draft.dressing } };
    }
    const media: MediaRef[] = [...draft.keep];
    for (const f of draft.files) media.push(await upload(f));
    return draft.style === "note" ? { style: "note", text: draft.text, media } : { style: "media", caption: draft.text, media };
  }

  /** Change a sealed box you left: the same dialog, prefilled; it stays where it stands. */
  private edit(box: Box) {
    if (this.postcard.isOpen) this.postcard.close();
    if (this.postcard.isOpen) return; // the reader kept the dialog (a send in flight)
    const contents = box.contents;
    if (!contents) return;
    this.setPanelOpen(false);
    const uploads: Uploads = new Map(); // a save refused or unanswered and tried again sends the same prints
    this.postcard.compose({
      mark: this.mark(box.creator, box.origin, new Date(box.created)),
      initial: { contents, announce: box.announce },
      takePicture: () => this.photo(),
      onSend: async (draft) => {
        const contents = await this.contentsOf(draft, uploads);
        // only a still-sealed, still-unkept update is the answer to a save; an opened
        // box arriving first means the partner beat the edit and the refusal follows
        await this.request(
          "edit",
          box.id,
          (b) => b.id === box.id && b.opened === null && b.owner === null,
          () => this.hooks.net.editBox(box.id, contents, draft.announce),
        );
        return true;
      },
    });
  }

  /** Pick your own box up to move it; "Place here" puts it down again. */
  private lift(box: Box) {
    this.hooks.net.liftBox(box.id);
  }

  /** "Place here" for a kept or lifted box: placing mode with its size; the panel steps aside meanwhile. */
  private place(box: Box) {
    if (this.hooks.placing.active) return;
    this.hooks.placing.start({
      size: null,
      fixedSize: box.size,
      onConfirm: async (tiles, _size, world, forward) => {
        await this.request(
          "put",
          box.id,
          (b) => b.id === box.id && b.loc === world.id,
          () => this.hooks.net.putBox(box.id, world.id, tiles, vec(forward)),
        );
        this.setPanelOpen(false);
        this.toast("Placed it here");
      },
      onCancel: () => {},
    });
  }

  private saveLabel(box: Box, label: string) {
    this.hooks.net.labelBox(box.id, label);
    this.toast(label ? "Label saved" : "Label taken off");
  }

  private relabel(box: Box) {
    const label = prompt("Label for this treasure:", box.label ?? "");
    if (label === null) return;
    this.hooks.net.labelBox(box.id, label.trim());
  }

  /**
   * Send one request; settle on the matching `box` message or on the `box-deny` naming this `op`/`id`.
   * A place names the `card` that sent it, for a late answer to find.
   */
  private request(op: BoxOp, id: number | undefined, matches: Pending["matches"], send: () => void, card?: Card): Promise<void> {
    if (this.pending) return Promise.reject(new Error("Still waiting for the planet…"));
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (this.pending?.timer !== timer) return;
        this.pending = null;
        if (op === "place" && card) {
          // it may still land: until it does (or is refused, or the line drops), no second box goes out
          this.latePlace = card;
          reject(new Error("No answer from the planet yet…"));
        } else reject(new Error("No answer from the planet. Try again."));
      }, REQUEST_TIMEOUT_MS);
      this.pending = { op, id, matches, resolve, reject, timer };
      send();
    });
  }

  // ---- reading ----------------------------------------------------------------

  private showRead(box: Box) {
    const contents = box.contents;
    if (!contents) return;
    this.reading = box.id;
    const role = box.creator === this.me ? "creator" : box.loc !== null ? "finder" : "owner";
    const base = this.mark(box.creator, box.origin, new Date(box.created));
    // whatever the sender typed on the card wins; empty fields keep the defaults
    const card = contents.style === "postcard" ? contents.writing : null;
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
    const sealed = box.opened === null;
    const unkept = box.owner === null;
    this.postcard.read({
      box: { ...box, contents },
      mark,
      role,
      openedBy: this.names[1 - box.creator],
      isOwner: box.owner === this.me,
      onKeep: (label) => this.hooks.net.keepBox(box.id, label || undefined),
      ...(box.owner === this.me ? { onLabel: (label: string) => this.saveLabel(box, label) } : {}),
      ...(mine && sealed ? { onDelete: () => this.hooks.net.deleteBox(box.id), onEdit: () => this.edit(box) } : {}),
      ...(mine && unkept && box.loc !== null ? { onLift: () => this.lift(box) } : {}),
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

  private mount(box: Box, lidAngle?: number, faded?: FadeState) {
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
    else center.y = Math.max(0, ...box.tiles.map((t) => world.floorHeight(t))); // on top of a gallery bay's plinth
    group.position.copy(center);
    const up = world.up(center, new Vector3());
    tangentFrameQuat(up, new Vector3(-box.fwd[0], -box.fwd[1], -box.fwd[2]), group.quaternion);
    lid.rotation.x = lidAngle ?? (box.opened !== null ? LID_OPEN : 0);
    group.userData.box = box.id;
    world.scene.add(group);
    this.hooks.fade.track(group, faded);
    world.setBlocked(box.tiles, true);
    this.mounted.set(box.id, { box, group, lid, world });
  }

  /** Takes a chest out of its world; returns how faded it was, for a re-mount to carry over. */
  private unmount(id: number): FadeState | undefined {
    const m = this.mounted.get(id);
    if (!m) return undefined;
    const faded = this.hooks.fade.untrack(m.group);
    m.group.removeFromParent();
    m.world.setBlocked(m.box.tiles, false);
    this.mounted.delete(id);
    return faded;
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
    // boxes that stand somewhere are found and read where they stand; only the ones on your back are listed
    const carried = all.filter((b) => holderOf(b) === me);
    this.ui.carried.replaceChildren(...carried.map((b) => this.row(b)));
    this.ui.pocket.hidden = carried.length === 0;
  }

  /** A box in your pocket: one you kept, or your own one you picked up to move. */
  private row(box: Box): HTMLElement {
    const kept = box.owner === this.me;
    const row = el("div", "tr-row");
    const thumb = el("div", "tr-thumb");
    const c = box.contents;
    const first = c === undefined ? undefined : c.style === "postcard" ? c.picture?.image : c.media[0];
    if (first) thumb.append(mediaElement(first, "row"));
    else thumb.append(chestIcon());

    const main = el("div");
    const title = el("div", "tr-title");
    if (box.label) title.textContent = box.label;
    else {
      title.textContent = kept ? "no label yet" : `${SIZE_NAME[box.size]} box`;
      title.classList.add("faint");
    }
    const meta = el("div", "tr-meta");
    const facts = kept
      ? [`from ${this.names[box.creator]}`, SIZE_NAME[box.size], `found ${fmtDate(box.opened ?? box.created)}`]
      : [SIZE_NAME[box.size], box.opened === null ? "sealed" : "opened"];
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
    actions.append(button("Place here", "tr-place", () => this.place(box)), button("Open", "tr-open", () => this.open(box)));
    if (kept) actions.append(button("Label ✏️", "tr-label", () => this.relabel(box)));
    else {
      // your own box, lifted to move it: change it or take it back while it is still sealed
      if (box.opened === null) actions.append(button("Edit", "tr-edit", () => this.edit(box)));
      if (box.opened === null) actions.append(button("Take back", "tr-take", () => this.takeBack(box)));
    }
    row.append(thumb, main, actions);
    return row;
  }

  private toast(text: string) {
    toast(text);
  }
}
