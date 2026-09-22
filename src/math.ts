import { Matrix4, Quaternion, Vector3 } from "three";

/** Deterministic PRNG so both players generate the identical world. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _f = new Vector3();
const _r = new Vector3();
const _m = new Matrix4();

/**
 * Quaternion with local +Y = `up` and local +Z = `forward`.
 * `forward` is re-orthogonalized against `up` and written back, so a stored
 * forward vector can't drift off the tangent plane while walking the sphere.
 */
export function tangentFrameQuat(up: Vector3, forward: Vector3, out: Quaternion): Quaternion {
  _f.copy(forward).addScaledVector(up, -forward.dot(up));
  if (_f.lengthSq() < 1e-10) {
    // forward was parallel to up: pick an arbitrary tangent
    _f.set(1, 0, 0);
    if (Math.abs(up.x) > 0.9) _f.set(0, 0, 1);
    _f.cross(up);
  }
  _f.normalize();
  forward.copy(_f);
  _r.crossVectors(up, _f);
  _m.makeBasis(_r, up, _f);
  return out.setFromRotationMatrix(_m);
}

/** Framerate-independent smoothing factor for lerp/slerp-style easing. */
export function dampFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * dampFactor(rate, dt);
}
