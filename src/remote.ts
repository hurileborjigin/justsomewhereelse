import { Quaternion, Vector3 } from "three";
import { CHARACTERS, SURFACE, type CharacterId, type StateData } from "../shared/protocol.ts";
import { SPAWN_TILES, spawnForward, tileCenter } from "./grid.ts";
import { dampFactor, tangentFrameQuat } from "./math.ts";

/** The partner's character: smoothed toward the last received network state. */
export class RemotePlayer {
  pos = new Vector3();
  quat = new Quaternion();
  moving = false;
  present = false;
  character: CharacterId = "donkey";

  private targetPos = new Vector3();
  private targetQuat = new Quaternion();

  spawnAt(slot: 0 | 1) {
    const c = tileCenter(SPAWN_TILES[slot]);
    this.pos.copy(c).multiplyScalar(SURFACE + CHARACTERS[this.character].hover);
    const fwd = spawnForward(slot);
    tangentFrameQuat(c.clone(), fwd, this.quat);
    this.targetPos.copy(this.pos);
    this.targetQuat.copy(this.quat);
    this.moving = false;
  }

  setState(s: StateData) {
    this.targetPos.set(s.p[0], s.p[1], s.p[2]);
    this.targetQuat.set(s.q[0], s.q[1], s.q[2], s.q[3]).normalize();
    this.moving = s.m === 1;
    if (this.pos.distanceTo(this.targetPos) > 3) {
      // teleport / rejoin: snap instead of gliding across the planet
      this.pos.copy(this.targetPos);
      this.quat.copy(this.targetQuat);
    }
  }

  update(dt: number) {
    const a = dampFactor(10, dt);
    this.pos.lerp(this.targetPos, a);
    this.quat.slerp(this.targetQuat, a);
  }
}
