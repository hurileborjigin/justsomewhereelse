// Placing mode: a translucent footprint on the ground in front of the player
// shows where a box would stand, green where it may and red where it may not.
// It follows the player's tile and facing as they walk; "Put it down" hands
// the tiles to the caller, "Cancel" (or Escape) steps back out.
import { BufferAttribute, BufferGeometry, DoubleSide, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial, Vector3 } from "three";
import type { BoxSize } from "../shared/protocol.ts";
import { el, toast } from "./dom.ts";
import { footprintCheck, footprintTiles } from "./footprint.ts";
import type { World } from "./world.ts";

const SIZES: BoxSize[] = ["s", "m", "l"];
const MAX_TILES = 12; // an L box
/** How far the shade floats above the tile top; the polygon offset below keeps it clear of the depth buffer's rounding. */
const LIFT = 0.03;
/** How far each shade tile stops short of its tile's edges: the gaps show the grid, and on a bay it stays on the plinth top. */
const INSET = 0.16;

export type PlacingHooks = {
  /** Where the local player stands and faces right now. */
  player(): { world: World; tile: number; forward: Vector3 };
  /** Per-tile placement rule for `world`: terrain, doors, spawns, the partner. */
  canPlaceOn(world: World, tile: number): boolean;
  /** Placing mode began or ended (main tidies the sign and unmutes walking). */
  onActive(active: boolean): void;
};

export type PlacingOptions = {
  /** The size picked at the start for a new box; null picks S. */
  size: BoxSize | null;
  /** A kept or lifted box: its size, and no size buttons. */
  fixedSize?: BoxSize;
  /** Put the box down; resolve once it stands, reject with a message to toast (placing mode stays). */
  onConfirm(tiles: number[], size: BoxSize, world: World, forward: Vector3): Promise<void>;
  /** The player stepped back out without placing. */
  onCancel(): void;
};

const _p = new Vector3();
const _up = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _left = new Vector3();
const _center = new Vector3();
const _in = new Vector3();
const _corners = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];

export class Placing {
  private hooks: PlacingHooks;
  private opts: PlacingOptions | null = null;
  private size: BoxSize = "s";
  private busy = false;
  /** What the footprint was computed for: world, tile, facing, size. */
  private key = "";
  private world: World | null = null;
  private forward = new Vector3();
  private tiles: number[] = [];
  private ok: boolean[] = [];
  private meshes: Mesh[] = [];
  private green: MeshBasicMaterial;
  private red: MeshBasicMaterial;
  private rim: LineBasicMaterial;
  private ui: { root: HTMLElement; sizes: HTMLElement; sizeBtns: HTMLButtonElement[]; put: HTMLButtonElement; cancel: HTMLButtonElement };

  constructor(hooks: PlacingHooks) {
    this.hooks = hooks;
    const $ = (id: string) => {
      const e = document.getElementById(id);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    const sizes = $("pl-sizes");
    this.ui = {
      root: $("placing"),
      sizes,
      sizeBtns: [...sizes.querySelectorAll<HTMLButtonElement>("button[data-size]")],
      put: $("pl-put") as HTMLButtonElement,
      cancel: $("pl-cancel") as HTMLButtonElement,
    };
    for (const b of this.ui.sizeBtns) {
      b.addEventListener("click", () => {
        b.blur();
        this.pick(b.dataset.size as BoxSize);
      });
    }
    this.ui.put.addEventListener("click", () => {
      this.ui.put.blur();
      void this.confirm();
    });
    this.ui.cancel.addEventListener("click", () => {
      this.ui.cancel.blur();
      if (!this.busy) this.cancel();
    });

    const shade = (color: string, opacity: number) =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        toneMapped: false, // the exact green and red, not the scene's tone-mapped ones
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      });
    this.green = shade("#58b368", 0.45);
    this.red = shade("#e05a5a", 0.6); // a touch stronger: over dirt or a tree's shadow 45% reads brown, not red
    this.rim = new LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false });
    for (let n = 0; n < MAX_TILES; n++) {
      const corners = new BufferAttribute(new Float32Array(12), 3);
      const geo = new BufferGeometry();
      geo.setAttribute("position", corners);
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const mesh = new Mesh(geo, this.green);
      mesh.renderOrder = 1; // after the tile tops and plinths it lies on
      // a pale rim on the same corners: the green alone is close to the grass it lies on
      const rimGeo = new BufferGeometry();
      rimGeo.setAttribute("position", corners);
      const rim = new LineLoop(rimGeo, this.rim);
      rim.renderOrder = 1;
      rim.frustumCulled = false; // shares the quad's corners; the quad's bounds decide
      mesh.add(rim);
      this.meshes.push(mesh);
    }
  }

  get active() {
    return this.opts !== null;
  }

  start(opts: PlacingOptions) {
    if (this.opts) return;
    this.opts = opts;
    this.size = opts.fixedSize ?? opts.size ?? "s";
    this.busy = false;
    this.key = "";
    this.tiles = [];
    this.ok = [];
    this.ui.sizes.hidden = opts.fixedSize !== undefined;
    this.ui.root.hidden = false;
    document.body.classList.add("placing");
    addEventListener("keydown", this.onKey, true);
    this.hooks.onActive(true);
    this.update();
  }

  /** Leaves placing mode without placing (Cancel, Escape, or from outside). */
  cancel() {
    const o = this.opts;
    if (!o) return;
    this.end();
    o.onCancel();
  }

  /** Every frame: the footprint follows the player; the green and red follow what stands there. */
  update() {
    const o = this.opts;
    if (!o) return;
    const { world, tile, forward } = this.hooks.player();
    // footprintTiles walks from the neighbors ahead, to the right and to the left:
    // those three decide the footprint, so they stand for the facing
    world.up(world.tilePos(tile, 0, _p), _up);
    _fwd.copy(forward).addScaledVector(_up, -forward.dot(_up));
    if (_fwd.lengthSq() > 1e-8) {
      _fwd.normalize();
      _right.crossVectors(_fwd, _up);
      _left.copy(_right).negate();
      const ahead = world.neighborInDirection(tile, _fwd);
      const key = `${world.id}|${tile}|${ahead}|${world.neighborInDirection(tile, _right)}|${world.neighborInDirection(tile, _left)}|${this.size}`;
      if (key !== this.key) {
        this.key = key;
        this.recompute(world, tile, ahead, _fwd);
      }
    }
    // re-checked every frame: the partner stepping in, or a box landing, turns tiles red where they are
    if (!this.world) return;
    const w = this.world;
    const ok = footprintCheck(w, this.tiles, this.size, (k) => this.hooks.canPlaceOn(w, k));
    if (ok.some((v, n) => v !== this.ok[n])) {
      this.ok = ok;
      ok.forEach((v, n) => (this.meshes[n].material = v ? this.green : this.red));
      this.renderButtons();
    }
  }

  /** For the scripted drives: what the shade shows right now. */
  debug() {
    return { active: this.active, size: this.size, tiles: [...this.tiles], ok: [...this.ok] };
  }

  private recompute(world: World, tile: number, ahead: number, fwd: Vector3) {
    this.world = world;
    // the chest faces along its footprint, not wherever between two tiles the player happens to look
    if (ahead >= 0) world.dirBetween(tile, ahead, this.forward);
    else this.forward.copy(fwd);
    const formed = Object.fromEntries(SIZES.map((s) => [s, footprintTiles(world, tile, fwd, s)])) as Record<BoxSize, number[] | null>;
    for (const b of this.ui.sizeBtns) b.disabled = formed[b.dataset.size as BoxSize] === null;
    this.tiles = formed[this.size] ?? [];
    this.ok = []; // update() colors the new tiles right after
    this.meshes.forEach((mesh, n) => {
      const k = this.tiles[n];
      if (k === undefined) {
        mesh.removeFromParent();
        return;
      }
      this.shapeTile(mesh, world, k);
      if (mesh.parent !== world.scene) world.scene.add(mesh);
    });
    this.renderButtons();
  }

  /** One shade tile: the tile's top, pulled in from its edges and lifted a hair along the ground's up. */
  private shapeTile(mesh: Mesh, world: World, k: number) {
    const corners = world.tileCorners(k, _corners);
    _center.set(0, 0, 0);
    for (const c of corners) _center.add(c);
    _center.divideScalar(4);
    world.up(_center, _up);
    const pos = mesh.geometry.getAttribute("position") as BufferAttribute;
    corners.forEach((c, n) => {
      // along the diagonal: INSET from both edges of a square corner
      _in.subVectors(_center, c).normalize().multiplyScalar(INSET * Math.SQRT2);
      pos.setXYZ(n, c.x + _in.x + _up.x * LIFT, c.y + _in.y + _up.y * LIFT, c.z + _in.z + _up.z * LIFT);
    });
    pos.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  }

  private renderButtons() {
    const ready = this.tiles.length > 0 && this.ok.every(Boolean);
    this.ui.put.disabled = this.busy || !ready;
    this.ui.cancel.disabled = this.busy;
    for (const b of this.ui.sizeBtns) b.classList.toggle("picked", b.dataset.size === this.size);
  }

  private pick(size: BoxSize) {
    if (!this.opts || this.opts.fixedSize || this.busy || size === this.size) return;
    this.size = size;
    this.key = "";
    this.update();
  }

  private async confirm() {
    const o = this.opts;
    const world = this.world;
    if (!o || !world || this.busy || this.tiles.length === 0 || !this.ok.every(Boolean)) return;
    this.busy = true;
    this.renderButtons();
    this.ui.put.replaceChildren("⏳ putting it down…");
    try {
      await o.onConfirm([...this.tiles], this.size, world, this.forward.clone());
      if (this.opts === o) this.end();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      this.busy = false;
      this.ui.put.replaceChildren("Put it down", el("span", "key-hint", " (E)"));
      this.renderButtons();
    }
  }

  private end() {
    this.opts = null;
    this.world = null;
    this.tiles = [];
    this.ok = [];
    this.key = "";
    for (const m of this.meshes) m.removeFromParent();
    this.ui.root.hidden = true;
    document.body.classList.remove("placing");
    removeEventListener("keydown", this.onKey, true);
    this.hooks.onActive(false);
  }

  /** Captured before the game's own keys: E confirms (never a door behind the bar), Escape cancels. */
  private onKey = (e: KeyboardEvent) => {
    if (e.code === "KeyE") {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (!e.repeat) void this.confirm();
    } else if (e.code === "Escape") {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (!this.busy) this.cancel();
    }
  };
}

