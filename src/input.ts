/** Keyboard + touch state -> {x, y} in {-1, 0, 1} plus `fast`.
 * WASD/arrows and the mobile joystick both feed in; keyboard wins when both
 * are active. Diagonals come from holding two keys or dragging diagonally. */
export class Input {
  x = 0;
  y = 0;
  fast = false;
  private keys = new Set<string>();
  private touchX = 0;
  private touchY = 0;
  private touchFast = false;

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

  /** Fed by the on-screen joystick (see touch.ts). */
  setTouch(x: number, y: number, fast: boolean) {
    this.touchX = x;
    this.touchY = y;
    this.touchFast = fast;
    this.recompute();
  }

  private recompute() {
    const k = this.keys;
    const up = k.has("KeyW") || k.has("ArrowUp") ? 1 : 0;
    const down = k.has("KeyS") || k.has("ArrowDown") ? 1 : 0;
    const right = k.has("KeyD") || k.has("ArrowRight") ? 1 : 0;
    const left = k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0;
    const ky = up - down;
    const kx = right - left;
    const kfast =
      k.has("ShiftLeft") || k.has("ShiftRight") || k.has("ControlLeft") || k.has("ControlRight");
    this.x = kx !== 0 ? kx : this.touchX;
    this.y = ky !== 0 ? ky : this.touchY;
    this.fast = kfast || this.touchFast;
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
