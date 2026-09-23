// Photo mode: a viewfinder over the world. Drag to look around (the camera
// walks around the character and tilts up to the sky), zoom and walk as
// usual, then the shutter renders one high-resolution frame, cuts out exactly
// the window and hands back a JPEG.
import type { WebGLRenderer } from "three";
import type { FollowCamera } from "./camera.ts";

const YAW_PER_PX = 0.004;
const TILT_PER_PX = 0.002;
const AIM = 0.5; // aim at the character's body rather than above the head
const SHOT_MIN_WIDTH = 1500; // device pixels across the window, where the device allows
const MAX_RATIO = 3;

export class PhotoMode {
  private renderer: WebGLRenderer;
  private cam: FollowCamera;
  private renderFrame: () => void;
  private root: HTMLElement;
  private window: HTMLElement;
  private flash: HTMLElement;
  private active = false;
  private taking = false;

  constructor(renderer: WebGLRenderer, cam: FollowCamera, renderFrame: () => void) {
    this.renderer = renderer;
    this.cam = cam;
    this.renderFrame = renderFrame;
    const $ = (id: string) => {
      const e = document.getElementById(id);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    this.root = $("photo");
    this.window = $("ph-window");
    this.flash = $("ph-flash");
  }

  get isActive() {
    return this.active;
  }

  /** Shows the viewfinder; resolves with the JPEG when the shutter fires, or null on "Back" / Escape. */
  take(): Promise<Blob | null> {
    if (this.active) return Promise.reject(new Error("Already taking a picture"));
    this.active = true;
    this.taking = false;
    document.body.classList.add("photo");
    this.root.hidden = false;
    this.cam.setAim(AIM);
    this.frameWindow();
    const start = this.cam.look;
    let yaw = start.yaw;
    let tilt = start.tilt;

    return new Promise<Blob | null>((resolve, reject) => {
      let failure: Error | null = null;
      // one pointer drags the view, two pinch the zoom (as in the picture editor)
      const pointers = new Map<number, { x: number; y: number }>();
      let pinchDistance = 0;
      const spread = () => {
        const [a, b] = [...pointers.values()];
        return Math.hypot(a.x - b.x, a.y - b.y);
      };
      const onDown = (e: PointerEvent) => {
        if (e.target instanceof Element && e.target.closest("button")) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.root.setPointerCapture(e.pointerId);
        this.root.classList.add("ph-dragging");
        if (pointers.size === 2) pinchDistance = spread();
      };
      const onMove = (e: PointerEvent) => {
        const last = pointers.get(e.pointerId);
        if (!last) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size >= 2) {
          // spreading the fingers zooms in; step by step, so the product runs from the zoom at pinch start
          const d = spread();
          if (pinchDistance > 0 && d > 0) this.cam.zoomBy(pinchDistance / d);
          pinchDistance = d;
        } else {
          // drag right looks right, drag up looks up
          yaw -= (e.clientX - last.x) * YAW_PER_PX;
          tilt -= (e.clientY - last.y) * TILT_PER_PX;
          this.cam.setLook(yaw, tilt);
          ({ yaw, tilt } = this.cam.look); // stay within the camera's wrap and clamp
        }
      };
      const onUp = (e: PointerEvent) => {
        if (!pointers.delete(e.pointerId)) return;
        // the finger left behind carries on dragging from where it is, without a jump
        pinchDistance = pointers.size >= 2 ? spread() : 0;
        if (pointers.size === 0) this.root.classList.remove("ph-dragging");
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code === "Escape") {
          e.stopImmediatePropagation();
          e.preventDefault();
          if (!this.taking) finish(null); // a shot in flight finishes first
        } else if (e.code === "Space" || e.code === "Enter") {
          e.stopImmediatePropagation();
          e.preventDefault();
          void shoot();
        } else if (e.code === "KeyE") {
          e.stopImmediatePropagation();
        }
      };
      const back = document.getElementById("ph-back")!;
      const shutter = document.getElementById("ph-shutter")!;
      const onBack = () => {
        if (!this.taking) finish(null);
      };
      const onShutter = () => void shoot();

      const shoot = async () => {
        if (this.taking) return;
        this.taking = true;
        try {
          const blob = await this.capture();
          this.flash.classList.remove("ph-go");
          void this.flash.offsetWidth; // restart the animation
          this.flash.classList.add("ph-go");
          finish(blob);
        } catch {
          failure = new Error("Could not take the picture");
          finish(null);
        }
      };

      let done = false;
      const finish = (blob: Blob | null) => {
        if (done) return;
        done = true;
        this.root.removeEventListener("pointerdown", onDown);
        this.root.removeEventListener("pointermove", onMove);
        this.root.removeEventListener("pointerup", onUp);
        this.root.removeEventListener("pointercancel", onUp);
        removeEventListener("keydown", onKey, true);
        back.removeEventListener("click", onBack);
        shutter.removeEventListener("click", onShutter);
        removeEventListener("resize", this.frameWindow);
        this.root.classList.remove("ph-dragging");
        this.cam.camera.clearViewOffset();
        this.cam.clearLook();
        this.root.hidden = true;
        document.body.classList.remove("photo");
        this.active = false;
        this.taking = false;
        if (failure) reject(failure);
        else resolve(blob);
      };

      this.root.addEventListener("pointerdown", onDown);
      this.root.addEventListener("pointermove", onMove);
      this.root.addEventListener("pointerup", onUp);
      this.root.addEventListener("pointercancel", onUp);
      addEventListener("keydown", onKey, true);
      back.addEventListener("click", onBack);
      shutter.addEventListener("click", onShutter);
      addEventListener("resize", this.frameWindow);
    });
  }

  /** Shifts the projection so the point the camera looks at lands on the window's centre. */
  private frameWindow = () => {
    const win = this.window.getBoundingClientRect();
    const x = Math.round(innerWidth / 2 - (win.left + win.width / 2));
    const y = Math.round(innerHeight / 2 - (win.top + win.height / 2));
    this.cam.camera.setViewOffset(innerWidth, innerHeight, x, y, innerWidth, innerHeight);
  };

  /** One frame at up to MAX_RATIO device pixels per CSS pixel, cropped to the window, as a JPEG. */
  private async capture(): Promise<Blob> {
    const win = this.window.getBoundingClientRect();
    const usual = this.renderer.getPixelRatio();
    const wanted = Math.min(MAX_RATIO, Math.max(usual, SHOT_MIN_WIDTH / win.width));
    this.renderer.setPixelRatio(wanted);
    this.renderer.setSize(innerWidth, innerHeight, false);
    try {
      this.renderFrame();
      const canvas = this.renderer.domElement;
      // the browser may cap the buffer below what we asked for: scale from what it really is
      const ratio = canvas.width / innerWidth;
      const out = document.createElement("canvas");
      out.width = Math.round(win.width * ratio);
      out.height = Math.round(win.height * ratio);
      out.getContext("2d")!.drawImage(canvas, win.left * ratio, win.top * ratio, out.width, out.height, 0, 0, out.width, out.height);
      return await new Promise<Blob>((resolve, reject) =>
        out.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the picture"))), "image/jpeg", 0.92),
      );
    } finally {
      this.renderer.setPixelRatio(usual);
      this.renderer.setSize(innerWidth, innerHeight, false);
    }
  }
}
