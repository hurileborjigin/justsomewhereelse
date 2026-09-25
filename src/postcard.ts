import "@fontsource/caveat/500.css";
import {
  BOX_LABEL_MAX_LEN,
  BOX_MEDIA_MAX,
  BOX_PLACE_MAX_LEN,
  BOX_STAMP_MAX,
  BOX_TEXT_MAX_LEN,
  MEDIA_MAX_BYTES,
  NAME_MAX_LEN,
  type Box,
  type BoxContents,
  type BoxStyle,
  type MediaRef,
} from "../shared/protocol.ts";
import { mediaElement } from "./chat.ts";
import { el, graphemes } from "./dom.ts";
import { pictureEditor, pictureView, type PictureDraft } from "./picture.ts";

/** The postcard's dressing as it should read: the stamp picture, the names, the place, the date. */
export type Postmark = { stamp: string; from: string; to: string; place: string; date: Date };

/** The postcard's dressing as the sender typed it; empty fields mean "the default". */
export type Dressing = { stamp: string; place: string; to: string; from: string };

export type Draft = {
  style: BoxStyle;
  /** The words: the postcard or note text, or the photo box caption. */
  text: string;
  dressing: Dressing;
  /** Postcards only; null for an empty picture side. */
  picture: PictureDraft | null;
  /** Prints already on the server that stay (editing a note or a photo box). */
  keep: MediaRef[];
  /** New prints to upload. */
  files: File[];
  announce: boolean;
};

export type ComposeOptions = {
  mark: Postmark;
  /** Editing a box that already exists: prefill from it. */
  initial?: { contents: BoxContents; announce: boolean };
  /**
   * "Leave it here" or "Save changes". Resolve true once the box stands in the world (or the edit
   * is saved) and the card may close; false when the sender comes back to the card as it was
   * (placing cancelled); reject with a message to show.
   */
  onSend: (draft: Draft) => Promise<boolean>;
  /** Photo mode: hides the dialog, returns a JPEG of the world, or null when cancelled. Absent when unavailable. */
  takePicture?: () => Promise<Blob | null>;
};

export type ReadOptions = {
  box: Box & { contents: BoxContents };
  mark: Postmark;
  /** finder: may keep it. creator: sees the sealed/opened footer. owner: reading from the panel. */
  role: "finder" | "creator" | "owner";
  openedBy: string; // the partner's name, for the creator's footer
  /** The reader already owns it (it stands where they put it): "Pick it up" rather than "Keep it". */
  isOwner: boolean;
  onKeep: (label: string) => void;
  /** Present only when the reader owns the box: rename it where it stands, without picking it up. */
  onLabel?: (label: string) => void;
  /** Present only when the reader may take the box back: their own box, still sealed. */
  onDelete?: () => void;
  /** Present only when the reader may change the box: their own box, still sealed. */
  onEdit?: () => void;
  /** Present only when the reader may pick the box up to move it: their own box, not yet kept. */
  onLift?: () => void;
};

type CardInputs = {
  stamp: HTMLInputElement;
  place: HTMLInputElement;
  to: HTMLInputElement;
  from: HTMLInputElement;
};

const STYLES: BoxStyle[] = ["postcard", "note", "media"];
const STYLE_LABEL: Record<BoxStyle, string> = { postcard: "Postcard", note: "Note", media: "Just photos" };
const SVG_NS = "http://www.w3.org/2000/svg";

const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export const TAKE_BACK_CONFIRM = "Take this box back? It disappears for both of you.";

/** The little treasure chest drawn once in index.html (#i-chest), sized by the .chest-icon rule. */
export function chestIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "chest-icon");
  svg.setAttribute("viewBox", "0 0 32 28");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "#i-chest");
  svg.append(use);
  return svg;
}

/** Sets a button's content to `before` + the chest + `after`. */
export function withChest(target: HTMLElement, before: string, after = "") {
  target.replaceChildren(before, chestIcon(), ...(after ? [after] : []));
}

/**
 * The treasure dialog: one overlay (#postcard) rebuilt for every box. Compose
 * mode writes straight onto a postcard, a sheet of paper, or a caption under
 * the photos; reading mode shows what someone left. Knows nothing about the
 * network - decisions come back through the callbacks in the options.
 */
export class Postcard {
  private root: HTMLElement;
  private fileInput: HTMLInputElement;
  private onToggle: (open: boolean) => void;
  /** Returns false to keep the dialog open (a half-written card). */
  private guard: (() => boolean) | null = null;
  private cleanup: (() => void) | null = null;
  private away = false;

  constructor(onToggle: (open: boolean) => void) {
    this.onToggle = onToggle;
    const root = document.getElementById("postcard");
    const file = document.getElementById("pc-file");
    if (!root || !(file instanceof HTMLInputElement)) throw new Error("missing #postcard / #pc-file");
    this.root = root;
    this.fileInput = file;
    addEventListener("keydown", (e) => {
      if (e.code === "Escape" && this.isOpen && !this.away) this.close();
    });
    // a click on the dark backdrop (not on the sheet) closes too
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  /** Whether the dialog is stepped aside for photo mode (see setAway). */
  get isAway() {
    return this.away;
  }

  /** Photo mode: hide the dialog (it stays open, nothing is lost) and bring it back. */
  setAway(on: boolean) {
    this.away = on;
    this.root.classList.toggle("pc-away", on);
    // a focused caption or message field must not keep WASD muted while the viewfinder is up
    if (on && this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  close() {
    if (this.root.hidden) return;
    if (this.guard && !this.guard()) return;
    this.teardown();
    this.root.hidden = true;
    this.root.replaceChildren();
    this.onToggle(false);
  }

  /** Closes the card without asking: what it held has gone out already (a box that landed late). */
  dismiss() {
    this.guard = null;
    this.close();
  }

  /** Releases a previous card's listeners and object URLs before a new one installs its own. */
  private teardown() {
    this.cleanup?.();
    this.cleanup = null;
    this.guard = null;
    this.away = false;
    this.root.classList.remove("pc-away");
  }

  /** A new box to fill and leave here, or (with `initial`) an existing one to change. */
  compose(opts: ComposeOptions) {
    this.teardown();
    const initial = opts.initial;
    const editing = initial !== undefined;
    const c = initial?.contents;
    const startText = c === undefined ? "" : c.style === "postcard" ? c.writing.text : c.style === "note" ? c.text : c.caption;
    const keep: MediaRef[] = c !== undefined && c.style !== "postcard" ? [...c.media] : [];
    const files: File[] = [];
    const urls: string[] = [];
    let style: BoxStyle = c?.style ?? "postcard";
    let busy = false;
    const total = () => keep.length + files.length;

    const error = el("div", "pc-error");
    let flipper: ReturnType<Postcard["flipCard"]> | null = null;
    const editor = pictureEditor(
      c?.style === "postcard" && c.picture
        ? { source: c.picture.image, focus: { ...c.picture.focus }, zoom: c.picture.zoom, caption: c.picture.caption }
        : null,
      {
        takePicture: opts.takePicture
          ? async () => {
              this.setAway(true);
              try {
                return await opts.takePicture!();
              } finally {
                this.setAway(false);
                flipper?.flip("picture");
              }
            }
          : undefined,
        onError: (m) => (error.textContent = m),
      },
    );
    // one text field travels between the three layouts, so switching keeps the words
    const textarea = el("textarea", "pc-text");
    textarea.maxLength = BOX_TEXT_MAX_LEN;
    textarea.value = startText;
    const count = el("span", "pc-count", `${textarea.value.length} / ${BOX_TEXT_MAX_LEN}`);
    textarea.addEventListener("input", () => {
      count.textContent = `${textarea.value.length} / ${BOX_TEXT_MAX_LEN}`;
    });
    const fields = this.cardInputs(opts.mark, c?.style === "postcard" ? c.writing : null);

    // photos & videos as instant-camera prints, staged until "Leave it here"
    const prints = el("div", "pc-prints");
    const addBtn = el("button", "pc-add", "＋ add photos or videos");
    addBtn.type = "button";
    addBtn.addEventListener("click", () => this.fileInput.click());
    const renderPrints = () => {
      prints.replaceChildren();
      // photos already on the server (editing) come first, each removable
      keep.forEach((m, i) => {
        const print = el("div", "pc-print");
        const x = el("button", "pc-x", "✕");
        x.type = "button";
        x.title = "Remove";
        x.addEventListener("click", () => {
          keep.splice(i, 1);
          renderPrints();
        });
        print.append(mediaElement(m, "row"), x);
        prints.append(print);
      });
      files.forEach((f, i) => {
        const print = el("div", "pc-print");
        let media: HTMLImageElement | HTMLVideoElement;
        if (f.type.startsWith("video/")) {
          const v = el("video");
          v.muted = true;
          v.playsInline = true;
          v.preload = "metadata";
          media = v;
        } else {
          media = el("img");
        }
        media.src = urls[i];
        const x = el("button", "pc-x", "✕");
        x.type = "button";
        x.title = "Remove";
        x.addEventListener("click", () => {
          URL.revokeObjectURL(urls[i]);
          files.splice(i, 1);
          urls.splice(i, 1);
          renderPrints();
        });
        print.append(media, x);
        prints.append(print);
      });
      addBtn.hidden = style === "postcard" || total() >= BOX_MEDIA_MAX;
      prints.append(addBtn);
    };
    const onFiles = () => {
      for (const f of this.fileInput.files ?? []) {
        if (total() >= BOX_MEDIA_MAX) {
          error.textContent = `A box holds at most ${BOX_MEDIA_MAX} photos or videos`;
          break;
        }
        if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) {
          error.textContent = "Only photos and videos fit in a box";
          continue;
        }
        if (f.type.startsWith("video/") && f.size > MEDIA_MAX_BYTES) {
          error.textContent = `That video is too big (max ${Math.round(MEDIA_MAX_BYTES / 1024 / 1024)} MB)`;
          continue;
        }
        files.push(f);
        urls.push(URL.createObjectURL(f));
      }
      this.fileInput.value = "";
      renderPrints();
    };
    this.fileInput.addEventListener("change", onFiles);
    renderPrints();

    // the three layouts share the text field, the prints and the controls
    const body = el("div", "pc-body");
    const render = () => {
      body.replaceChildren();
      prints.classList.toggle("pc-big", style === "media");
      textarea.classList.toggle("pc-caption", style === "media");
      addBtn.hidden = style === "postcard" || total() >= BOX_MEDIA_MAX;
      if (style === "postcard") {
        textarea.placeholder = `Dear ${fields.to.value.trim() || opts.mark.to},`;
        const card = this.card(opts.mark, textarea, fields);
        card.querySelector(".pc-msg")!.append(count);
        flipper = this.flipCard(card, editor.root, "compose", false);
        body.append(flipper.root);
      } else if (style === "note") {
        textarea.placeholder = "Write something…";
        const sheet = el("div", "pc-note");
        sheet.append(textarea, count);
        body.append(sheet, prints);
      } else {
        textarea.placeholder = "A caption (optional)…";
        body.append(prints, textarea);
      }
    };
    const styles = el("div", "pc-styles");
    const styleBtns = STYLES.map((st) => {
      const b = el("button", undefined, STYLE_LABEL[st]);
      b.type = "button";
      b.dataset.style = st;
      b.classList.toggle("picked", st === style);
      b.addEventListener("click", () => {
        style = st;
        for (const o of styleBtns) o.classList.toggle("picked", o === b);
        error.textContent = "";
        render();
      });
      styles.append(b);
      return b;
    });
    render();

    // announce, send
    const controls = el("div", "pc-controls");
    const announce = el("label", "pc-announce");
    const check = el("input");
    check.type = "checkbox";
    check.checked = initial?.announce ?? true;
    announce.append(check, `Let ${opts.mark.to} know a box is waiting`);
    const send = el("button", "pc-primary");
    const sendLabel = () => (editing ? (send.textContent = "Save changes") : withChest(send, "Leave it here "));
    sendLabel();
    send.id = "pc-send";
    send.type = "button";
    send.addEventListener("click", async () => {
      if (busy) return;
      const text = textarea.value.trim();
      const missing =
        style === "note"
          ? text
            ? null
            : "Write something first"
          : style === "media"
            ? total()
              ? null
              : "Add a photo or video first"
            : text || editor.draft()
              ? null
              : "Write something or add a picture first";
      if (missing) {
        error.textContent = missing;
        return;
      }
      busy = true;
      send.disabled = true;
      send.textContent = "⏳ packing…";
      error.textContent = "";
      try {
        const done = await opts.onSend({
          style,
          text,
          dressing: {
            stamp: fields.stamp.value.trim(),
            place: fields.place.value.trim(),
            to: fields.to.value.trim(),
            from: fields.from.value.trim(),
          },
          picture: style === "postcard" ? editor.draft() : null,
          keep: [...keep],
          files: [...files],
          announce: check.checked,
        });
        if (done) {
          this.guard = null;
          this.close();
          return;
        }
        // back from placing mode: the card is as it was
        busy = false;
        send.disabled = false;
        sendLabel();
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : "Something went wrong";
        busy = false;
        send.disabled = false;
        sendLabel();
      }
    });
    controls.append(announce, send, error);

    const sheet = el("div", "pc-sheet");
    sheet.append(this.closeButton(), styles, body, controls);
    // what the card started as: the defaults for a new box, the box itself when editing
    const start = {
      style: c?.style ?? "postcard",
      text: startText,
      media: keep.length,
      announce: initial?.announce ?? true,
      stamp: (c?.style === "postcard" && c.writing.stamp) || opts.mark.stamp,
      place: (c?.style === "postcard" && c.writing.place) || opts.mark.place,
      to: (c?.style === "postcard" && c.writing.to) || opts.mark.to,
      from: (c?.style === "postcard" && c.writing.from) || opts.mark.from,
    };
    const changed = () =>
      style !== start.style ||
      textarea.value.trim() !== start.text ||
      files.length > 0 ||
      keep.length !== start.media ||
      check.checked !== start.announce ||
      fields.stamp.value.trim() !== start.stamp ||
      fields.place.value.trim() !== start.place ||
      fields.to.value.trim() !== start.to ||
      fields.from.value.trim() !== start.from ||
      editor.dirty();
    this.guard = () => {
      if (busy) return false;
      return !changed() || confirm(editing ? "Drop these changes?" : "Throw this away?");
    };
    this.cleanup = () => {
      this.fileInput.removeEventListener("change", onFiles);
      for (const u of urls) URL.revokeObjectURL(u);
      editor.destroy();
    };
    this.show(sheet);
    textarea.focus();
  }

  /** A box someone left, opened. */
  read(opts: ReadOptions) {
    this.teardown();
    const { box, mark, role } = opts;

    const c = box.contents;
    const prints = el("div", "pc-prints");
    if (c.style !== "postcard") {
      for (const m of c.media) {
        const print = el("div", "pc-print");
        print.append(mediaElement(m, "row"));
        prints.append(print);
      }
    }
    const body = el("div", "pc-body");
    const wordsEl = (words: string) => {
      const text = el("div", "pc-text");
      if (words) text.textContent = words;
      else {
        text.textContent = "(no words, just the pictures)";
        text.classList.add("pc-empty");
      }
      return text;
    };
    if (c.style === "media") {
      prints.classList.add("pc-big");
      body.append(prints);
      if (c.caption) body.append(el("div", "pc-caption-read", c.caption));
    } else if (c.style === "note") {
      const sheet = el("div", "pc-note");
      sheet.append(wordsEl(c.text));
      body.append(sheet, prints);
    } else {
      const card = this.card(mark, wordsEl(c.writing.text));
      let flipper: ReturnType<Postcard["flipCard"]>;
      const face = c.picture ? pictureView(c.picture, () => flipper.setPicture(null)) : null;
      flipper = this.flipCard(card, face, "read", face !== null);
      body.append(flipper.root);
    }

    const controls = el("div", "pc-controls");
    if (role === "finder") {
      const label = el("input", "pc-label");
      label.maxLength = BOX_LABEL_MAX_LEN;
      label.placeholder = "Give it a label (optional)…";
      label.value = box.label ?? "";
      const keep = el("button", "pc-primary");
      withChest(keep, opts.isOwner ? "Pick it up " : "Keep it ");
      keep.id = "pc-keep";
      keep.type = "button";
      keep.addEventListener("click", () => {
        opts.onKeep(label.value.trim());
        this.close();
      });
      // the owner renames a box where it stands: Save label lights up once the label changed
      let save: HTMLButtonElement | null = null;
      const onLabel = opts.onLabel;
      if (onLabel) {
        const saveBtn = el("button", "pc-secondary", "Save label");
        saveBtn.id = "pc-save-label";
        saveBtn.type = "button";
        let saved = box.label ?? "";
        saveBtn.disabled = true;
        label.addEventListener("input", () => (saveBtn.disabled = label.value.trim() === saved));
        saveBtn.addEventListener("click", () => {
          saved = label.value.trim();
          onLabel(saved);
          saveBtn.disabled = true;
        });
        save = saveBtn;
      }
      label.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        // the card may close on keep; the same keystroke must not reach the chat's
        // "Enter focuses the chat box" listener afterwards
        e.preventDefault();
        e.stopPropagation();
        if (save) {
          if (!save.disabled) save.click();
        } else keep.click();
      });
      const leave = el("button", "pc-secondary", "Leave it here");
      leave.id = "pc-leave";
      leave.type = "button";
      leave.addEventListener("click", () => this.close());
      controls.append(label, ...(save ? [save] : []), keep, leave);
    } else {
      if (role === "creator") {
        controls.append(
          el(
            "div",
            "pc-footer",
            box.opened === null ? "Still sealed 🤫" : `Opened by ${opts.openedBy} on ${fmtDate(new Date(box.opened))}`,
          ),
        );
      }
      if (opts.onLift) {
        const lift = el("button", "pc-primary");
        withChest(lift, "Pick it up ");
        lift.id = "pc-lift";
        lift.type = "button";
        lift.addEventListener("click", () => {
          opts.onLift?.();
          this.close();
        });
        controls.append(lift);
      }
      if (opts.onEdit) {
        const change = el("button", "pc-secondary", "Edit");
        change.id = "pc-edit";
        change.type = "button";
        change.addEventListener("click", () => opts.onEdit?.());
        controls.append(change);
      }
      if (opts.onDelete) {
        const take = el("button", "pc-danger", "Take it back");
        take.id = "pc-take";
        take.type = "button";
        take.addEventListener("click", () => {
          if (!confirm(TAKE_BACK_CONFIRM)) return;
          opts.onDelete?.();
          this.close();
        });
        controls.append(take);
      }
      const close = el("button", "pc-secondary", "Close");
      close.type = "button";
      close.addEventListener("click", () => this.close());
      controls.append(close);
    }

    const sheet = el("div", "pc-sheet");
    sheet.append(this.closeButton(), body, controls);
    this.show(sheet);
  }

  private show(sheet: HTMLElement) {
    this.root.replaceChildren(sheet);
    this.root.hidden = false;
    this.root.scrollTop = 0;
    this.onToggle(true);
  }

  private closeButton() {
    const b = el("button", "pc-close", "✕");
    b.id = "pc-close";
    b.type = "button";
    b.title = "Close";
    b.addEventListener("click", () => this.close());
    return b;
  }

  /**
   * The two faces of a postcard on one flip card, plus the pill that names the
   * other face. `picture` null means "no picture side": the pill stays hidden
   * and the card never turns.
   */
  private flipCard(
    writing: HTMLElement,
    picture: HTMLElement | null,
    mode: "compose" | "read",
    startOnPicture: boolean,
  ): { root: HTMLElement; flip(to?: "writing" | "picture"): void; setPicture(face: HTMLElement | null): void } {
    const root = el("div", "pc-flip");
    const flipper = el("div", "pc-flipper");
    const front = el("div", "pc-face pc-face-writing");
    const back = el("div", "pc-face pc-face-picture");
    front.append(writing);
    if (picture) back.append(picture);
    const pill = el("button", "pc-turn");
    pill.type = "button";
    pill.id = "pc-turn";
    flipper.append(front, back);
    root.append(flipper, pill);
    let showing: "writing" | "picture" = "writing";
    const apply = () => {
      flipper.classList.toggle("pc-flipped", showing === "picture");
      front.inert = showing === "picture";
      back.inert = showing === "writing";
      pill.textContent = showing === "writing" ? "picture side ↻" : "writing side ↻";
      pill.hidden = back.childElementCount === 0;
    };
    const flip = (to?: "writing" | "picture") => {
      if (back.childElementCount === 0) return;
      showing = to ?? (showing === "writing" ? "picture" : "writing");
      apply();
    };
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      flip();
    });
    // a click or tap flips; a drag (selecting text) does not, and neither does
    // a press that starts or ends on one of the `skip` elements
    const onTap = (target: HTMLElement, skip: string, onFlip: () => void) => {
      const skipped = (e: PointerEvent) => e.target instanceof Element && e.target.closest(skip) !== null;
      let down: { x: number; y: number } | null = null;
      target.addEventListener("pointerdown", (e) => {
        down = skipped(e) ? null : { x: e.clientX, y: e.clientY };
      });
      target.addEventListener("pointerup", (e) => {
        const start = down;
        down = null;
        if (start && !skipped(e) && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) onFlip();
      });
    };
    if (mode === "read") onTap(root, ".pc-turn", () => flip());
    // the paper of the writing face flips, its inputs do not; the picture face only flips by the pill
    else onTap(front, "input, textarea, button", () => flip("picture"));
    showing = startOnPicture && picture ? "picture" : "writing";
    apply();
    return {
      root,
      flip,
      setPicture: (face) => {
        back.replaceChildren(...(face ? [face] : []));
        if (!face) showing = "writing";
        apply();
      },
    };
  }

  /** The four things a sender may change on the card, prefilled with the defaults or with what they typed before. */
  private cardInputs(mark: Postmark, card: Dressing | null): CardInputs {
    // the names grow and shrink with what is typed, so the dashed underline
    // hugs the word instead of trailing across the card
    const fit = (i: HTMLInputElement) => {
      i.size = Math.max(2, graphemes(i.value).length + 1);
    };
    const make = (cls: string, value: string, max: number, title: string, grows: boolean) => {
      const i = el("input", cls);
      i.value = value;
      i.maxLength = max;
      i.title = title;
      i.spellcheck = false;
      i.autocomplete = "off";
      if (grows) {
        i.addEventListener("input", () => fit(i));
        fit(i);
      }
      return i;
    };
    // the stamp holds one emoji, or two at a smaller size; anything more is dropped as typed
    const stamp = make("pc-stamp-in", card?.stamp || mark.stamp, 16, "Change the stamp", false);
    const trimStamp = () => {
      const g = graphemes(stamp.value);
      if (g.length > BOX_STAMP_MAX) stamp.value = g.slice(0, BOX_STAMP_MAX).join("");
      stamp.classList.toggle("pc-two", graphemes(stamp.value).length > 1);
    };
    stamp.addEventListener("input", trimStamp);
    trimStamp();
    return {
      stamp,
      place: make("pc-place-in", card?.place || mark.place, BOX_PLACE_MAX_LEN, "Change the place", false),
      to: make("pc-to-in", card?.to || mark.to, NAME_MAX_LEN, "Change who it is for", true),
      from: make("pc-from-in", card?.from || mark.from, NAME_MAX_LEN, "Change how you sign", true),
    };
  }

  /**
   * The card itself: the message on the left, the postal dressing on the
   * right. With `edit`, the stamp, the place, the recipient and the signature
   * are inputs the sender types into; the stamp caption and the postmark echo
   * the place as it is typed.
   */
  private card(mark: Postmark, message: HTMLElement, edit?: CardInputs): HTMLElement {
    const card = el("div", "pc-card");
    const msg = el("div", "pc-msg");
    msg.append(message);

    const side = el("div", "pc-side");
    const stamp = el("div", "pc-stamp");
    const caption = el("small", undefined, mark.place);
    const postmarkPlace = el("span", undefined, mark.place);
    const postmark = el("div", "pc-postmark");
    postmark.append(el("span", undefined, fmtDate(mark.date)), postmarkPlace);
    const to = el("div", "pc-to");
    const placeLine = el("div", "pc-line");
    const from = el("div", "pc-from");
    if (edit) {
      card.classList.add("pc-editing");
      stamp.append(edit.stamp, caption);
      to.append("To: ", edit.to);
      placeLine.append(edit.place);
      from.append("from ", edit.from);
      // property handlers, not addEventListener: the card is rebuilt on every
      // style switch and the inputs live on, so listeners must not pile up
      const sync = () => {
        const place = edit.place.value.trim() || mark.place;
        caption.textContent = place;
        postmarkPlace.textContent = place;
      };
      edit.place.oninput = sync;
      sync();
      const greet = () => {
        if (message instanceof HTMLTextAreaElement) message.placeholder = `Dear ${edit.to.value.trim() || mark.to},`;
      };
      edit.to.oninput = greet;
      greet();
    } else {
      const glyph = el("span", undefined, mark.stamp);
      if (graphemes(mark.stamp).length > 1) glyph.classList.add("pc-two");
      stamp.append(glyph, caption);
      to.append("To: ", el("b", undefined, mark.to));
      placeLine.textContent = mark.place;
      from.textContent = `from ${mark.from}`;
    }
    side.append(stamp, postmark, to, el("div", "pc-line"), placeLine, el("div", "pc-line"), from);

    card.append(msg, side);
    return card;
  }
}
