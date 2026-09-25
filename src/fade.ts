import { Box3, Matrix4, Mesh, Ray, Vector3, type Material, type Object3D, type PerspectiveCamera, type Scene } from "three";
import { dampFactor } from "./math.ts";

const FADED = 0.35; // a building or chest between the camera and the character: its silhouette still reads
const INSIDE_MARGIN = 0.4; // the camera this close to an object's box counts as inside it
// A blocking object bigger on screen than OUT (in screen heights squared, so
// a phone and a desktop agree) fades out completely; it stays out until it
// shrinks below BACK, so one hovering near the edge does not flicker.
const OUT = 0.5;
const BACK = 0.4;
const EASE = 10; // how quickly an object fades out and back in (see dampFactor)

/** How faded an object is: carried over when a chest is re-mounted, so a faded one never flashes solid. */
export type FadeState = { opacity: number; out: boolean };

type Faded = FadeState & {
  obj: Object3D;
  inverse: Matrix4; // world -> the object's own frame
  box: Box3; // the object's bounds in its own frame: tight, however it leans on the globe
  around: Box3; // those bounds grown by INSIDE_MARGIN: a camera in here is inside the object
  materials: { m: Material; transparent: boolean; depthWrite: boolean; opacity: number }[]; // and how each looks solid
};

const _ray = new Ray();
const _local = new Ray();
const _hit = new Vector3();
const _m = new Matrix4();
const _corner = new Vector3();

/**
 * How big a building looks: the area of the rectangle around its box on
 * screen, in screen heights squared (cropped at the top and bottom edges
 * only, since the narrow phone screen crops most buildings at the sides).
 * A box reaching behind the camera is as big as can be.
 */
function screenSize(item: Faded, camera: PerspectiveCamera): number {
  const { min, max } = item.box;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    _corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(item.obj.matrixWorld);
    _corner.applyMatrix4(camera.matrixWorldInverse);
    if (_corner.z > -camera.near) return Infinity;
    _corner.applyMatrix4(camera.projectionMatrix);
    x0 = Math.min(x0, _corner.x);
    y0 = Math.min(y0, _corner.y);
    x1 = Math.max(x1, _corner.x);
    y1 = Math.max(y1, _corner.y);
  }
  const w = ((x1 - x0) / 2) * camera.aspect;
  const h = Math.max(0, Math.min(y1, 1) - Math.max(y0, -1)) / 2;
  return w * h;
}

/**
 * Fades any globe building or treasure chest standing between the camera and
 * the character, so a tall house behind a player who just stepped out of it,
 * any wall the camera swings behind, or a chest right in front of the camera
 * never hides them. Each object gets its own copies of its materials, so
 * fading one never fades its siblings (every chest of a size shares one
 * model's materials).
 */
export class CameraFade {
  private items = new Map<Object3D, Faded>();

  /** Every object the scatter tagged with `userData.building`; chests come and go through track(). */
  constructor(scene: Scene) {
    scene.updateMatrixWorld(true);
    for (const obj of scene.children) if (obj.userData.building) this.track(obj);
  }

  /** Fades `obj` (already in its scene, standing still from now on) when it hides the character; `from` carries a faded state over. */
  track(obj: Object3D, from?: FadeState) {
    obj.updateMatrixWorld(true);
    const inverse = obj.matrixWorld.clone().invert();
    const box = new Box3();
    const materials: Faded["materials"] = [];
    obj.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      o.material = Array.isArray(o.material) ? o.material.map((m: Material) => m.clone()) : o.material.clone();
      for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as Material[]) {
        materials.push({ m, transparent: m.transparent, depthWrite: m.depthWrite, opacity: m.opacity });
      }
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox!.clone().applyMatrix4(_m.multiplyMatrices(inverse, o.matrixWorld)));
    });
    if (box.isEmpty()) return;
    const around = box.clone().expandByScalar(INSIDE_MARGIN);
    const item: Faded = { obj, inverse, box, around, materials, opacity: 1, out: false };
    this.items.set(obj, item);
    if (from && from.opacity < 1) {
      item.out = from.out;
      this.apply(item, from.opacity);
    }
  }

  /** Stops fading `obj` (a chest taken away or re-mounted) and frees its material copies; returns how faded it was. */
  untrack(obj: Object3D): FadeState | undefined {
    const item = this.items.get(obj);
    if (!item) return undefined;
    this.items.delete(obj);
    for (const { m } of item.materials) m.dispose();
    return { opacity: item.opacity, out: item.out };
  }

  /**
   * Called every frame with the world being drawn and the character's chest.
   * An object of that world on the line of sight fades: to FADED when it
   * stands off in the distance, so its silhouette still reads, and out
   * completely when it is big on screen (the tall Hive right behind a player
   * who just stepped out, a chest right in front of the camera) or the camera
   * is inside it, where stacked see-through walls would only be a haze.
   * Objects of other worlds ease back to solid.
   */
  update(dt: number, camera: PerspectiveCamera, scene: Scene, target: Vector3) {
    camera.updateMatrixWorld(); // it has just moved this frame
    const eye = camera.position;
    const dist = eye.distanceTo(target);
    _ray.origin.copy(eye);
    _ray.direction.subVectors(target, eye).normalize();
    const k = dampFactor(EASE, dt);
    for (const item of this.items.values()) {
      let want = 1;
      let out = false;
      if (item.obj.parent === scene) {
        _local.copy(_ray).applyMatrix4(item.inverse);
        if (item.around.containsPoint(_local.origin)) out = true;
        else if (_local.intersectBox(item.box, _hit) && _hit.applyMatrix4(item.obj.matrixWorld).distanceTo(eye) < dist) {
          out = screenSize(item, camera) > (item.out ? BACK : OUT);
          want = FADED;
        }
      }
      item.out = out;
      if (out) want = 0;
      if (item.opacity === want) continue;
      let opacity = item.opacity + (want - item.opacity) * k;
      if (Math.abs(opacity - want) < 0.01) opacity = want;
      this.apply(item, opacity);
    }
  }

  private apply(item: Faded, opacity: number) {
    item.opacity = opacity;
    item.obj.visible = opacity > 0; // fully out draws nothing at all
    const see = opacity < 1;
    for (const base of item.materials) {
      const m = base.m;
      const transparent = see || base.transparent;
      if (m.transparent !== transparent) m.needsUpdate = true;
      m.transparent = transparent;
      m.depthWrite = see ? false : base.depthWrite; // no sorting glitches between a faded object's own faces
      m.opacity = base.opacity * opacity;
    }
  }

  /** Dev hook: the buildings (by id) and chests (by "box" and id) currently fading or faded, with their opacity. */
  debug(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const item of this.items.values()) {
      const { building, box } = item.obj.userData;
      if (item.opacity < 1) out[building ?? `box${box}`] = Math.round(item.opacity * 100) / 100;
    }
    return out;
  }
}
