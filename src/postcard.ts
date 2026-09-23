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
  type BoxCard,
  type BoxSize,
  type BoxStyle,
} from "../shared/protocol.ts";
import { mediaElement } from "./chat.ts";

/** The postcard's dressing as it should read: the stamp picture, the names, the place, the date. */
export type Postmark = { stamp: string; from: string; to: string; place: string; date: Date };

export type Draft = {
  style: BoxStyle;
  /** The dressing the sender typed (postcards only); empty fields mean "the default". */
  card: BoxCard | null;
  text: string;
  files: File[];
  size: BoxSize;
  announce: boolean;
};

export type ComposeOptions = {
  mark: Postmark;
  /** Which sizes fit where the player stands right now. */
  fits: Record<BoxSize, boolean>;
  /** Resolve once the box stands in the world; reject with a message to show. */
  onSend: (draft: Draft) => Promise<void>;
};

export type ReadOptions = {
  box: Box; // with text and media present
  mark: Postmark;
  /** finder: may keep it. creator: sees the sealed/opened footer. owner: reading from the panel. */
  role: "finder" | "creator" | "owner";
  openedBy: string; // the partner's name, for the creator's footer
  /** The reader already owns it (it stands where they put it): "Pick it up" rather than "Keep it". */
  isOwner: boolean;
  onKeep: (label: string) => void;
  /** Present only when the reader may take the box back: their own box, still sealed. */
  onDelete?: () => void;
};

type CardInputs = {
  stamp: HTMLInputElement;
  place: HTMLInputElement;
  to: HTMLInputElement;
  from: HTMLInputElement;
};

const ORDER: BoxSize[] = ["s", "m", "l"];
const SIZE_LABEL: Record<BoxSize, string> = { s: "S · 1 square", m: "M · 4 squares", l: "L · 12 squares" };
const STYLES: BoxStyle[] = ["postcard", "note", "media"];
const STYLE_LABEL: Record<BoxStyle, string> = { postcard: "Postcard", note: "Note", media: "Just photos" };
const SVG_NS = "http://www.w3.org/2000/svg";

const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** What a person sees as characters: one emoji counts once, however many code units it takes. */
export function graphemes(v: string): string[] {
  return [...segmenter.segment(v)].map((g) => g.segment);
}

export const TAKE_BACK_CONFIRM = "Take this box back? It disappears for both of you.";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

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

  constructor(onToggle: (open: boolean) => void) {
    this.onToggle = onToggle;
    const root = document.getElementById("postcard");
    const file = document.getElementById("pc-file");
    if (!root || !(file instanceof HTMLInputElement)) throw new Error("missing #postcard / #pc-file");
    this.root = root;
    this.fileInput = file;
    addEventListener("keydown", (e) => {
      if (e.code === "Escape" && this.isOpen) this.close();
    });
    // a click on the dark backdrop (not on the sheet) closes too
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  close() {
    if (this.root.hidden) return;
    if (this.guard && !this.guard()) return;
    this.teardown();
    this.root.hidden = true;
    this.root.replaceChildren();
    this.onToggle(false);
  }

  /** Releases a previous card's listeners and object URLs before a new one installs its own. */
  private teardown() {
    this.cleanup?.();
    this.cleanup = null;
    this.guard = null;
  }

  /** A new box to fill and leave here. */
  compose(opts: ComposeOptions) {
    this.teardown();
    const files: File[] = [];
    const urls: string[] = [];
    let size: BoxSize | null = ORDER.find((s) => opts.fits[s]) ?? null;
    let style: BoxStyle = "postcard";
    let busy = false;

    const error = el("div", "pc-error");
    // one text field travels between the three layouts, so switching keeps the words
    const textarea = el("textarea", "pc-text");
    textarea.maxLength = BOX_TEXT_MAX_LEN;
    const count = el("span", "pc-count", `0 / ${BOX_TEXT_MAX_LEN}`);
    textarea.addEventListener("input", () => {
      count.textContent = `${textarea.value.length} / ${BOX_TEXT_MAX_LEN}`;
    });
    const fields = this.cardInputs(opts.mark);

    // photos & videos as instant-camera prints, staged until "Leave it here"
    const prints = el("div", "pc-prints");
    const addBtn = el("button", "pc-add", "＋ add photos or videos");
    addBtn.type = "button";
    addBtn.addEventListener("click", () => this.fileInput.click());
    const renderPrints = () => {
      prints.replaceChildren();
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
      addBtn.hidden = files.length >= BOX_MEDIA_MAX;
      prints.append(addBtn);
    };
    const onFiles = () => {
      for (const f of this.fileInput.files ?? []) {
        if (files.length >= BOX_MEDIA_MAX) {
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
      if (style === "postcard") {
        textarea.placeholder = `Dear ${fields.to.value.trim() || opts.mark.to},`;
        const card = this.card(opts.mark, textarea, fields);
        card.querySelector(".pc-msg")!.append(count);
        body.append(card, prints);
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

    // size, announce, send
    const controls = el("div", "pc-controls");
    const sizes = el("div", "pc-sizes");
    const sizeBtns = ORDER.map((s) => {
      const b = el("button", undefined, SIZE_LABEL[s]);
      b.type = "button";
      b.dataset.size = s;
      b.disabled = !opts.fits[s];
      if (!opts.fits[s]) b.title = "no room here";
      b.classList.toggle("picked", size === s);
      b.addEventListener("click", () => {
        size = s;
        for (const o of sizeBtns) o.classList.toggle("picked", o === b);
      });
      sizes.append(b);
      return b;
    });
    // the per-button "no room here" tooltip never shows on a phone
    const hint = ORDER.every((s) => opts.fits[s])
      ? null
      : el("span", "pc-hint", "Sizes greyed out do not fit where you stand");
    const announce = el("label", "pc-announce");
    const check = el("input");
    check.type = "checkbox";
    check.checked = true;
    announce.append(check, `Let ${opts.mark.to} know a box is waiting`);
    const send = el("button", "pc-primary");
    withChest(send, "Leave it here ");
    send.id = "pc-send";
    send.type = "button";
    if (!size) {
      send.disabled = true;
      error.textContent = "No room for a box here. Step somewhere more open.";
    }
    send.addEventListener("click", async () => {
      if (busy || !size) return;
      const text = textarea.value.trim();
      const missing =
        style === "note"
          ? text
            ? null
            : "Write something first"
          : style === "media"
            ? files.length
              ? null
              : "Add a photo or video first"
            : text || files.length
              ? null
              : "Write something or add a photo first";
      if (missing) {
        error.textContent = missing;
        return;
      }
      busy = true;
      send.disabled = true;
      send.textContent = "⏳ packing…";
      error.textContent = "";
      const card: BoxCard | null =
        style === "postcard"
          ? {
              stamp: fields.stamp.value.trim(),
              place: fields.place.value.trim(),
              to: fields.to.value.trim(),
              from: fields.from.value.trim(),
            }
          : null;
      try {
        await opts.onSend({ style, card, text, files: [...files], size, announce: check.checked });
        this.guard = null;
        this.close();
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : "Something went wrong";
        busy = false;
        send.disabled = false;
        withChest(send, "Leave it here ");
      }
    });
    controls.append(sizes, ...(hint ? [hint] : []), announce, send, error);

    const sheet = el("div", "pc-sheet");
    sheet.append(this.closeButton(), styles, body, controls);
    const dressed = () =>
      fields.stamp.value.trim() !== opts.mark.stamp ||
      fields.place.value.trim() !== opts.mark.place ||
      fields.to.value.trim() !== opts.mark.to ||
      fields.from.value.trim() !== opts.mark.from;
    this.guard = () => {
      if (busy) return false;
      return (!textarea.value.trim() && files.length === 0 && !dressed()) || confirm("Throw this away?");
    };
    this.cleanup = () => {
      this.fileInput.removeEventListener("change", onFiles);
      for (const u of urls) URL.revokeObjectURL(u);
    };
    this.show(sheet);
    textarea.focus();
  }

  /** A box someone left, opened. */
  read(opts: ReadOptions) {
    this.teardown();
    const { box, mark, role } = opts;

    const prints = el("div", "pc-prints");
    for (const m of box.media ?? []) {
      const print = el("div", "pc-print");
      print.append(mediaElement(m, "row"));
      prints.append(print);
    }
    const body = el("div", "pc-body");
    if (box.style === "media") {
      prints.classList.add("pc-big");
      body.append(prints);
      if (box.text) body.append(el("div", "pc-caption-read", box.text));
    } else {
      const text = el("div", "pc-text");
      if (box.text) text.textContent = box.text;
      else {
        text.textContent = "(no words, just the pictures)";
        text.classList.add("pc-empty");
      }
      if (box.style === "note") {
        const sheet = el("div", "pc-note");
        sheet.append(text);
        body.append(sheet, prints);
      } else {
        body.append(this.card(mark, text), prints);
      }
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
      label.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        // the card closes on keep; the same keystroke must not reach the chat's
        // "Enter focuses the chat box" listener afterwards
        e.preventDefault();
        e.stopPropagation();
        keep.click();
      });
      const leave = el("button", "pc-secondary", "Leave it here");
      leave.id = "pc-leave";
      leave.type = "button";
      leave.addEventListener("click", () => this.close());
      controls.append(label, keep, leave);
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

  /** The four things a sender may change on the card, prefilled with the defaults. */
  private cardInputs(mark: Postmark): CardInputs {
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
    const stamp = make("pc-stamp-in", mark.stamp, 16, "Change the stamp", false);
    const trimStamp = () => {
      const g = graphemes(stamp.value);
      if (g.length > BOX_STAMP_MAX) stamp.value = g.slice(0, BOX_STAMP_MAX).join("");
      stamp.classList.toggle("pc-two", graphemes(stamp.value).length > 1);
    };
    stamp.addEventListener("input", trimStamp);
    trimStamp();
    return {
      stamp,
      place: make("pc-place-in", mark.place, BOX_PLACE_MAX_LEN, "Change the place", false),
      to: make("pc-to-in", mark.to, NAME_MAX_LEN, "Change who it is for", true),
      from: make("pc-from-in", mark.from, NAME_MAX_LEN, "Change how you sign", true),
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
