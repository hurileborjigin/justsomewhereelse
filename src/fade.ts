import { Box3, Matrix4, Mesh, Ray, Vector3, type Material, type Object3D, type Scene } from "three";
import { dampFactor } from "./math.ts";

const FADED = 0.25; // opacity of a building standing between the camera and the character
const EASE = 10; // how quickly a building fades out and back in (see dampFactor)

type Faded = {
  obj: Object3D;
  inverse: Matrix4; // world -> the building's own frame
  box: Box3; // the building's bounds in its own frame: tight, however it leans on the globe
  materials: { m: Material; transparent: boolean; depthWrite: boolean; opacity: number }[]; // and how each looks solid
  opacity: number;
};

const _ray = new Ray();
const _local = new Ray();
const _hit = new Vector3();
const _m = new Matrix4();

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
      if (!box.isEmpty()) this.items.push({ obj, inverse, box, materials, opacity: 1 });
    }
  }

  /**
   * Called every frame. With `target` (the character's chest, on the globe)
   * buildings on the line of sight fade; without one (inside a room)
   * everything eases back to solid.
   */
  update(dt: number, camera: Vector3, target: Vector3 | null) {
    let dist = 0;
    if (target) {
      dist = camera.distanceTo(target);
      _ray.origin.copy(camera);
      _ray.direction.subVectors(target, camera).normalize();
    }
    const k = dampFactor(EASE, dt);
    for (const item of this.items) {
      let blocking = false;
      if (target) {
        _local.copy(_ray).applyMatrix4(item.inverse);
        if (item.box.containsPoint(_local.origin)) blocking = true;
        else if (_local.intersectBox(item.box, _hit)) {
          blocking = _hit.applyMatrix4(item.obj.matrixWorld).distanceTo(camera) < dist;
        }
      }
      const want = blocking ? FADED : 1;
      if (item.opacity === want) continue;
      item.opacity += (want - item.opacity) * k;
      if (Math.abs(item.opacity - want) < 0.01) item.opacity = want;
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
