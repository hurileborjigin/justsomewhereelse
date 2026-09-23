// Photo mode: a viewfinder over the world. Drag to look around (the camera
// walks around the character and tilts up to the sky), zoom and walk as
// usual, then the shutter renders one high-resolution frame, cuts out exactly
// the window and hands back a JPEG.
import type { WebGLRenderer } from "three";
import type { FollowCamera } from "./camera.ts";

const YAW_PER_PX = 0.005;
const TILT_PER_PX = 0.004;
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
    const start = this.cam.look;
    let yaw = start.yaw;
    let tilt = start.tilt;

    return new Promise<Blob | null>((resolve, reject) => {
      let failure: Error | null = null;
      let drag: { id: number; x: number; y: number } | null = null;
      const onDown = (e: PointerEvent) => {
        if (e.target instanceof Element && e.target.closest("button")) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        this.root.setPointerCapture(e.pointerId);
        this.root.classList.add("ph-dragging");
      };
      const onMove = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        // drag right looks right, drag up looks up
        yaw -= (e.clientX - drag.x) * YAW_PER_PX;
        tilt -= (e.clientY - drag.y) * TILT_PER_PX;
        drag = { id: drag.id, x: e.clientX, y: e.clientY };
        this.cam.setLook(yaw, tilt);
        tilt = this.cam.look.tilt; // stay within the camera's clamp
      };
      const onUp = (e: PointerEvent) => {
        if (drag && e.pointerId === drag.id) drag = null;
        this.root.classList.remove("ph-dragging");
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code === "Escape") {
          e.stopImmediatePropagation();
          e.preventDefault();
          finish(null);
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
      const onBack = () => finish(null);
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
    });
  }

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
