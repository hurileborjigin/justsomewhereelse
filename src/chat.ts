import { Vector3, type PerspectiveCamera } from "three";
import {
  MEDIA_MAX_BYTES,
  RECALL_WINDOW_MS,
  type CharacterId,
  type ChatEntry,
  type MediaRef,
} from "../shared/protocol.ts";

/**
 * Chat UI: a text input (Enter to focus, Enter to send, Esc to leave),
 * speech bubbles that hover over the speaking character's head, and a
 * collapsible history panel with an unread badge while minimized.
 */

export const EMOJI: Record<CharacterId, string> = { bee: "🐝", donkey: "🫏" };
const HEAD_HEIGHT: Record<CharacterId, number> = { bee: 0.55, donkey: 1.85 };

const now = () => performance.now() / 1000;

/** Full-screen viewer for photos and videos; click anywhere to close. */
export function openLightbox(media: MediaRef) {
  const box = document.getElementById("lightbox");
  if (!box) return;
  box.replaceChildren(mediaElement(media, "full"));
  box.hidden = false;
  box.onclick = () => {
    box.hidden = true;
    box.replaceChildren(); // stops any playing video
  };
}

export function mediaElement(media: MediaRef, mode: "full" | "bubble" | "row" = "row"): HTMLElement {
  if (media.kind === "video") {
    const v = document.createElement("video");
    v.src = media.url;
    v.playsInline = true;
    v.muted = mode !== "full";
    if (mode === "full") {
      v.controls = true;
      v.autoplay = true;
    } else if (mode === "bubble") {
      v.autoplay = true;
      v.loop = true;
    } else {
      v.preload = "metadata"; // archive: show the first frame, play on click
    }
    if (mode !== "full") {
      v.addEventListener("click", (e) => {
        e.stopPropagation();
        openLightbox(media);
      });
    }
    return v;
  }
  const img = document.createElement("img");
  img.src = media.url;
  if (mode !== "full") {
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      openLightbox(media);
    });
  }
  return img;
}

/** Upload a photo/video; big photos are downscaled client-side first. */
export async function uploadMedia(file: File): Promise<MediaRef> {
  let blob: Blob = file;
  let type = file.type;
  if (type.startsWith("image/") && type !== "image/gif" && file.size > 400 * 1024) {
    blob = await downscaleImage(file);
    type = "image/jpeg";
  }
  if (!type.startsWith("image/") && !type.startsWith("video/")) {
    throw new Error("Only photos and videos can be sent");
  }
  if (blob.size > MEDIA_MAX_BYTES) {
    throw new Error("That file is too big (max 25 MB)");
  }
  let pass = "";
  try {
    pass = JSON.parse(localStorage.getItem("tp-auth") ?? "{}").pass ?? "";
  } catch {
    /* no stored auth */
  }
  const res = await fetch("/media", {
    method: "POST",
    headers: { "content-type": type, "x-planet-pass": pass },
    body: blob,
  });
  if (!res.ok) throw new Error(`Upload failed (${await res.text()})`);
  return (await res.json()) as MediaRef;
}

async function downscaleImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process the image"))), "image/jpeg", 0.85),
  );
}

class Bubble {
  private el: HTMLDivElement;
  private hideAt = 0;
  private msgId: number | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "bubble";
    this.el.hidden = true;
    container.append(this.el);
  }

  show(id: number, text: string, media?: MediaRef) {
    this.msgId = id;
    this.el.replaceChildren();
    if (text) this.el.append(document.createTextNode(text));
    if (media) this.el.append(mediaElement(media, "bubble"));
    this.el.hidden = false;
    this.hideAt = now() + (media ? 20 : Math.min(18, 8 + text.length * 0.08));
  }

  hideIf(id: number) {
    if (this.msgId === id) this.el.hidden = true;
  }

  /** Reposition on screen; `screen` is null when the anchor isn't visible. */
  update(screen: { x: number; y: number } | null) {
    if (!this.el.hidden && now() > this.hideAt) this.el.hidden = true;
    if (this.el.hidden) return;
    if (!screen) {
      this.el.style.opacity = "0";
      return;
    }
    this.el.style.opacity = "1";
    this.el.style.left = `${screen.x}px`;
    this.el.style.top = `${screen.y}px`;
  }
}

const _anchor = new Vector3();
const _toAnchor = new Vector3();
const _camDir = new Vector3();

/** Small floating label above a character's head; yours carries the ✏️. */
class NameTag {
  private el: HTMLDivElement;
  private text: HTMLSpanElement;

  constructor(container: HTMLElement, onEdit?: () => void) {
    this.el = document.createElement("div");
    this.el.className = "name-tag";
    this.text = document.createElement("span");
    this.el.append(this.text);
    if (onEdit) {
      const btn = document.createElement("button");
      btn.textContent = "✏️";
      btn.title = "Change your name";
      btn.addEventListener("click", onEdit);
      this.el.append(btn);
    }
    this.el.style.opacity = "0";
    container.append(this.el);
  }

  set(name: string) {
    this.text.textContent = name;
  }

  update(screen: { x: number; y: number } | null) {
    if (!screen) {
      this.el.style.opacity = "0";
      return;
    }
    this.el.style.opacity = "1";
    this.el.style.left = `${screen.x}px`;
    this.el.style.top = `${screen.y}px`;
  }
}

export class Chat {
  private input: HTMLInputElement;
  private log: HTMLElement;
  private panel: HTMLElement;
  private openBtn: HTMLButtonElement;
  private badge: HTMLElement;
  private unread = 0;
  private bubbleMe: Bubble;
  private bubblePeer: Bubble;
  private tagMe: NameTag;
  private tagPeer: NameTag;
  private rows = new Map<number, HTMLDivElement>();
  private pendingFile: File | null = null;
  private pendingUrl: string | null = null;
  private onRecall: (id: number) => void;

  constructor(
    onSend: (text: string, media?: MediaRef) => void,
    onRename: () => void,
    onRecall: (id: number) => void,
  ) {
    this.onRecall = onRecall;
    const $ = (id: string) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`missing #${id}`);
      return el;
    };
    this.input = $("chat-input") as HTMLInputElement;
    this.log = $("chat-log");
    this.panel = $("chat-panel");
    this.openBtn = $("chat-open") as HTMLButtonElement;
    this.badge = $("chat-badge");
    const bubbles = $("bubbles");
    this.bubbleMe = new Bubble(bubbles);
    this.bubblePeer = new Bubble(bubbles);
    this.tagMe = new NameTag(bubbles, onRename);
    this.tagPeer = new NameTag(bubbles);

    const sendBtn = $("chat-send") as HTMLButtonElement;
    const attachBtn = $("chat-attach") as HTMLButtonElement;
    const setSending = (busy: boolean) => {
      sendBtn.disabled = busy;
      attachBtn.disabled = busy;
      sendBtn.textContent = busy ? "⏳" : "Send";
    };

    ($("chat-form") as HTMLFormElement).addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (this.pendingFile) {
        // WhatsApp-style: the staged photo/video goes out only now, with the
        // typed text as its caption
        setSending(true);
        try {
          const media = await uploadMedia(this.pendingFile);
          this.clearPending();
          this.input.value = "";
          onSend(text, media);
        } catch (err) {
          alert(err instanceof Error ? err.message : "Upload failed");
        } finally {
          setSending(false);
        }
      } else if (text) {
        this.input.value = "";
        onSend(text);
      } else {
        this.input.blur();
      }
    });

    $("chat-min").addEventListener("click", () => this.setOpen(false));
    this.openBtn.addEventListener("click", () => this.setOpen(true));
    // the panel is an archive, not the conversation - it starts tucked away
    this.setOpen(false);

    // photo & video attachments: picking a file only STAGES it as a preview
    const fileInput = $("chat-file") as HTMLInputElement;
    attachBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
        alert("Only photos and videos can be sent");
        return;
      }
      this.setPending(file);
      this.input.focus();
    });
    $("chat-preview-x").addEventListener("click", () => this.clearPending());

    addEventListener("keydown", (e) => {
      if (e.code === "Escape" && document.activeElement === this.input) {
        this.input.blur();
      } else if (
        e.code === "Enter" &&
        document.activeElement !== this.input &&
        !isTypingElement(document.activeElement) &&
        document.getElementById("postcard")?.hidden !== false
      ) {
        e.preventDefault();
        this.input.focus();
      }
    });
  }

  private setPending(file: File) {
    this.clearPending();
    this.pendingFile = file;
    this.pendingUrl = URL.createObjectURL(file);
    const thumb = document.getElementById("chat-preview-thumb")!;
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.src = this.pendingUrl;
      v.muted = true;
      v.playsInline = true;
      thumb.replaceChildren(v);
    } else {
      const img = document.createElement("img");
      img.src = this.pendingUrl;
      thumb.replaceChildren(img);
    }
    document.getElementById("chat-preview")!.hidden = false;
    this.input.placeholder = "Add a caption… (Enter to send)";
  }

  private clearPending() {
    if (this.pendingUrl) URL.revokeObjectURL(this.pendingUrl);
    this.pendingFile = null;
    this.pendingUrl = null;
    document.getElementById("chat-preview-thumb")!.replaceChildren();
    document.getElementById("chat-preview")!.hidden = true;
    this.input.placeholder = "Say something… (Enter)";
  }

  setOpen(open: boolean) {
    this.panel.hidden = !open;
    this.openBtn.hidden = open;
    if (open) {
      this.unread = 0;
      this.badge.hidden = true;
      this.log.scrollTop = this.log.scrollHeight;
    }
  }

  /** Wipe the history panel (before replaying persisted history). */
  clear() {
    this.log.replaceChildren();
    this.rows.clear();
    this.unread = 0;
    this.badge.hidden = true;
  }

  /** Append to the history panel; `bubble` also pops it over the head. */
  addMessage(who: "me" | "peer", character: CharacterId, name: string, entry: ChatEntry, bubble = true) {
    const row = document.createElement("div");
    row.className = `msg ${who}`;
    row.textContent = `${EMOJI[character]} ${name}:${entry.text ? ` ${entry.text}` : ""}`;
    if (entry.media) row.append(mediaElement(entry.media));
    if (who === "me" && Date.now() - entry.ts < RECALL_WINDOW_MS) {
      const btn = document.createElement("button");
      btn.className = "recall";
      btn.textContent = "↩";
      btn.title = "Recall this message";
      btn.addEventListener("click", () => {
        if (confirm("Recall this message? It will disappear for both of you.")) {
          this.onRecall(entry.id);
        }
      });
      row.append(btn);
    }
    this.rows.set(entry.id, row);
    this.log.append(row);
    this.log.scrollTop = this.log.scrollHeight;

    if (bubble) (who === "me" ? this.bubbleMe : this.bubblePeer).show(entry.id, entry.text, entry.media);

    if (bubble && who === "peer" && this.panel.hidden) {
      this.unread++;
      this.badge.textContent = String(this.unread);
      this.badge.hidden = false;
    }
  }

  /** A message was recalled: remove it everywhere. */
  removeMessage(id: number) {
    this.rows.get(id)?.remove();
    this.rows.delete(id);
    this.bubbleMe.hideIf(id);
    this.bubblePeer.hideIf(id);
  }

  /** The two floating labels; call whenever names change. */
  setNames(me: string, peer: string) {
    this.tagMe.set(me);
    this.tagPeer.set(peer);
  }

  /** Called every frame to keep bubbles and name tags glued above heads. */
  update(
    camera: PerspectiveCamera,
    mePos: Vector3,
    meChar: CharacterId,
    peerPos: Vector3,
    peerChar: CharacterId,
    peerPresent: boolean,
  ) {
    const me = project(camera, mePos, HEAD_HEIGHT[meChar]);
    const peer = peerPresent ? project(camera, peerPos, HEAD_HEIGHT[peerChar]) : null;
    this.bubbleMe.update(me);
    this.bubblePeer.update(peer);
    this.tagMe.update(me);
    this.tagPeer.update(peer);
  }
}

/** Inputs and text areas anywhere (chat box, postcard) must keep their Enter key. */
function isTypingElement(el: Element | null): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

function project(
  camera: PerspectiveCamera,
  pos: Vector3,
  headHeight: number,
): { x: number; y: number } | null {
  _anchor.copy(pos).addScaledVector(_toAnchor.copy(pos).normalize(), headHeight);
  _toAnchor.copy(_anchor).sub(camera.position);
  if (_toAnchor.dot(camera.getWorldDirection(_camDir)) <= 0) return null; // behind the camera
  _anchor.project(camera);
  return {
    x: (_anchor.x * 0.5 + 0.5) * innerWidth,
    y: (-_anchor.y * 0.5 + 0.5) * innerHeight,
  };
}
