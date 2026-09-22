import { PerspectiveCamera, Vector3 } from "three";
import { dampFactor } from "./math.ts";
import type { Player } from "./player.ts";

const _up = new Vector3();
const _fwd = new Vector3();
const _desired = new Vector3();
const _look = new Vector3();

/**
 * Third-person follow camera for sphere walking. camera.up is set to the
 * sphere normal every frame, so there are no poles and no gimbal flips.
 */
export class FollowCamera {
  camera = new PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 700);

  private desired(player: Player) {
    _up.copy(player.pos).normalize();
    _fwd.set(0, 0, 1).applyQuaternion(player.quat);
    return _desired.copy(player.pos).addScaledVector(_up, 3.2).addScaledVector(_fwd, -6.5);
  }

  snap(player: Player) {
    this.camera.position.copy(this.desired(player));
    this.finish(player);
  }

  update(dt: number, player: Player) {
    this.camera.position.lerp(this.desired(player), dampFactor(4, dt));
    this.finish(player);
  }

  private finish(player: Player) {
    this.camera.up.copy(_up);
    this.camera.lookAt(_look.copy(player.pos).addScaledVector(_up, 1.2));
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
