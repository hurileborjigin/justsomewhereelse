const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** What a person sees as characters: one emoji counts once, however many code units it takes. */
export function graphemes(v: string): string[] {
  return [...segmenter.segment(v)].map((g) => g.segment);
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
