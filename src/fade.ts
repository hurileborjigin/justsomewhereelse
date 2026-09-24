import { Box3, Matrix4, Mesh, Ray, Vector3, type Material, type Object3D, type PerspectiveCamera, type Scene } from "three";
import { dampFactor } from "./math.ts";

const FADED = 0.35; // a building between the camera and the character: its silhouette still reads
const INSIDE_MARGIN = 0.4; // the camera this close to a building's box counts as inside it
// A blocking building bigger on screen than OUT (in screen heights squared, so
// a phone and a desktop agree) fades out completely; it stays out until it
// shrinks below BACK, so one hovering near the edge does not flicker.
const OUT = 0.5;
const BACK = 0.4;
const EASE = 10; // how quickly a building fades out and back in (see dampFactor)

type Faded = {
  obj: Object3D;
  inverse: Matrix4; // world -> the building's own frame
  box: Box3; // the building's bounds in its own frame: tight, however it leans on the globe
  around: Box3; // those bounds grown by INSIDE_MARGIN: a camera in here is inside the building
  materials: { m: Material; transparent: boolean; depthWrite: boolean; opacity: number }[]; // and how each looks solid
  opacity: number;
  out: boolean; // faded out completely, rather than to FADED
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
 * Fades any globe building whose model stands between the camera and the
 * character, so a tall house behind a player who just stepped out of it (or
 * any wall the camera swings behind) never hides them. Each building gets its
 * own copies of its materials, so fading one never fades its siblings.
 */
export class BuildingFade {
  private items: Faded[] = [];

  /** Every object the scatter tagged with `userData.building`. */
  constructor(scene: Scene) {
    scene.updateMatrixWorld(true);
    for (const obj of scene.children) {
      if (!obj.userData.building) continue;
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
      if (!box.isEmpty()) {
        const around = box.clone().expandByScalar(INSIDE_MARGIN);
        this.items.push({ obj, inverse, box, around, materials, opacity: 1, out: false });
      }
    }
  }

  /**
   * Called every frame. With `target` (the character's chest, on the globe)
   * a building on the line of sight fades: to FADED when it stands off in the
   * distance, so its silhouette still reads, and out completely when it is
   * big on screen (the tall Hive right behind a player who just stepped out)
   * or the camera is inside it, where stacked see-through walls would only be
   * a haze. Without a target (inside a room) everything eases back to solid.
   */
  update(dt: number, camera: PerspectiveCamera, target: Vector3 | null) {
    camera.updateMatrixWorld(); // it has just moved this frame
    const eye = camera.position;
    let dist = 0;
    if (target) {
      dist = eye.distanceTo(target);
      _ray.origin.copy(eye);
      _ray.direction.subVectors(target, eye).normalize();
    }
    const k = dampFactor(EASE, dt);
    for (const item of this.items) {
      let want = 1;
      let out = false;
      if (target) {
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
      item.opacity += (want - item.opacity) * k;
      if (Math.abs(item.opacity - want) < 0.01) item.opacity = want;
      item.obj.visible = item.opacity > 0; // fully out draws nothing at all
      const see = item.opacity < 1;
      for (const base of item.materials) {
        const m = base.m;
        const transparent = see || base.transparent;
        if (m.transparent !== transparent) m.needsUpdate = true;
        m.transparent = transparent;
        m.depthWrite = see ? false : base.depthWrite; // no sorting glitches between a faded building's own faces
        m.opacity = base.opacity * item.opacity;
      }
    }
  }

  /** Dev hook: the buildings currently fading or faded, by id, with their opacity. */
  debug(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const item of this.items) {
      if (item.opacity < 1) out[item.obj.userData.building] = Math.round(item.opacity * 100) / 100;
    }
    return out;
  }
}
