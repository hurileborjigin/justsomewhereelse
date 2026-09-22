import { Quaternion, Vector3, type Camera } from "three";
import { CHARACTERS, SURFACE, TURN_SPEED, type CharacterId } from "../shared/protocol.ts";
import {
  SPAWN_TILES,
  greatCircleDir,
  isBlockedFor,
  neighborInDirection,
  spawnForward,
  tileCenter,
} from "./grid.ts";
import { tangentFrameQuat } from "./math.ts";

const _up = new Vector3();
const _camF = new Vector3();
const _camR = new Vector3();
const _dir = new Vector3();
const _targetQ = new Quaternion();

type Tween = { from: Vector3; to: Vector3; t: number; dur: number; target: number };

/**
 * The local character: sits on a grid tile and steps square-by-square.
 * A step tweens along the great-circle arc between adjacent tile centers.
 */
export class Player {
  tile = SPAWN_TILES[0];
  pos = new Vector3();
  quat = new Quaternion();
  forward = new Vector3(0, 0, 1);
  moving = false;
  character: CharacterId = "bee";

  private tween: Tween | null = null;

  private get def() {
    return CHARACTERS[this.character];
  }

  private get radius() {
    return SURFACE + this.def.hover;
  }

  spawnAt(slot: 0 | 1) {
    this.tile = SPAWN_TILES[slot];
    this.tween = null;
    this.moving = false;
    const c = tileCenter(this.tile);
    this.pos.copy(c).multiplyScalar(this.radius);
    this.forward.copy(spawnForward(slot));
    tangentFrameQuat(_up.copy(c), this.forward, this.quat);
  }

  setCharacter(c: CharacterId) {
    if (this.character === c) return;
    this.character = c;
    this.pos.setLength(this.radius); // hover height changes between characters
  }

  update(dt: number, input: { x: number; y: number }, camera: Camera) {
    // advance the current step
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt / tw.dur;
      if (tw.t >= 1) {
        this.tile = tw.target;
        this.pos.copy(tw.to).multiplyScalar(this.radius);
        this.tween = null;
      } else {
        _dir.copy(tw.from).lerp(tw.to, tw.t).normalize();
        this.pos.copy(_dir).multiplyScalar(this.radius);
      }
    }

    // start the next step (chains seamlessly while a key is held)
    if (!this.tween && (input.x !== 0 || input.y !== 0)) {
      const up = _up.copy(this.pos).normalize();
      const camF = camera.getWorldDirection(_camF);
      camF.addScaledVector(up, -camF.dot(up));
      if (camF.lengthSq() > 1e-6) {
        camF.normalize();
        _camR.crossVectors(camF, up);
        _dir.set(0, 0, 0).addScaledVector(camF, input.y).addScaledVector(_camR, input.x).normalize();
        const target = neighborInDirection(this.tile, _dir);
        if (target >= 0) {
          const from = tileCenter(this.tile);
          const to = tileCenter(target);
          greatCircleDir(from, to, this.forward);
          if (!isBlockedFor(target, this.def.fly)) {
            const arc = from.angleTo(to) * SURFACE;
            this.tween = {
              from: from.clone(),
              to: to.clone(),
              t: 0,
              dur: Math.max(arc / this.def.speed, 0.05),
              target,
            };
          }
          // blocked: the character still turns to face the obstacle
        }
      }
    }

    this.moving = this.tween !== null;

    // stay upright, face the walk direction, turn at a bounded rate
    const up = _up.copy(this.pos).normalize();
    tangentFrameQuat(up, this.forward, _targetQ);
    this.quat.rotateTowards(_targetQ, TURN_SPEED * dt);
  }
}
