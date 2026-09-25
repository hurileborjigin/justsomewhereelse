const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** What a person sees as characters: one emoji counts once, however many code units it takes. */
export function graphemes(v: string): string[] {
  return [...segmenter.segment(v)].map((g) => g.segment);
}

let toastTimer = 0;

/** A short message floating above the action buttons for a few seconds. */
export function toast(text: string) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    t.hidden = true;
  }, 3200);
}

/** Takes the toast away early: what it said no longer applies. */
export function hideToast() {
  const t = document.getElementById("toast");
  if (!t) return;
  clearTimeout(toastTimer);
  t.hidden = true;
}

/** Music sits to the right of Treasures when both panels are open on a wide screen. */
export function placeMusicBeside() {
  const music = document.getElementById("music-panel");
  const treasure = document.getElementById("treasure-panel");
  if (!music || !treasure) return;
  music.classList.toggle("beside", !music.hidden && !treasure.hidden && innerWidth >= 641);
}

/** A small yes or no card. Resolves true when the yes button is chosen. `away` marks a choice that discards something. */
export function ask(message: string, yesLabel: string, noLabel: string, away = false): Promise<boolean> {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "pc-ask";
    const card = document.createElement("div");
    card.className = "pc-ask-card";
    const p = document.createElement("p");
    p.textContent = message;
    const row = document.createElement("div");
    row.className = "pc-ask-actions";
    const no = document.createElement("button");
    no.type = "button";
    no.className = "pc-ask-no";
    no.textContent = noLabel;
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = away ? "pc-ask-yes away" : "pc-ask-yes";
    yes.textContent = yesLabel;
    const finish = (ok: boolean) => {
      root.remove();
      resolve(ok);
    };
    no.addEventListener("click", () => finish(false));
    yes.addEventListener("click", () => finish(true));
    row.append(no, yes);
    card.append(p, row);
    root.append(card);
    document.body.append(root);
  });
}

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
