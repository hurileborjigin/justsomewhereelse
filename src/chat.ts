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

export class Chat {
  private input: HTMLInputElement;
  private log: HTMLElement;
  private panel: HTMLElement;
  private openBtn: HTMLButtonElement;
  private badge: HTMLElement;
  private unread = 0;
  private bubbleMe: Bubble;
  private bubblePeer: Bubble;

  constructor(onSend: (text: string) => void) {
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

    ($("chat-form") as HTMLFormElement).addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      this.input.value = "";
      if (text) onSend(text);
      else this.input.blur();
    });

    $("chat-min").addEventListener("click", () => this.setOpen(false));
    this.openBtn.addEventListener("click", () => this.setOpen(true));

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

  /** Called every frame to keep bubbles glued above the characters' heads. */
  update(
    camera: PerspectiveCamera,
    mePos: Vector3,
    meChar: CharacterId,
    peerPos: Vector3,
    peerChar: CharacterId,
    peerPresent: boolean,
  ) {
    this.bubbleMe.update(project(camera, mePos, HEAD_HEIGHT[meChar]));
    this.bubblePeer.update(peerPresent ? project(camera, peerPos, HEAD_HEIGHT[peerChar]) : null);
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
