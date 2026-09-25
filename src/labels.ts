import { Vector3, type PerspectiveCamera } from "three";
import type { Box, BoxSize } from "../shared/protocol.ts";
import type { World } from "./world.ts";

/**
 * Floating labels above every box that carries one: a small tag positioned on
 * screen like the name tags over the characters' heads (src/chat.ts). Hiding
 * while photo or placing mode is active is done in CSS (body.photo/.placing
 * hide #box-labels), the same way the name tags already hide for photo mode.
 */

/** A box standing somewhere, as mounted by Treasures. */
export type LabeledBox = { box: Box; pos: Vector3; world: World };

const MAX_DIST = 40; // farther than this, a tag is hidden rather than shrunk unreadable
const TAG_MARGIN = 0.35; // a little above the lid
// Chest heights (body + lid), in units, from assets/blender/treasure.py.
const CHEST_HEIGHT: Record<BoxSize, number> = { s: 0.8, m: 1.6, l: 2.4 };

const _anchor = new Vector3();
const _toAnchor = new Vector3();
const _camDir = new Vector3();
const _up = new Vector3();

/**
 * Where a box's label lands on screen, or null when it should stay hidden:
 * behind the camera, or farther than MAX_DIST units away. Anchored a little
 * above the chest's lid and projected exactly like chat.ts's `project`. The
 * viewport size is a parameter (rather than read from `window`) so this stays
 * a pure, unit-testable function.
 */
export function labelAnchor(
  camera: PerspectiveCamera,
  world: Pick<World, "up">,
  pos: Vector3,
  size: BoxSize,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } | null {
  world.up(pos, _up);
  _anchor.copy(pos).addScaledVector(_up, CHEST_HEIGHT[size] + TAG_MARGIN);
  _toAnchor.copy(_anchor).sub(camera.position);
  if (_toAnchor.dot(camera.getWorldDirection(_camDir)) <= 0) return null; // behind the camera
  if (camera.position.distanceTo(_anchor) > MAX_DIST) return null;
  _anchor.project(camera);
  return {
    x: (_anchor.x * 0.5 + 0.5) * viewportW,
    y: (-_anchor.y * 0.5 + 0.5) * viewportH,
  };
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
      const screen = labelAnchor(camera, world, entry.pos, entry.box.size, innerWidth, innerHeight);
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
