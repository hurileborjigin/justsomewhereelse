import { Vector3, type PerspectiveCamera } from "three";
import type { Box, BoxSize } from "../shared/protocol.ts";
import type { World } from "./world.ts";

/**
 * Floating labels above every box that carries one: a small tag positioned on
 * screen like the name tags over the characters' heads (src/chat.ts). Hiding
 * while photo or placing mode is active is done in CSS (body.photo/.placing
 * hide #box-labels), the same way the name tags already hide for photo mode.
 */

/**
 * A box standing somewhere, as mounted by Treasures: `pos` is the chest's own
 * origin (the middle of its base, already sunk into the globe), and whether
 * the chest is drawn at all (faded out of the camera's way, it is not).
 */
export type LabeledBox = { box: Box; pos: Vector3; world: World; visible?: boolean };

/** Where a tag lands on screen, and how far its anchor is from the camera. */
export type LabelSpot = { x: number; y: number; dist: number };

const TAG_MARGIN = 0.35; // a little above the chest
// Chest heights (body + sealed lid), in units, from assets/blender/treasure.py.
// The tag keeps to the chest whether the lid is open or not: an open L lid
// stands several units up behind the chest, and a tag up there reads as
// belonging to whatever is behind it.
const CHEST_HEIGHT: Record<BoxSize, number> = { s: 0.8, m: 1.6, l: 2.4 };
// Far tags recede a little so the near ones read first where they crowd:
// full size and strength up to FAR_FROM units, easing down to FAR_SCALE and
// FAR_OPACITY at the world's label range.
const FAR_FROM = 40; // the globe's and ordinary rooms' whole range: tags recede only in a treasure hall
const FAR_SCALE = 0.8;
const FAR_OPACITY = 0.75;

const _anchor = new Vector3();
const _toAnchor = new Vector3();
const _camDir = new Vector3();
const _up = new Vector3();

/**
 * Where a box's label lands on screen, or null when it should stay hidden:
 * behind the camera, or farther than the world's `labelRange`. Anchored a
 * little above the sealed chest's top, measured from the chest's own origin
 * (on the globe that origin already sits SINK below the tile tops, so the tag
 * follows the chest down). Projected exactly like chat.ts's `project`. The
 * viewport size is a parameter (rather than read from `window`) so this stays
 * a pure, unit-testable function.
 */
export function labelAnchor(
  camera: PerspectiveCamera,
  world: Pick<World, "up" | "labelRange">,
  pos: Vector3,
  size: BoxSize,
  viewportW: number,
  viewportH: number,
): LabelSpot | null {
  world.up(pos, _up);
  _anchor.copy(pos).addScaledVector(_up, CHEST_HEIGHT[size] + TAG_MARGIN);
  _toAnchor.copy(_anchor).sub(camera.position);
  if (_toAnchor.dot(camera.getWorldDirection(_camDir)) <= 0) return null; // behind the camera
  const dist = _toAnchor.length();
  if (dist > world.labelRange) return null; // farther than this, a tag is hidden rather than shrunk unreadable
  _anchor.project(camera);
  return { x: (_anchor.x * 0.5 + 0.5) * viewportW, y: (-_anchor.y * 0.5 + 0.5) * viewportH, dist };
}

/** How far a tag at `dist` has receded: 0 up to FAR_FROM units, 1 at the world's label range. */
export function farness(dist: number, range: number): number {
  if (range <= FAR_FROM) return 0;
  return Math.min(1, Math.max(0, (dist - FAR_FROM) / (range - FAR_FROM)));
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
      const screen = entry.visible === false ? null : labelAnchor(camera, world, entry.pos, entry.box.size, innerWidth, innerHeight);
      if (screen) {
        const far = farness(screen.dist, world.labelRange);
        m.el.style.opacity = (1 - far * (1 - FAR_OPACITY)).toFixed(2);
        m.el.style.left = `${screen.x}px`;
        m.el.style.top = `${screen.y}px`;
        m.el.style.transform = `translate(-50%, -100%) scale(${(1 - far * (1 - FAR_SCALE)).toFixed(3)})`;
        m.el.style.zIndex = String(Math.round(1000 - screen.dist)); // nearer tags draw over farther ones
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
