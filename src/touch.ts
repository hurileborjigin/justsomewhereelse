import type { FollowCamera } from "./camera.ts";
import type { Input } from "./input.ts";

/**
 * Mobile controls: a translucent joystick (drag to walk, 8 directions, drag
 * far to run) and a vertical slider on the right edge for zooming. They only
 * appear on touch devices; both use Pointer Events, so they also respond to
 * a mouse for testing.
 */
export function setupTouchControls(input: Input, cam: FollowCamera) {
  const coarse = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  if (!coarse) return;
  document.body.classList.add("touch");

  // ---- joystick -------------------------------------------------------------
  const stick = document.getElementById("joystick")!;
  const knob = document.getElementById("joystick-knob")!;
  const KNOB_MAX = 38; // px the knob may travel
  const DEAD = 12; // px before movement starts
  const RUN = 50; // px beyond which you sprint
  let stickPointer: number | null = null;
  let cx = 0;
  let cy = 0;

  const applyStick = (e: PointerEvent) => {
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    const k = len > KNOB_MAX ? KNOB_MAX / len : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    if (len < DEAD) {
      input.setTouch(0, 0, false);
      return;
    }
    // eight direction sectors
    const nx = dx / len;
    const ny = dy / len;
    const x = Math.abs(nx) > 0.38 ? Math.sign(nx) : 0;
    const y = Math.abs(ny) > 0.38 ? -Math.sign(ny) : 0;
    input.setTouch(x, y, len > RUN);
  };

  stick.addEventListener("pointerdown", (e) => {
    stickPointer = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    applyStick(e);
    e.preventDefault();
  });
  stick.addEventListener("pointermove", (e) => {
    if (e.pointerId === stickPointer) applyStick(e);
  });
  const releaseStick = (e: PointerEvent) => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    knob.style.transform = "";
    input.setTouch(0, 0, false);
  };
  stick.addEventListener("pointerup", releaseStick);
  stick.addEventListener("pointercancel", releaseStick);

  // ---- zoom slider ----------------------------------------------------------
  const track = document.getElementById("zoom-track")!;
  const handle = document.getElementById("zoom-handle")!;
  let zoomPointer: number | null = null;

  const placeHandle = (f: number) => {
    handle.style.top = `${Math.min(1, Math.max(0, f)) * 100}%`;
  };
  placeHandle(cam.zoomFraction());

  const applyZoom = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    cam.setZoomFraction(f);
    placeHandle(f);
  };
  track.addEventListener("pointerdown", (e) => {
    zoomPointer = e.pointerId;
    track.setPointerCapture(e.pointerId);
    applyZoom(e);
    e.preventDefault();
  });
  track.addEventListener("pointermove", (e) => {
    if (e.pointerId === zoomPointer) applyZoom(e);
  });
  const releaseZoom = (e: PointerEvent) => {
    if (e.pointerId === zoomPointer) zoomPointer = null;
  };
  track.addEventListener("pointerup", releaseZoom);
  track.addEventListener("pointercancel", releaseZoom);
}
