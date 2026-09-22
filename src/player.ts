import { Quaternion, Vector3, type Camera } from "three";
import { CHARACTERS, TURN_SPEED, type CharacterId } from "../shared/protocol.ts";
import { tangentFrameQuat } from "./math.ts";
import type { GlobeWorld, World } from "./world.ts";

const _up = new Vector3();
const _camF = new Vector3();
const _camR = new Vector3();
const _dir = new Vector3();
const _targetQ = new Quaternion();

type Tween = { from: number; target: number; t: number; dur: number };

/**
 * The local character: stands on a tile of its current World (the globe or a
 * building interior) and steps square-by-square with a smooth tween.
 */
export class Player {
  world: World;
  tile: number;
  pos = new Vector3();
  quat = new Quaternion();
  forward = new Vector3(0, 0, 1);
  moving = false;
  character: CharacterId = "bee";

  private tween: Tween | null = null;

  constructor(private globe: GlobeWorld) {
    this.world = globe;
    this.tile = globe.spawn(0).tile;
    this.spawnAt(0);
  }

  private get def() {
    return CHARACTERS[this.character];
  }

  spawnAt(slot: 0 | 1) {
    const s = this.globe.spawn(slot);
    this.enterWorld(this.globe, s.tile, s.forward);
  }

  /** Teleport into a world (entering/leaving a building, or spawning). */
  enterWorld(world: World, tile: number, forward: Vector3) {
    this.world = world;
    this.tile = tile;
    this.tween = null;
    this.moving = false;
    world.tilePos(tile, this.def.hover, this.pos);
    this.forward.copy(forward);
    tangentFrameQuat(world.up(this.pos, _up), this.forward, this.quat);
  }

  setCharacter(c: CharacterId) {
    if (this.character === c) return;
    this.character = c;
    if (!this.tween) this.world.tilePos(this.tile, this.def.hover, this.pos);
  }

  update(dt: number, input: { x: number; y: number }, camera: Camera) {
    const w = this.world;

    // advance the current step
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt / tw.dur;
      if (tw.t >= 1) {
        this.tile = tw.target;
        w.tilePos(tw.target, this.def.hover, this.pos);
        this.tween = null;
      } else {
        w.pathPos(tw.from, tw.target, tw.t, this.def.hover, this.pos);
      }
    }

    // start the next step (chains seamlessly while a key is held)
    if (!this.tween && (input.x !== 0 || input.y !== 0)) {
      const up = w.up(this.pos, _up);
      const camF = camera.getWorldDirection(_camF);
      camF.addScaledVector(up, -camF.dot(up));
      if (camF.lengthSq() > 1e-6) {
        camF.normalize();
        _camR.crossVectors(camF, up);
        _dir.set(0, 0, 0).addScaledVector(camF, input.y).addScaledVector(_camR, input.x).normalize();
        const target = w.neighborInDirection(this.tile, _dir);
        if (target >= 0) {
          w.dirBetween(this.tile, target, this.forward);
          if (!w.isBlockedFor(target, this.character)) {
            this.tween = {
              from: this.tile,
              target,
              t: 0,
              dur: Math.max(w.stepLength(this.tile, target) / this.def.speed, 0.05),
            };
          }
          // blocked: the character still turns to face the obstacle
        }
      }
    }

    this.moving = this.tween !== null;

    // stay upright, face the walk direction, turn at a bounded rate
    const up = w.up(this.pos, _up);
    tangentFrameQuat(up, this.forward, _targetQ);
    this.quat.rotateTowards(_targetQ, TURN_SPEED * dt);
  }
}
