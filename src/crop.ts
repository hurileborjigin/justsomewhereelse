// Where a photo sits inside the picture face. Pure math, no DOM, so the Node
// test runner can drive it; compose and read both call placePicture so the
// finder sees exactly the crop the sender left.
import { PICTURE_ZOOM_MAX, PICTURE_ZOOM_MIN } from "../shared/protocol.ts";

export type Size = { w: number; h: number };
export type Focus = { x: number; y: number };
export type Placement = { left: number; top: number; width: number; height: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The photo covers the frame (the larger of the two cover ratios, times the
 * zoom) with `focus` at the frame's centre, then shifts just enough that no
 * frame edge shows photo-free space.
 */
export function placePicture(frame: Size, photo: Size, focus: Focus, zoom: number): Placement {
  const scale = Math.max(frame.w / photo.w, frame.h / photo.h) * zoom;
  const width = photo.w * scale;
  const height = photo.h * scale;
  const left = clamp(frame.w / 2 - focus.x * width, frame.w - width, 0);
  const top = clamp(frame.h / 2 - focus.y * height, frame.h - height, 0);
  return { left, top, width, height };
}

/** The focus that reproduces a (clamped) placement: what to store after a drag. */
export function focusFrom(frame: Size, placed: Placement): Focus {
  return { x: (frame.w / 2 - placed.left) / placed.width, y: (frame.h / 2 - placed.top) / placed.height };
}

export function clampZoom(z: number): number {
  return clamp(z, PICTURE_ZOOM_MIN, PICTURE_ZOOM_MAX);
}
