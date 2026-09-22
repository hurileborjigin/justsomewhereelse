import { Quaternion, Vector3, type Camera } from "three";
import { CHARACTERS, TURN_SPEED, type CharacterId } from "../shared/protocol.ts";
import { tangentFrameQuat } from "./math.ts";
import type { GlobeWorld, World } from "./world.ts";

const _up = new Vector3();
const _camF = new Vector3();
const _camR = new Vector3();
const _dir = new Vector3();
const _axisF = new Vector3();
const _axisR = new Vector3();
const _targetQ = new Quaternion();

const SPRINT = 2.5; // Shift/Ctrl multiplier

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
  private zigAxis: "f" | "r" = "f"; // alternates steps while moving diagonally
  /** The partner's tile in the same world (-1 = none): never step onto it. */
  peerTile = -1;

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

  update(dt: number, input: { x: number; y: number; fast?: boolean }, camera: Camera) {
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

    // start the next step (chains seamlessly while keys are held)
    if (!this.tween && (input.x !== 0 || input.y !== 0)) {
      const up = w.up(this.pos, _up);
      const camF = camera.getWorldDirection(_camF);
      camF.addScaledVector(up, -camF.dot(up));
      if (camF.lengthSq() > 1e-6) {
        camF.normalize();
        _camR.crossVectors(camF, up);
        _dir.set(0, 0, 0).addScaledVector(camF, input.y).addScaledVector(_camR, input.x).normalize();

        const walkable = (t: number) =>
          t >= 0 && t !== this.peerTile && !w.isBlockedFor(t, this.character);
        let target = -1;
        let blockedAhead = -1;
        if (input.x !== 0 && input.y !== 0) {
          // both axes held: move diagonally by alternating the two step
          // directions while the character faces the diagonal itself
          _axisF.copy(camF).multiplyScalar(Math.sign(input.y));
          _axisR.copy(_camR).multiplyScalar(Math.sign(input.x));
          const tf = w.neighborInDirection(this.tile, _axisF);
          const tr = w.neighborInDirection(this.tile, _axisR);
          const okF = walkable(tf);
          const okR = walkable(tr);
          if (okF && okR) {
            target = this.zigAxis === "f" ? tr : tf;
            this.zigAxis = this.zigAxis === "f" ? "r" : "f";
          } else if (okF) {
            target = tf;
            this.zigAxis = "f";
          } else if (okR) {
            target = tr;
            this.zigAxis = "r";
          }
        } else {
          this.zigAxis = input.y !== 0 ? "f" : "r";
          const t = w.neighborInDirection(this.tile, _dir);
          if (t >= 0) {
            if (walkable(t)) target = t;
            else blockedAhead = t;
          }
        }

        if (target >= 0) {
          this.forward.copy(_dir); // face where the keys point, diagonals included
          const speed = this.def.speed * (input.fast ? SPRINT : 1);
          this.tween = {
            from: this.tile,
            target,
            t: 0,
            dur: Math.max(w.stepLength(this.tile, target) / speed, 0.04),
          };
        } else if (blockedAhead >= 0) {
          // blocked: the character still turns to face the obstacle
          w.dirBetween(this.tile, blockedAhead, this.forward);
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
