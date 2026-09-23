// The picture side of a postcard. Compose: drag to move, wheel / pinch /
// slider to zoom, a caption in handwriting, and buttons to take, upload or
// remove the photo. Read: the stored crop and caption. Both place the photo
// with the same crop math so the finder sees what the sender saw.
import { PICTURE_CAPTION_MAX, type MediaRef, type Picture } from "../shared/protocol.ts";
import { clampZoom, focusFrom, placePicture, type Focus, type Placement } from "./crop.ts";
import { el, graphemes } from "./dom.ts";

export type PictureDraft = { source: MediaRef | Blob; focus: Focus; zoom: number; caption: string };

export type PictureEditor = {
  root: HTMLElement;
  /** The current draft, or null while the face is empty. */
  draft(): PictureDraft | null;
  /** Has anything changed since the editor was created? */
  dirty(): boolean;
  /** A new photo or shot (focus centred, zoom 1, caption kept), or null to empty the face. */
  set(source: MediaRef | Blob | null): void;
  /** Release object URLs and observers. */
  destroy(): void;
};

export type PictureHooks = {
  /** Photo mode; absent when the world cannot take pictures (the button is not shown then). */
  takePicture?: () => Promise<Blob | null>;
  /** Something failed (a shot, a bad file): show this to the sender. */
  onError(message: string): void;
};

const ICON = {
  camera:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  frame:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/></svg>',
  cross:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

const urlOf = (source: MediaRef | Blob) => (source instanceof Blob ? URL.createObjectURL(source) : source.url);

/** Lays a photo out in `root` and keeps it laid out as the frame resizes. Returns a re-layout function. */
function mountPhoto(root: HTMLElement, img: HTMLImageElement, state: { focus: Focus; zoom: number }, onLayout?: (p: Placement) => void) {
  const layout = () => {
    if (!img.naturalWidth) return;
    const frame = { w: root.clientWidth, h: root.clientHeight };
    if (!frame.w || !frame.h) return;
    const p = placePicture(frame, { w: img.naturalWidth, h: img.naturalHeight }, state.focus, state.zoom);
    img.style.left = `${p.left}px`;
    img.style.top = `${p.top}px`;
    img.style.width = `${p.width}px`;
    img.style.height = `${p.height}px`;
    onLayout?.(p);
  };
  img.addEventListener("load", layout);
  const ro = new ResizeObserver(layout);
  ro.observe(root);
  layout();
  return { layout, stop: () => ro.disconnect() };
}

export function pictureView(picture: Picture, onBroken: () => void): HTMLElement {
  const root = el("div", "pc-picture");
  const img = el("img", "pc-photo");
  img.draggable = false;
  img.alt = "";
  img.addEventListener("error", onBroken, { once: true });
  root.append(img);
  if (picture.caption) root.append(el("div", "pc-cap", picture.caption));
  mountPhoto(root, img, { focus: picture.focus, zoom: picture.zoom });
  img.src = picture.image.url;
  return root;
}

export function pictureEditor(initial: PictureDraft | null, hooks: PictureHooks): PictureEditor {
  const root = el("div", "pc-picture");
  const file = el("input", "pc-picture-file");
  file.type = "file";
  file.accept = "image/*";
  file.hidden = true;
  let draft: PictureDraft | null = initial ? { ...initial, focus: { ...initial.focus } } : null;
  let dirty = false;
  let objectUrl: string | null = null;
  let stop: (() => void) | null = null;

  const release = () => {
    stop?.();
    stop = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  const pick = () => {
    file.value = "";
    file.click();
  };
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      hooks.onError("Only a photo can be the picture side");
      return;
    }
    set(f);
  });

  const take = async () => {
    if (!hooks.takePicture) return;
    try {
      const shot = await hooks.takePicture();
      if (shot) set(shot);
    } catch (err) {
      hooks.onError(err instanceof Error ? err.message : "Could not take the picture");
    }
  };

  const renderEmpty = () => {
    const frame = el("div", "pc-picture-frame");
    frame.append(el("small", undefined, "The picture side"));
    if (hooks.takePicture) {
      const snap = el("button", "pc-primary", "📷 Take a picture");
      snap.id = "pc-snap";
      snap.type = "button";
      snap.addEventListener("click", take);
      frame.append(snap);
    }
    const upload = el("button", "pc-secondary", "Upload a photo");
    upload.id = "pc-upload";
    upload.type = "button";
    upload.addEventListener("click", pick);
    frame.append(upload);
    root.classList.add("pc-picture-empty");
    root.replaceChildren(frame, file);
  };

  const renderPhoto = (d: PictureDraft) => {
    root.classList.remove("pc-picture-empty");
    const img = el("img", "pc-photo");
    img.draggable = false;
    img.alt = "";
    const state = { focus: d.focus, zoom: d.zoom };
    let placed: Placement | null = null;
    const mounted = mountPhoto(root, img, state, (p) => (placed = p));
    stop = mounted.stop;
    const frame = () => ({ w: root.clientWidth, h: root.clientHeight });
    // after any move or zoom the stored focus is re-derived from the clamped
    // position, so what is saved is exactly what is on screen
    const settle = () => {
      mounted.layout();
      if (placed) d.focus = focusFrom(frame(), placed);
      state.focus = d.focus;
      dirty = true;
    };
    const setZoom = (z: number) => {
      d.zoom = clampZoom(z);
      state.zoom = d.zoom;
      slider.value = String(d.zoom);
      settle();
    };

    // drag with one pointer, pinch with two
    const pointers = new Map<number, { x: number; y: number }>();
    let dragStart: { x: number; y: number; left: number; top: number } | null = null;
    let pinchStart: { dist: number; zoom: number } | null = null;
    const dist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    img.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      img.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1 && placed) dragStart = { x: e.clientX, y: e.clientY, left: placed.left, top: placed.top };
      else if (pointers.size === 2) {
        dragStart = null;
        pinchStart = { dist: dist(), zoom: d.zoom };
      }
    });
    img.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinchStart) {
        setZoom((pinchStart.zoom * dist()) / pinchStart.dist);
      } else if (pointers.size === 1 && dragStart && placed) {
        const f = frame();
        const left = Math.min(0, Math.max(f.w - placed.width, dragStart.left + (e.clientX - dragStart.x)));
        const top = Math.min(0, Math.max(f.h - placed.height, dragStart.top + (e.clientY - dragStart.y)));
        d.focus = focusFrom(f, { ...placed, left, top });
        state.focus = d.focus;
        mounted.layout();
        dirty = true;
      }
    });
    const lift = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      dragStart = null;
      pinchStart = null;
      if (pointers.size === 1 && placed) {
        const [p] = [...pointers.values()];
        dragStart = { x: p.x, y: p.y, left: placed.left, top: placed.top };
      }
    };
    img.addEventListener("pointerup", lift);
    img.addEventListener("pointercancel", lift);
    img.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        setZoom(d.zoom * Math.exp(-e.deltaY * 0.002));
      },
      { passive: false },
    );

    const caption = el("input", "pc-cap-in");
    caption.value = d.caption;
    caption.placeholder = "A caption (optional)…";
    caption.spellcheck = false;
    caption.autocomplete = "off";
    caption.addEventListener("input", () => {
      const g = graphemes(caption.value);
      if (g.length > PICTURE_CAPTION_MAX) caption.value = g.slice(0, PICTURE_CAPTION_MAX).join("");
      d.caption = caption.value;
      dirty = true;
    });
    caption.addEventListener("keydown", (e) => {
      // Enter must not reach the chat's "Enter focuses the chat box" listener
      if (e.key === "Enter") {
        e.preventDefault();
        caption.blur();
      }
      e.stopPropagation();
    });

    const tools = el("div", "pc-tools");
    const tool = (svg: string, title: string, id: string, onClick: () => void) => {
      const b = el("button", "pc-tool");
      b.type = "button";
      b.id = id;
      b.title = title;
      b.innerHTML = svg;
      b.addEventListener("click", onClick);
      return b;
    };
    if (hooks.takePicture) tools.append(tool(ICON.camera, "Take another picture", "pc-retake", take));
    tools.append(tool(ICON.frame, "Upload another photo", "pc-replace", pick));
    tools.append(tool(ICON.cross, "Remove the picture", "pc-remove", () => set(null)));

    const slider = el("input", "pc-zoom");
    slider.type = "range";
    slider.min = "1";
    slider.max = "3";
    slider.step = "0.01";
    slider.value = String(d.zoom);
    slider.title = "Zoom";
    slider.addEventListener("input", () => setZoom(Number(slider.value)));

    root.replaceChildren(img, caption, tools, slider, file);
    objectUrl = d.source instanceof Blob ? URL.createObjectURL(d.source) : null;
    img.src = objectUrl ?? urlOf(d.source);
  };

  const render = () => {
    release();
    if (draft) renderPhoto(draft);
    else renderEmpty();
  };

  const set = (source: MediaRef | Blob | null) => {
    dirty = true;
    draft = source ? { source, focus: { x: 0.5, y: 0.5 }, zoom: 1, caption: draft?.caption ?? "" } : null;
    render();
  };

  render();
  return {
    root,
    draft: () => (draft ? { ...draft, focus: { ...draft.focus } } : null),
    dirty: () => dirty,
    set,
    destroy: release,
  };
}
