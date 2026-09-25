// Synced lyrics for the sky. Spotify does not offer them, so we ask LRCLIB
// by title, artist and duration. Each player chooses whether to see them.

import type { Track } from "../shared/protocol.ts";

const KEY = "haven-lyrics";

export type LyricLine = { at: number; text: string };

const $ = (id: string) => document.getElementById(id)!;

export class SkyLyrics {
  private lines: LyricLine[] = [];
  private forUri = "";
  private shown = -2;
  on = localStorage.getItem(KEY) === "1";
  private button: () => HTMLElement;

  constructor(button: () => HTMLElement) {
    this.button = button;
    this.button().addEventListener("click", () => {
      this.on = !this.on;
      localStorage.setItem(KEY, this.on ? "1" : "0");
      this.paintButton();
      if (!this.on) this.hide();
    });
    this.paintButton();
  }

  paintButton() {
    const button = this.button();
    button.classList.toggle("on", this.on);
    button.setAttribute("aria-pressed", this.on ? "true" : "false");
  }

  /** Position is milliseconds into the current track. Sky is false indoors. */
  update(track: Track | null, positionMs: number, sky: boolean) {
    const root = $("sky-lyrics");
    if (!this.on || !sky || !track) {
      this.hide();
      return;
    }
    if (track.uri !== this.forUri) {
      this.forUri = track.uri;
      this.lines = [];
      this.shown = -2;
      void this.load(track);
    }
    const index = this.indexAt(positionMs);
    if (this.lines.length === 0) {
      this.hide();
      return;
    }
    if (index !== this.shown) {
      this.shown = index;
      $("sky-lyrics-prev").textContent = index > 0 ? this.lines[index - 1].text : "";
      $("sky-lyrics-line").textContent = index >= 0 ? this.lines[index].text : "";
      $("sky-lyrics-next").textContent = this.lines[index + 1]?.text ?? "";
    }
    root.hidden = false;
  }

  private hide() {
    $("sky-lyrics").hidden = true;
    this.shown = -2;
  }

  /** -1 before the first line, otherwise the line that should be in the middle. */
  private indexAt(positionMs: number): number {
    let index = -1;
    for (let n = 0; n < this.lines.length; n++) {
      if (this.lines[n].at <= positionMs) index = n;
      else break;
    }
    return index;
  }

  private async load(track: Track) {
    const uri = track.uri;
    const q = new URLSearchParams({ track_name: track.name, artist_name: track.artists });
    let rows: { duration?: number; syncedLyrics?: string | null; plainLyrics?: string | null }[] = [];
    try {
      const res = await fetch(`https://lrclib.net/api/search?${q}`);
      if (!res.ok) return;
      rows = await res.json();
    } catch {
      return;
    }
    if (this.forUri !== uri) return;
    const duration = track.durationMs / 1000;
    const best = rows
      .filter((r) => r.syncedLyrics || r.plainLyrics)
      .sort((a, b) => Math.abs((a.duration ?? duration) - duration) - Math.abs((b.duration ?? duration) - duration))[0];
    if (!best) return;
    this.lines = best.syncedLyrics ? parseLrc(best.syncedLyrics) : plainLines(best.plainLyrics ?? "", track.durationMs);
  }
}

function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const row of text.split("\n")) {
    const stamps = [...row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (stamps.length === 0) continue;
    const words = row.replace(/\[[^\]]+\]/g, "").replace(/<[^>]+>/g, "").trim();
    if (!words) continue;
    for (const stamp of stamps) {
      lines.push({ at: (Number(stamp[1]) * 60 + Number(stamp[2])) * 1000, text: words });
    }
  }
  lines.sort((a, b) => a.at - b.at);
  return lines;
}

/** No timestamps: spread the lines evenly across the song. */
function plainLines(text: string, durationMs: number): LyricLine[] {
  const rows = text.split("\n").map((s) => s.trim()).filter(Boolean);
  if (rows.length === 0) return [];
  const step = durationMs / rows.length;
  return rows.map((text, i) => ({ at: i * step, text }));
}
