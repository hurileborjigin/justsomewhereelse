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

  // ---- d-pad: simple transparent hold-to-move buttons -----------------------
  const pad = document.getElementById("dpad")!;
  const runToggle = document.getElementById("run-toggle")!;
  const DIRS: Record<string, [number, number]> = {
    up: [0, 1],
    down: [0, -1],
    left: [-1, 0],
    right: [1, 0],
  };
  const pressed = new Set<string>();
  let running = false;

  const emit = () => {
    let x = 0;
    let y = 0;
    for (const d of pressed) {
      x += DIRS[d][0];
      y += DIRS[d][1];
    }
    input.setTouch(Math.sign(x), Math.sign(y), running);
  };

  pad.addEventListener("contextmenu", (e) => e.preventDefault());
  for (const btn of pad.querySelectorAll<HTMLButtonElement>("button[data-dir]")) {
    const dir = btn.dataset.dir!;
    const press = (e: PointerEvent) => {
      btn.setPointerCapture(e.pointerId);
      pressed.add(dir);
      btn.classList.add("pressed");
      emit();
      e.preventDefault();
    };
    const release = () => {
      pressed.delete(dir);
      btn.classList.remove("pressed");
      emit();
    };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
  }
  runToggle.addEventListener("pointerdown", (e) => {
    running = !running;
    runToggle.classList.toggle("on", running);
    emit();
    e.preventDefault();
  });

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
