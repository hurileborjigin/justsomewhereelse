import { PerspectiveCamera, Vector3 } from "three";
import { dampFactor } from "./math.ts";
import type { Player } from "./player.ts";

const _up = new Vector3();
const _fwd = new Vector3();
const _desired = new Vector3();
const _look = new Vector3();

const ZOOM_MIN = 0.45; // right over the character's shoulder
const ZOOM_MAX = 11; // the whole planet fits on screen
const FAR_LOOK_BLEND = 0.85; // how much the far view centers on the planet

/**
 * Third-person follow camera for sphere walking. camera.up is set to the
 * sphere normal every frame, so there are no poles and no gimbal flips.
 * Scroll wheel / trackpad pinch zooms from over-the-shoulder all the way out
 * to a whole-planet overview (the look target blends from the character to
 * the planet's center as you zoom out).
 */
export class FollowCamera {
  camera = new PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 700);

  private zoom = 1;
  private targetZoom = 1;

  constructor() {
    addEventListener(
      "wheel",
      (e) => {
        // let the chat history keep its native scrolling
        if (e.target instanceof Element && e.target.closest("#chat-panel")) return;
        e.preventDefault();
        this.targetZoom = Math.min(
          ZOOM_MAX,
          Math.max(ZOOM_MIN, this.targetZoom * Math.exp(e.deltaY * 0.0012)),
        );
      },
      { passive: false },
    );
  }

  private desired(player: Player) {
    _up.copy(player.pos).normalize();
    _fwd.set(0, 0, 1).applyQuaternion(player.quat);
    return _desired
      .copy(player.pos)
      .addScaledVector(_up, 3.2 * this.zoom)
      .addScaledVector(_fwd, -6.5 * this.zoom);
  }

  snap(player: Player) {
    this.zoom = this.targetZoom;
    this.camera.position.copy(this.desired(player));
    this.finish(player);
  }

  update(dt: number, player: Player) {
    this.zoom += (this.targetZoom - this.zoom) * dampFactor(8, dt);
    this.camera.position.lerp(this.desired(player), dampFactor(4, dt));
    this.finish(player);
  }

  private finish(player: Player) {
    this.camera.up.copy(_up);
    _look.copy(player.pos).addScaledVector(_up, 1.2);
    // far out, look toward the planet's center so the globe sits centered
    const far = Math.min(1, Math.max(0, (this.zoom - 3) / 5)) * FAR_LOOK_BLEND;
    _look.multiplyScalar(1 - far);
    this.camera.lookAt(_look);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
