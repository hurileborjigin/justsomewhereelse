/** Keyboard state -> {x, y} in {-1, 0, 1}. WASD and arrow keys both work. */
export class Input {
  x = 0;
  y = 0;
  private keys = new Set<string>();

  constructor() {
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      // don't walk while the player is typing in the chat box
      if (isTyping(e.target)) return;
      this.keys.add(e.code);
      this.recompute();
    });
    addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      this.recompute();
    });
    // a text field grabbing focus mid-walk would otherwise leave a key stuck down
    addEventListener("focusin", (e) => {
      if (isTyping(e.target)) {
        this.keys.clear();
        this.recompute();
      }
    });
    addEventListener("blur", () => {
      this.keys.clear();
      this.recompute();
    });
  }

  private recompute() {
    const k = this.keys;
    const up = k.has("KeyW") || k.has("ArrowUp") ? 1 : 0;
    const down = k.has("KeyS") || k.has("ArrowDown") ? 1 : 0;
    const right = k.has("KeyD") || k.has("ArrowRight") ? 1 : 0;
    const left = k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0;
    this.y = up - down;
    this.x = right - left;
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
