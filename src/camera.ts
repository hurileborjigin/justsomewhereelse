import { PerspectiveCamera, Vector3 } from "three";
import { dampFactor } from "./math.ts";
import type { Player } from "./player.ts";
import { RoomWorld } from "./world.ts";

const _up = new Vector3();
const _fwd = new Vector3();
const _desired = new Vector3();
const _look = new Vector3();
const _dir = new Vector3();
const _right = new Vector3();

const ZOOM_MIN = 0.45; // right over the character's shoulder
const ZOOM_MAX_GLOBE = 11; // the whole planet fits on screen
const FAR_LOOK_BLEND = 0.85; // how much the far view centers on the planet
const TILT_MIN = -0.26; // a little below the usual view
const TILT_MAX = 1.31; // nearly straight up
const AIM_DEFAULT = 1.2; // the usual view looks a little above the character's head

/** Wraps an angle into (-PI, PI]. */
function wrapAngle(a: number) {
  const w = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
  return w === -Math.PI ? Math.PI : w;
}

/**
 * Third-person follow camera. The up vector comes from the player's current
 * world (sphere normal on the globe, +Y in rooms), so there are no poles and
 * no gimbal flips anywhere. Scroll wheel / pinch zooms; on the globe the far
 * end of the range frames the whole planet.
 */
export class FollowCamera {
  camera = new PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 700);

  private zoom = 1;
  private targetZoom = 1;
  // photo mode: the camera walks around the character (yaw) and tilts its view
  private yaw = 0;
  private tilt = 0;
  private targetYaw = 0;
  private targetTilt = 0;
  // how high above the character's feet the camera aims; photo mode lowers it to the body
  private aim = AIM_DEFAULT;
  private targetAim = AIM_DEFAULT;
  // photo mode: where the projection centre sits, in CSS px from the screen centre
  private shiftX = 0;
  private shiftY = 0;
  private targetShiftX = 0;
  private targetShiftY = 0;
  private shifted = false;

  constructor() {
    addEventListener(
      "wheel",
      (e) => {
        // panels and the open postcard keep their native scrolling; only the world zooms
        if (e.target instanceof Element && e.target.closest("#chat-panel, #treasure-panel, #postcard")) return;
        e.preventDefault();
        this.zoomBy(Math.exp(e.deltaY * 0.0012));
      },
      { passive: false },
    );
  }

  private desired(player: Player) {
    player.world.up(player.pos, _up);
    _fwd.set(0, 0, 1).applyQuaternion(player.quat);
    _fwd.applyAxisAngle(_up, this.yaw);
    return _desired
      .copy(player.pos)
      .addScaledVector(_up, 3.2 * this.zoom)
      .addScaledVector(_fwd, -6.5 * this.zoom);
  }

  snap(player: Player) {
    this.clampZoom(player);
    this.zoom = this.targetZoom;
    this.yaw = this.targetYaw;
    this.tilt = this.targetTilt;
    this.aim = this.targetAim;
    this.shiftX = this.targetShiftX;
    this.shiftY = this.targetShiftY;
    this.camera.position.copy(this.desired(player));
    this.finish(player);
    this.applyShift();
  }

  update(dt: number, player: Player) {
    this.clampZoom(player);
    this.zoom += (this.targetZoom - this.zoom) * dampFactor(8, dt);
    // the shortest way round, so a long drag never unwinds through every turn
    this.yaw = wrapAngle(this.yaw + wrapAngle(this.targetYaw - this.yaw) * dampFactor(10, dt));
    this.tilt += (this.targetTilt - this.tilt) * dampFactor(10, dt);
    this.aim += (this.targetAim - this.aim) * dampFactor(10, dt);
    this.shiftX += (this.targetShiftX - this.shiftX) * dampFactor(10, dt);
    this.shiftY += (this.targetShiftY - this.shiftY) * dampFactor(10, dt);
    this.camera.position.lerp(this.desired(player), dampFactor(4, dt));
    this.finish(player);
    this.applyShift();
  }

  private clampZoom(player: Player) {
    const max = player.world instanceof RoomWorld ? player.world.zoomMax : ZOOM_MAX_GLOBE;
    if (this.targetZoom > max) this.targetZoom = max;
  }

  private finish(player: Player) {
    this.camera.up.copy(_up);
    _look.copy(player.pos).addScaledVector(_up, this.aim);
    if (player.world.isGlobe) {
      // far out, look toward the planet's center so the globe sits centered
      const far = Math.min(1, Math.max(0, (this.zoom - 3) / 5)) * FAR_LOOK_BLEND;
      _look.multiplyScalar(1 - far);
    }
    if (Math.abs(this.tilt) > 1e-4) {
      // pitch the view about the camera's own position: the character stays in the foreground
      _dir.subVectors(_look, this.camera.position);
      _right.crossVectors(_dir, _up).normalize();
      _dir.applyAxisAngle(_right, this.tilt);
      _look.copy(this.camera.position).add(_dir);
    }
    this.camera.lookAt(_look);
  }

  /** Photo mode: turn the camera around the character by `yaw` radians and tilt the view by `tilt` radians (up is positive). */
  setLook(yaw: number, tilt: number) {
    this.targetYaw = wrapAngle(yaw);
    this.targetTilt = Math.min(TILT_MAX, Math.max(TILT_MIN, tilt));
  }

  /** Moves the projection off-centre by the eased shift; drops the offset once it has eased back to nothing. */
  private applyShift() {
    const near = (v: number) => Math.abs(v) <= 0.5;
    if (near(this.shiftX) && near(this.shiftY) && near(this.targetShiftX) && near(this.targetShiftY)) {
      if (this.shifted) {
        this.camera.clearViewOffset();
        this.shifted = false;
      }
      return;
    }
    // a view window moved right renders the picture further left, hence the minus signs
    this.camera.setViewOffset(innerWidth, innerHeight, -this.shiftX, -this.shiftY, innerWidth, innerHeight);
    this.shifted = true;
  }

  /** Photo mode: put the projection centre (the point the camera looks at) `x`, `y` CSS px from the screen centre. */
  setViewShift(x: number, y: number) {
    this.targetShiftX = x;
    this.targetShiftY = y;
  }

  /** Photo mode: aim the camera `height` units above the character's feet. */
  setAim(height: number) {
    this.targetAim = height;
  }

  /** Ease back to the usual view behind the character. */
  clearLook() {
    this.targetYaw = 0;
    this.targetTilt = 0;
    this.targetAim = AIM_DEFAULT;
    this.targetShiftX = 0;
    this.targetShiftY = 0;
  }

  /** Multiplies the zoom distance by `factor` (below 1 zooms in). */
  zoomBy(factor: number) {
    this.targetZoom = Math.max(ZOOM_MIN, this.targetZoom * factor);
  }

  get look() {
    return { yaw: this.targetYaw, tilt: this.targetTilt };
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Zoom as a 0..1 fraction (0 = closest) - used by the mobile slider. */
  zoomFraction(): number {
    return Math.log(this.targetZoom / ZOOM_MIN) / Math.log(ZOOM_MAX_GLOBE / ZOOM_MIN);
  }

  setZoomFraction(f: number) {
    const c = Math.min(1, Math.max(0, f));
    this.targetZoom = ZOOM_MIN * Math.pow(ZOOM_MAX_GLOBE / ZOOM_MIN, c);
  }
}
