import "@fontsource/caveat/500.css";
import {
  BOX_LABEL_MAX_LEN,
  BOX_MEDIA_MAX,
  BOX_TEXT_MAX_LEN,
  MEDIA_MAX_BYTES,
  type Box,
  type BoxSize,
  type CharacterId,
} from "../shared/protocol.ts";
import { EMOJI, mediaElement } from "./chat.ts";

/** Who wrote the card, who it is for, and where and when it was left. */
export type Postmark = { from: string; fromChar: CharacterId; to: string; place: string; date: Date };

export type Draft = { text: string; files: File[]; size: BoxSize; announce: boolean };

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
  onKeep: (label: string) => void;
};

const ORDER: BoxSize[] = ["s", "m", "l"];
const SIZE_LABEL: Record<BoxSize, string> = { s: "S · 1 square", m: "M · 4 squares", l: "L · 12 squares" };

const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

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

/**
 * The postcard dialog: one overlay (#postcard) rebuilt for every card.
 * Compose mode writes straight onto the card; reading mode shows a card
 * someone left. Knows nothing about the network - decisions come back through
 * the callbacks in the options.
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
    this.guard = null;
    this.cleanup?.();
    this.cleanup = null;
    this.root.hidden = true;
    this.root.replaceChildren();
    this.onToggle(false);
  }

  /** A new card to write and leave here. */
  compose(opts: ComposeOptions) {
    const files: File[] = [];
    const urls: string[] = [];
    let size: BoxSize | null = ORDER.find((s) => opts.fits[s]) ?? null;
    let busy = false;

    const error = el("div", "pc-error");
    const textarea = el("textarea", "pc-text");
    textarea.maxLength = BOX_TEXT_MAX_LEN;
    textarea.placeholder = `Dear ${opts.mark.to},`;
    const count = el("span", "pc-count", `0 / ${BOX_TEXT_MAX_LEN}`);
    textarea.addEventListener("input", () => {
      count.textContent = `${textarea.value.length} / ${BOX_TEXT_MAX_LEN}`;
    });
    const card = this.card(opts.mark, textarea);
    card.querySelector(".pc-msg")!.append(count);

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
          error.textContent = "That video is too big (max 25 MB)";
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
    const announce = el("label", "pc-announce");
    const check = el("input");
    check.type = "checkbox";
    check.checked = true;
    announce.append(check, `Let ${opts.mark.to} know a box is waiting`);
    const send = el("button", "pc-primary", "Leave it here 🎁");
    send.id = "pc-send";
    send.type = "button";
    if (!size) {
      send.disabled = true;
      error.textContent = "No room for a box here. Step somewhere more open.";
    }
    send.addEventListener("click", async () => {
      if (busy || !size) return;
      const text = textarea.value.trim();
      if (!text && files.length === 0) {
        error.textContent = "Write something or add a photo first";
        return;
      }
      busy = true;
      send.disabled = true;
      send.textContent = "⏳ packing…";
      error.textContent = "";
      try {
        await opts.onSend({ text, files: [...files], size, announce: check.checked });
        this.guard = null;
        this.close();
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : "Something went wrong";
        busy = false;
        send.disabled = false;
        send.textContent = "Leave it here 🎁";
      }
    });
    controls.append(sizes, announce, send, error);

    const sheet = el("div", "pc-sheet");
    sheet.append(this.closeButton(), card, prints, controls);
    this.guard = () => (!textarea.value.trim() && files.length === 0) || confirm("Throw this postcard away?");
    this.cleanup = () => {
      this.fileInput.removeEventListener("change", onFiles);
      for (const u of urls) URL.revokeObjectURL(u);
    };
    this.show(sheet);
    textarea.focus();
  }

  /** A card someone left, opened. */
  read(opts: ReadOptions) {
    const { box, mark, role } = opts;
    const text = el("div", "pc-text");
    if (box.text) text.textContent = box.text;
    else {
      text.textContent = "(no words, just the pictures)";
      text.classList.add("pc-empty");
    }
    const card = this.card(mark, text);

    const prints = el("div", "pc-prints");
    for (const m of box.media ?? []) {
      const print = el("div", "pc-print");
      print.append(mediaElement(m, "row"));
      prints.append(print);
    }

    const controls = el("div", "pc-controls");
    if (role === "finder") {
      const label = el("input", "pc-label");
      label.maxLength = BOX_LABEL_MAX_LEN;
      label.placeholder = "Give it a label (optional)…";
      const keep = el("button", "pc-primary", "Keep it 🎁");
      keep.id = "pc-keep";
      keep.type = "button";
      keep.addEventListener("click", () => {
        opts.onKeep(label.value.trim());
        this.close();
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
      const close = el("button", "pc-secondary", "Close");
      close.type = "button";
      close.addEventListener("click", () => this.close());
      controls.append(close);
    }

    const sheet = el("div", "pc-sheet");
    sheet.append(this.closeButton(), card, prints, controls);
    this.guard = null;
    this.cleanup = null;
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

  /** The card itself: the message on the left, the postal dressing on the right. */
  private card(mark: Postmark, message: HTMLElement): HTMLElement {
    const card = el("div", "pc-card");
    const msg = el("div", "pc-msg");
    msg.append(message);

    const side = el("div", "pc-side");
    const stamp = el("div", "pc-stamp");
    stamp.append(el("span", undefined, EMOJI[mark.fromChar]), el("small", undefined, "TINY PLANET"));
    const postmark = el("div", "pc-postmark");
    postmark.append(el("span", undefined, fmtDate(mark.date)), el("span", undefined, mark.place));
    const to = el("div", "pc-to");
    to.append("To: ", el("b", undefined, mark.to));
    const from = el("div", "pc-from", `from ${mark.from}`);
    side.append(stamp, postmark, to, el("div", "pc-line"), el("div", "pc-line", mark.place), el("div", "pc-line"), from);

    card.append(msg, side);
    return card;
  }
}
