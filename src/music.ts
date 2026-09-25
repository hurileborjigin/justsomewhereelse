// The music panel and the Haven Spotify speaker. The server owns the session.

import type { Catalog, MusicView, SpotifyDevice, Track } from "../shared/protocol.ts";
import { placeMusicBeside } from "./dom.ts";
import { SkyLyrics } from "./lyrics.ts";
import type { Net } from "./net.ts";

type SpotifyPlayer = {
  connect: () => Promise<boolean>;
  activateElement: () => Promise<void>;
  addListener: (name: string, cb: (data: { device_id?: string; paused?: boolean; position?: number; track_window?: { current_track?: { uri?: string } } }) => void) => void;
  getCurrentState: () => Promise<{
    paused: boolean;
    position: number;
    track_window: {
      current_track: {
        uri: string;
        name?: string;
        duration_ms?: number;
        artists?: { name?: string }[];
        album?: { images?: { url?: string }[] };
      };
    };
  } | null>;
  setVolume: (v: number) => Promise<void>;
};

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: { Player: new (opts: { name: string; getOAuthToken: (cb: (token: string) => void) => void; volume: number }) => SpotifyPlayer };
  }
}

const $ = (id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
};

export class Music {
  private view: MusicView | null = null;
  private receivedAt = 0;
  private tokenWait: ((token: string) => void) | null = null;
  private player: SpotifyPlayer | null = null;
  private reportAcc = 0;
  private sampleAcc = 0;
  /** Where the speaker actually is, so the sky line follows the song. */
  private heardPos = 0;
  private heardAt = 0;
  private heardPaused = true;
  private heard = false;
  private lyrics = new SkyLyrics(() => $("music-lyrics"));
  private sky = true;
  private net: Net;
  open = false;

  constructor(net: Net) {
    this.net = net;
    $("music-open").addEventListener("click", () => {
      this.setOpen(!this.open);
      if (this.open) void this.player?.activateElement();
    });
    $("music-min").addEventListener("click", () => this.setOpen(false));
    $("music-connect").addEventListener("click", () => this.net.musicConnect());
    $("music-play").addEventListener("click", () => void this.onPlayClick());
    $("music-next").addEventListener("click", () => this.net.musicNext());
    $("music-bar").addEventListener("change", () => {
      const bar = $("music-bar") as HTMLInputElement;
      this.net.musicSeek(Number(bar.value) || 0);
    });
    $("music-search").addEventListener("keydown", (ev) => {
      if ((ev as KeyboardEvent).key !== "Enter") return;
      ev.preventDefault();
      const q = ($("music-search") as HTMLInputElement).value.trim();
      if (q) {
        this.markLink("");
        this.net.musicSearch(q);
      }
    });
    $("music-playlists").addEventListener("click", () => {
      this.markLink("music-playlists");
      this.net.musicPlaylists();
    });
    $("music-liked").addEventListener("click", () => {
      this.markLink("music-liked");
      this.net.musicLiked();
    });
    $("music-handoff").addEventListener("click", () => {
      this.markLink("music-handoff");
      this.net.musicDevices();
    });
    this.setOpen(false);
  }

  private markLink(id: string) {
    for (const button of document.querySelectorAll("#music-links button")) {
      button.classList.toggle("on", button.id === id);
    }
  }

  setOpen(open: boolean) {
    this.open = open;
    $("music-panel").hidden = !open;
    $("music-open").classList.toggle("on", open);
    placeMusicBeside();
  }

  show(view: MusicView) {
    this.view = view;
    this.receivedAt = performance.now();
    this.render();
    if (view.connected) void this.ensureSpeaker();
  }

  auth(url: string) {
    location.href = url;
  }

  token(access: string) {
    this.tokenWait?.(access);
    this.tokenWait = null;
  }

  deny(reason: "spotify" | "premium" | "speaker") {
    const notice = $("music-notice");
    notice.hidden = false;
    notice.textContent =
      reason === "premium" ? "Spotify Premium is required" : reason === "speaker" ? "No speaker" : "Spotify did not answer";
  }

  catalog(catalog: Catalog) {
    const list = $("music-results");
    list.replaceChildren();
    if (catalog.kind === "playlists") {
      if (catalog.playlists.length === 0) {
        const empty = document.createElement("p");
        empty.className = "music-empty";
        empty.textContent = "No playlists you created.";
        list.append(empty);
        return;
      }
      for (const playlist of catalog.playlists) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "music-row";
        const name = document.createElement("span");
        name.textContent = playlist.name;
        row.append(name);
        row.addEventListener("click", () => this.net.musicPlaylist(playlist.id));
        list.append(row);
      }
      return;
    }
    for (const track of catalog.tracks) list.append(this.trackRow(track));
  }

  devices(devices: SpotifyDevice[]) {
    const list = $("music-results");
    list.replaceChildren();
    const here = document.createElement("button");
    here.type = "button";
    here.className = "music-row";
    const hereLabel = document.createElement("span");
    hereLabel.textContent = "This Haven tab";
    here.append(hereLabel);
    here.addEventListener("click", () => this.net.musicDevice(null));
    list.append(here);
    for (const device of devices) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "music-row";
      const name = document.createElement("span");
      name.textContent = device.name;
      row.append(name);
      row.addEventListener("click", () => this.net.musicDevice(device.id));
      list.append(row);
    }
  }

  /** Called from the frame loop. Reports playback every five seconds. */
  tick(dt: number, sky = true) {
    this.sky = sky;
    this.paintPosition();
    if (!this.player || !this.view?.connected) return;
    this.sampleAcc += dt;
    this.reportAcc += dt;
    if (this.sampleAcc < 0.4) return;
    const tellServer = this.reportAcc >= 5;
    this.sampleAcc = 0;
    if (tellServer) this.reportAcc = 0;
    void this.player.getCurrentState().then((state) => {
      if (!state) return;
      this.heard = true;
      this.heardPos = state.position;
      this.heardAt = performance.now();
      this.heardPaused = state.paused;
      if (!tellServer) return;
      const current = state.track_window.current_track;
      const artists = (current.artists ?? []).map((a) => a.name ?? "").filter(Boolean).join(", ");
      this.net.musicReport({
        uri: current.uri,
        paused: state.paused,
        positionMs: state.position,
        audible: document.visibilityState === "visible",
        ...(current.name && !current.name.startsWith("spotify:")
          ? {
              track: {
                uri: current.uri,
                name: current.name,
                artists,
                image: current.album?.images?.[0]?.url ?? null,
                durationMs: current.duration_ms ?? 0,
              },
            }
          : {}),
      });
    });
  }

  private trackRow(track: Track): HTMLButtonElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "music-row";
    const name = document.createElement("span");
    name.textContent = track.artists ? `${track.name}  ·  ${track.artists}` : track.name;
    row.append(name);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "music-add";
    add.textContent = "+";
    add.title = "Add";
    add.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.net.musicAdd(track);
    });
    row.addEventListener("click", () => {
      void this.wake().then(() => this.net.musicNow(track));
    });
    row.append(add);
    return row;
  }

  private render() {
    const view = this.view;
    if (!view) return;
    const connect = $("music-connect");
    const controls = $("music-controls");
    connect.hidden = view.connected;
    controls.hidden = !view.connected;
    const withEl = $("music-with");
    withEl.textContent = view.shared ? "Listening together" : "On your own";
    const notice = $("music-notice");
    const text = view.waiting ? "not on your Spotify" : view.notice;
    notice.hidden = !text;
    notice.textContent = text ?? "";
    const track = view.session.track;
    $("music-title").textContent = !track ? "Nothing playing" : track.name.startsWith("spotify:") ? "…" : track.name;
    $("music-artist").textContent = track?.artists ?? "";
    const art = $("music-art") as HTMLImageElement;
    art.hidden = !track?.image;
    if (track?.image) art.src = track.image;
    const bar = $("music-bar") as HTMLInputElement;
    bar.max = String(track?.durationMs ?? 0);
    bar.disabled = !track;
    const playing = !!track && !view.session.paused;
    const play = $("music-play");
    play.textContent = playing ? "❚❚" : "▶";
    play.setAttribute("aria-label", playing ? "Pause" : "Play");
    const queue = $("music-queue");
    queue.replaceChildren();
    $("music-upnext").hidden = view.session.queue.length === 0;
    for (const item of view.session.queue) {
      const li = document.createElement("li");
      li.textContent = item.artists ? `${item.name}  ·  ${item.artists}` : item.name;
      queue.append(li);
    }
    this.paintPosition();
  }

  private paintPosition() {
    const view = this.view;
    const bar = $("music-bar") as HTMLInputElement;
    if (!view?.session.track) {
      this.lyrics.update(null, 0, this.sky);
      return;
    }
    const sessionMs = Math.min(
      view.session.track.durationMs,
      view.session.positionMs + (view.session.paused ? 0 : performance.now() - this.receivedAt),
    );
    const ms = this.heard
      ? Math.min(view.session.track.durationMs, this.heardPaused ? this.heardPos : this.heardPos + (performance.now() - this.heardAt))
      : sessionMs;
    if (document.activeElement === bar) {
      this.lyrics.update(view.session.track, ms, this.sky);
      return;
    }
    bar.value = String(ms);
    this.lyrics.update(view.session.track, ms, this.sky);
    const clock = (n: number) => {
      const s = Math.max(0, Math.floor(n / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };
    $("music-time").textContent = clock(ms);
  }

  private async onPlayClick() {
    await this.wake();
    const state = await this.player?.getCurrentState();
    if (state && !state.paused) this.net.musicPause();
    else {
      this.net.musicPlay();
      this.net.musicHear();
    }
  }

  /** A click is what lets the browser make sound. The play command has to wait for that. */
  private async wake() {
    try {
      await this.player?.activateElement();
    } catch {
      // the speaker is not connected yet; the play command still goes through
    }
  }

  private async ensureSpeaker() {
    if (this.player || !this.view?.connected) return;
    await new Promise<void>((resolve) => {
      if (window.Spotify) return resolve();
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
      const script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      document.head.append(script);
    });
    if (!window.Spotify || this.player) return;
    const player = new window.Spotify.Player({
      name: "Haven",
      volume: 0.8,
      getOAuthToken: (cb) => {
        this.tokenWait = cb;
        this.net.musicToken();
      },
    });
    player.addListener("ready", ({ device_id }) => {
      if (device_id) this.net.musicDevice(device_id, true);
    });
    await player.connect();
    this.player = player;
  }
}
