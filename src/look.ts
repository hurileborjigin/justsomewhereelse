// Looking around: drag the world with a mouse or a finger and the camera
// swings around the character and tilts up or down, while the character
// stays put; let go and the view eases back behind the character.
import { LOOK_TILT_MIN, type FollowCamera } from "./camera.ts";
import { TILT_PER_PX, YAW_PER_PX } from "./photo.ts";

/** How far a pointer moves before a press becomes a look, so a plain click stays a click. */
const DRAG_START_PX = 4;

export class DragLook {
  private pointer: number | null = null;
  private start = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private looking = false;
  private yaw = 0;
  private tilt = 0;

  /** `surface` is the canvas the world draws on; nothing turns while `paused()` (photo mode drives the camera itself). */
  constructor(surface: HTMLElement, cam: FollowCamera, paused: () => boolean) {
    surface.addEventListener("pointerdown", (e) => {
      if (this.pointer !== null || paused() || (e.pointerType === "mouse" && e.button !== 0)) return;
      this.pointer = e.pointerId;
      this.start = this.last = { x: e.clientX, y: e.clientY };
    });
    surface.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.pointer) return;
      if (!this.looking) {
        if (Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) < DRAG_START_PX) return;
        this.looking = true;
        ({ yaw: this.yaw, tilt: this.tilt } = cam.look);
        surface.setPointerCapture(e.pointerId);
        document.body.classList.add("looking");
      }
      // drag right looks right, drag up looks up (as in photo mode)
      this.yaw -= (e.clientX - this.last.x) * YAW_PER_PX;
      this.tilt -= (e.clientY - this.last.y) * TILT_PER_PX;
      this.last = { x: e.clientX, y: e.clientY };
      cam.setLook(this.yaw, this.tilt, LOOK_TILT_MIN);
      ({ yaw: this.yaw, tilt: this.tilt } = cam.look); // stay within the camera's wrap and clamp
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      if (!this.looking) return;
      this.looking = false;
      document.body.classList.remove("looking");
      if (!paused()) cam.clearLook();
    };
    surface.addEventListener("pointerup", release);
    surface.addEventListener("pointercancel", release);
    surface.addEventListener("lostpointercapture", release);
  }
}
