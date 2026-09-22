import { Vector3, type PerspectiveCamera } from "three";
import type { CharacterId } from "../shared/protocol.ts";

/**
 * Chat UI: a text input (Enter to focus, Enter to send, Esc to leave),
 * speech bubbles that hover over the speaking character's head, and a
 * collapsible history panel with an unread badge while minimized.
 */

const EMOJI: Record<CharacterId, string> = { bee: "🐝", donkey: "🫏" };
const HEAD_HEIGHT: Record<CharacterId, number> = { bee: 0.55, donkey: 1.85 };

const now = () => performance.now() / 1000;

class Bubble {
  private el: HTMLDivElement;
  private hideAt = 0;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "bubble";
    this.el.hidden = true;
    container.append(this.el);
  }

  show(text: string) {
    this.el.textContent = text;
    this.el.hidden = false;
    this.hideAt = now() + Math.min(10, 4 + text.length * 0.05);
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

  constructor(onSend: (text: string) => void, onRename: () => void) {
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

    ($("chat-form") as HTMLFormElement).addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      this.input.value = "";
      if (text) onSend(text);
      else this.input.blur();
    });

    $("chat-min").addEventListener("click", () => this.setOpen(false));
    this.openBtn.addEventListener("click", () => this.setOpen(true));
    // the panel is an archive, not the conversation - it starts tucked away
    this.setOpen(false);

    addEventListener("keydown", (e) => {
      if (e.code === "Escape" && document.activeElement === this.input) {
        this.input.blur();
      } else if (
        e.code === "Enter" &&
        document.activeElement !== this.input &&
        !(document.activeElement instanceof HTMLInputElement)
      ) {
        e.preventDefault();
        this.input.focus();
      }
    });
  }

  private setOpen(open: boolean) {
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
    this.unread = 0;
    this.badge.hidden = true;
  }

  /** Append to the history panel; `bubble` also pops it over the head. */
  addMessage(who: "me" | "peer", character: CharacterId, name: string, text: string, bubble = true) {
    const row = document.createElement("div");
    row.className = `msg ${who}`;
    row.textContent = `${EMOJI[character]} ${name}: ${text}`;
    this.log.append(row);
    this.log.scrollTop = this.log.scrollHeight;

    if (bubble) (who === "me" ? this.bubbleMe : this.bubblePeer).show(text);

    if (bubble && who === "peer" && this.panel.hidden) {
      this.unread++;
      this.badge.textContent = String(this.unread);
      this.badge.hidden = false;
    }
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
