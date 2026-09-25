import { Vector3, type Object3D, type PerspectiveCamera } from "three";
import type { Box, BoxSize } from "../shared/protocol.ts";
import type { World } from "./world.ts";

/**
 * Floating labels above every box that carries one: a small tag positioned on
 * screen like the name tags over the characters' heads (src/chat.ts). Hiding
 * while photo or placing mode is active is done in CSS (body.photo/.placing
 * hide #box-labels), the same way the name tags already hide for photo mode.
 */

/**
 * A box standing somewhere, as mounted by Treasures: its chest's `Lid` node
 * (the label rides above the lid's edge once it swings up), and whether the
 * chest is drawn at all (faded out of the camera's way, it is not).
 */
export type LabeledBox = { box: Box; pos: Vector3; world: World; lid?: Object3D; visible?: boolean };

const MAX_DIST = 40; // farther than this, a tag is hidden rather than shrunk unreadable
const TAG_MARGIN = 0.35; // a little above the lid
const TOP_EDGE = 72; // px: a tag pinned near the top of the screen shows whole, below the corner buttons
// Chest heights (body + lid) and depths, in units, from assets/blender/treasure.py.
const CHEST_HEIGHT: Record<BoxSize, number> = { s: 0.8, m: 1.6, l: 2.4 };
const CHEST_DEPTH: Record<BoxSize, number> = { s: 0.9, m: 3.0, l: 7.0 };

const _anchor = new Vector3();
const _toAnchor = new Vector3();
const _camDir = new Vector3();
const _up = new Vector3();
const _tip = new Vector3();
const _lift = new Vector3();

/**
 * The world position of a lid's front edge: in the lid's own frame (its origin
 * on the hinge at the back of the body) the lid reaches `depth` along +Z to the
 * front. Sealed, that edge is the front of the chest's top; open, it is the top
 * of the upright lid, far above the body on a deep chest.
 */
export function lidTip(lid: Object3D, size: BoxSize, out: Vector3): Vector3 {
  lid.updateWorldMatrix(true, false);
  return lid.localToWorld(out.set(0, 0, CHEST_DEPTH[size]));
}

/** A point projected to the screen, or null behind the camera or past MAX_DIST. */
function toScreen(p: Vector3, camera: PerspectiveCamera, w: number, h: number): { x: number; y: number } | null {
  _toAnchor.copy(p).sub(camera.position);
  if (_toAnchor.dot(camera.getWorldDirection(_camDir)) <= 0) return null; // behind the camera
  if (camera.position.distanceTo(p) > MAX_DIST) return null;
  p.project(camera);
  return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
}

/**
 * Where a box's label lands on screen, or null when it should stay hidden:
 * behind the camera, or farther than MAX_DIST units away. Anchored a little
 * above the chest's lid, or above `tip` (the lid's front edge) whenever that
 * rises higher: an open lid stands up tall behind the chest, and the tag sits
 * on top of it. Up close that top leaves the screen while the chest is still
 * in view; the tag then stops at the top edge, on the line from the chest up
 * to the lid, instead of vanishing. Projected exactly like chat.ts's
 * `project`. The viewport size is a parameter (rather than read from
 * `window`) so this stays a pure, unit-testable function.
 */
export function labelAnchor(
  camera: PerspectiveCamera,
  world: Pick<World, "up">,
  pos: Vector3,
  size: BoxSize,
  viewportW: number,
  viewportH: number,
  tip?: Vector3,
): { x: number; y: number } | null {
  world.up(pos, _up);
  _anchor.copy(pos).addScaledVector(_up, CHEST_HEIGHT[size] + TAG_MARGIN);
  if (!tip || _lift.subVectors(tip, pos).dot(_up) <= CHEST_HEIGHT[size]) {
    return toScreen(_anchor, camera, viewportW, viewportH);
  }
  const chest = toScreen(_anchor, camera, viewportW, viewportH);
  const lid = toScreen(_anchor.copy(tip).addScaledVector(_up, TAG_MARGIN), camera, viewportW, viewportH);
  if (!lid || !chest || lid.y >= TOP_EDGE || chest.y <= TOP_EDGE) return lid ?? chest;
  const t = (chest.y - TOP_EDGE) / (chest.y - lid.y);
  return { x: chest.x + (lid.x - chest.x) * t, y: TOP_EDGE };
}

type Mounted = { el: HTMLDivElement; text: HTMLSpanElement };

/** One `.box-label` element per labelled box mounted in the current world, reused frame to frame. */
export class BoxLabels {
  private container: HTMLElement;
  private byId = new Map<number, Mounted>();

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** Called every frame after the camera update. */
  update(camera: PerspectiveCamera, world: World, boxes: Iterable<LabeledBox>) {
    const seen = new Set<number>();
    for (const entry of boxes) {
      if (!entry.box.label || entry.world !== world) continue;
      seen.add(entry.box.id);
      let m = this.byId.get(entry.box.id);
      if (!m) {
        const el = document.createElement("div");
        el.className = "box-label";
        const text = document.createElement("span");
        el.append(text);
        el.style.opacity = "0";
        this.container.append(el);
        m = { el, text };
        this.byId.set(entry.box.id, m);
      }
      if (m.text.textContent !== entry.box.label) m.text.textContent = entry.box.label; // textContent escapes
      const tip = entry.lid ? lidTip(entry.lid, entry.box.size, _tip) : undefined;
      const screen = entry.visible === false ? null : labelAnchor(camera, world, entry.pos, entry.box.size, innerWidth, innerHeight, tip);
      if (screen) {
        m.el.style.opacity = "1";
        m.el.style.left = `${screen.x}px`;
        m.el.style.top = `${screen.y}px`;
      } else {
        m.el.style.opacity = "0";
      }
    }
    // a box that left the current world (or lost its label) frees its element
    for (const [id, m] of this.byId) {
      if (seen.has(id)) continue;
      m.el.remove();
      this.byId.delete(id);
    }
  }
}
