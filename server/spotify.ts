// The only module that talks to Spotify. Callers pass fetch so tests stay offline.

import type { SpotifyDevice, Track } from "../shared/protocol.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ApiFail = "unavailable" | "premium" | "auth" | "failed";
export type ApiResult<T> = { ok: true; value: T } | { ok: false; reason: ApiFail };

export type Tokens = { access: string; refresh: string; expiresIn: number };

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

export const SCOPES = [
  "streaming",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "user-library-read",
].join(" ");

type TrackJson = {
  type?: string;
  uri?: string;
  name?: string;
  duration_ms?: number;
  artists?: { name?: string }[];
  album?: { images?: { url?: string }[] };
};

function trackOf(raw: TrackJson | null | undefined): Track | null {
  if (!raw?.uri?.startsWith("spotify:track:")) return null;
  if (raw.type && raw.type !== "track") return null;
  return {
    uri: raw.uri,
    name: raw.name ?? raw.uri,
    artists: (raw.artists ?? []).map((a) => a.name ?? "").filter(Boolean).join(", "),
    image: raw.album?.images?.[0]?.url ?? null,
    durationMs: raw.duration_ms ?? 0,
  };
}

function reasonFrom(status: number, text: string): ApiFail {
  if (status === 401) return "auth";
  if (status === 403 && /premium/i.test(text)) return "premium";
  if (status === 403 || status === 404) return "unavailable";
  return "failed";
}

export class Spotify {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private fetchImpl: FetchLike;

  constructor(clientId: string, clientSecret: string, redirectUri: string, fetchImpl: FetchLike) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.fetchImpl = fetchImpl;
  }

  authUrl(state: string): string {
    const q = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      scope: SCOPES,
      state,
    });
    return `${ACCOUNTS}/authorize?${q}`;
  }

  async exchange(code: string): Promise<ApiResult<Tokens>> {
    return this.token({ grant_type: "authorization_code", code, redirect_uri: this.redirectUri });
  }

  async refresh(refreshToken: string): Promise<ApiResult<Tokens>> {
    const got = await this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
    if (!got.ok) return got;
    return { ok: true, value: { ...got.value, refresh: got.value.refresh || refreshToken } };
  }

  async play(access: string, deviceId: string, uri: string, positionMs: number): Promise<ApiResult<true>> {
    return this.empty(access, "PUT", `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      uris: [uri],
      position_ms: Math.max(0, Math.round(positionMs)),
    });
  }

  async pause(access: string, deviceId: string): Promise<ApiResult<true>> {
    return this.empty(access, "PUT", `/me/player/pause?device_id=${encodeURIComponent(deviceId)}`);
  }

  async seek(access: string, deviceId: string, positionMs: number): Promise<ApiResult<true>> {
    const q = `position_ms=${Math.max(0, Math.round(positionMs))}&device_id=${encodeURIComponent(deviceId)}`;
    return this.empty(access, "PUT", `/me/player/seek?${q}`);
  }

  async devices(access: string): Promise<ApiResult<SpotifyDevice[]>> {
    const got = await this.speakers(access);
    if (!got.ok) return got;
    return { ok: true, value: got.value.filter((d) => d.name !== "Haven") };
  }

  /** Every speaker Spotify currently knows, including the Haven tab. */
  async speakers(access: string): Promise<ApiResult<SpotifyDevice[]>> {
    const got = await this.json<{ devices?: { id?: string; name?: string }[] }>(access, "/me/player/devices");
    if (!got.ok) return got;
    const devices = (got.value.devices ?? [])
      .filter((d) => d.id && d.name)
      .map((d) => ({ id: d.id as string, name: d.name as string }));
    return { ok: true, value: devices };
  }

  async transfer(access: string, deviceId: string): Promise<ApiResult<true>> {
    return this.empty(access, "PUT", "/me/player", { device_ids: [deviceId], play: true });
  }

  async search(access: string, q: string): Promise<ApiResult<Track[]>> {
    const got = await this.json<{ tracks?: { items?: TrackJson[] } }>(
      access,
      `/search?type=track&limit=8&q=${encodeURIComponent(q)}`,
    );
    if (!got.ok) return got;
    return { ok: true, value: (got.value.tracks?.items ?? []).map(trackOf).filter((t): t is Track => t !== null) };
  }

  async playlists(access: string): Promise<ApiResult<{ id: string; name: string; mine: boolean }[]>> {
    const me = await this.json<{ id?: string }>(access, "/me");
    if (!me.ok) return me;
    const mine: { id: string; name: string; mine: boolean }[] = [];
    let offset = 0;
    for (let page = 0; page < 4 && mine.length < 20; page++) {
      const got = await this.json<{ items?: { id?: string; name?: string; owner?: { id?: string } }[]; next?: string | null }>(
        access,
        `/me/playlists?limit=50&offset=${offset}`,
      );
      if (!got.ok) return page === 0 ? got : { ok: true, value: mine };
      const items = got.value.items ?? [];
      for (const p of items) {
        if (p.id && p.name && p.owner?.id === me.value.id) mine.push({ id: p.id, name: p.name, mine: true });
      }
      if (!got.value.next || items.length === 0) break;
      offset += items.length;
    }
    return { ok: true, value: mine.slice(0, 20) };
  }

  async playlist(access: string, id: string): Promise<ApiResult<Track[]>> {
    return this.pages(access, (offset) => `/playlists/${encodeURIComponent(id)}/items?limit=50&offset=${offset}`, (row) => {
      const item = row as { item?: TrackJson; track?: TrackJson };
      return trackOf(item.item ?? item.track);
    });
  }

  async liked(access: string): Promise<ApiResult<Track[]>> {
    return this.pages(access, (offset) => `/me/tracks?limit=50&offset=${offset}`, (row) => trackOf((row as { track?: TrackJson }).track));
  }

  /** Walk a paged list until Spotify has no more, or 200 tracks. */
  private async pages(access: string, path: (offset: number) => string, read: (row: unknown) => Track | null): Promise<ApiResult<Track[]>> {
    const tracks: Track[] = [];
    let offset = 0;
    for (let page = 0; page < 4 && tracks.length < 200; page++) {
      const got = await this.json<{ items?: unknown[]; next?: string | null }>(access, path(offset));
      if (!got.ok) return page === 0 ? got : { ok: true, value: tracks };
      const items = got.value.items ?? [];
      for (const row of items) {
        const track = read(row);
        if (track) tracks.push(track);
      }
      if (!got.value.next || items.length === 0) break;
      offset += items.length;
    }
    return { ok: true, value: tracks };
  }

  private async token(body: Record<string, string>): Promise<ApiResult<Tokens>> {
    const res = await this.fetchImpl(`${ACCOUNTS}/api/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    });
    if (!res.ok) return { ok: false, reason: reasonFrom(res.status, await res.text().catch(() => "")) };
    const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!json.access_token) return { ok: false, reason: "failed" };
    return {
      ok: true,
      value: { access: json.access_token, refresh: json.refresh_token ?? "", expiresIn: json.expires_in ?? 3600 },
    };
  }

  private async empty(access: string, method: string, path: string, body?: unknown): Promise<ApiResult<true>> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204 || res.ok) return { ok: true, value: true };
    const text = await res.text().catch(() => "");
    console.log(`[planet] spotify ${method} ${res.status} ${text.slice(0, 180)}`);
    return { ok: false, reason: reasonFrom(res.status, text) };
  }

  private async json<T>(access: string, path: string): Promise<ApiResult<T>> {
    const res = await this.fetchImpl(`${API}${path}`, { headers: { authorization: `Bearer ${access}` } });
    if (!res.ok) return { ok: false, reason: reasonFrom(res.status, await res.text().catch(() => "")) };
    return { ok: true, value: (await res.json()) as T };
  }
}
