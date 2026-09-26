// Persistence for the two-player world: who the players are, where they were
// last, the character assignment and the chat history. SQLite via node:sqlite
// (built into Node), one file on disk - on Fly.io it lives on the mounted
// volume (DB_PATH=/data/planet.db).
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  FIXED_OWNERS,
  type Box,
  type BoxContents,
  type BoxSize,
  type ChatEntry,
  type MediaRef,
  type MusicSession,
  type PlayerId,
  type StateData,
  type Vec3,
  type Writing,
} from "../shared/protocol.ts";
import { emptySession } from "./music.ts";

const DEFAULT_NAMES: [string, string] = ["gloria", "khurlee"];
const HISTORY_KEEP = 1000;

/** A box as stored: contents always present (the server strips them per viewer). */
export type FullBox = Box & { contents: BoxContents };

export type NewBox = {
  creator: PlayerId;
  size: BoxSize;
  contents: BoxContents;
  announce: boolean;
  loc: string;
  tiles: number[];
  fwd: Vec3;
};

type BoxRow = {
  id: number;
  creator: number;
  owner: number | null;
  size: string;
  contents: string;
  announce: number;
  created: number;
  opened: number | null;
  label: string | null;
  origin: string;
  loc: string | null;
  tiles: string;
  fwd: string;
};

/** A row from before `contents`: the flat columns, with `style` and `card` missing on the oldest databases. */
type FlatBoxRow = Omit<BoxRow, "contents"> & { text: string; media: string; style?: string; card?: string | null };

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_POSTCARD: BoxContents = {
  style: "postcard",
  picture: null,
  writing: { text: "", stamp: "", place: "", to: "", from: "" },
};

function rowToBox(r: BoxRow): FullBox {
  return {
    id: Number(r.id),
    creator: r.creator as PlayerId,
    owner: r.owner === null ? null : (r.owner as PlayerId),
    size: r.size as BoxSize,
    announce: r.announce === 1,
    created: r.created,
    opened: r.opened,
    label: r.label,
    origin: r.origin,
    loc: r.loc,
    tiles: parseJson<number[]>(r.tiles, []),
    fwd: parseJson<Vec3>(r.fwd, [0, 0, 1]),
    contents: parseJson<BoxContents>(r.contents, EMPTY_POSTCARD),
  };
}

/** An old flat row folded into `contents`. Prints on an old postcard are dropped: no such box exists in the live database. */
function foldContents(r: FlatBoxRow): BoxContents {
  const media = parseJson<MediaRef[]>(r.media, []);
  const style = r.style ?? "postcard";
  if (style === "note") return { style: "note", text: r.text, media };
  if (style === "media") return { style: "media", caption: r.text, media };
  const card = r.card ? parseJson<Partial<Writing> | null>(r.card, null) : null;
  return {
    style: "postcard",
    picture: null,
    writing: { text: r.text, stamp: card?.stamp ?? "", place: card?.place ?? "", to: card?.to ?? "", from: card?.from ?? "" },
  };
}

const BOX_COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator INTEGER NOT NULL,
  owner INTEGER,
  size TEXT NOT NULL,
  contents TEXT NOT NULL,
  announce INTEGER NOT NULL,
  created INTEGER NOT NULL,
  opened INTEGER,
  label TEXT,
  origin TEXT NOT NULL,
  loc TEXT,
  tiles TEXT NOT NULL,
  fwd TEXT NOT NULL`;

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        state TEXT,
        updated INTEGER
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender INTEGER NOT NULL,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS boxes (${BOX_COLUMNS});
      CREATE TABLE IF NOT EXISTS buildings (id TEXT PRIMARY KEY, owner INTEGER NOT NULL);
    `);
    const seed = this.db.prepare("INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)");
    seed.run(0, DEFAULT_NAMES[0]);
    seed.run(1, DEFAULT_NAMES[1]);
    // older databases predate media messages
    const cols = this.db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "media")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN media TEXT");
    }
    this.migrateBoxes();
  }

  /** One-time rebuild from the flat `text`/`media`/`style`/`card` columns into `contents`. */
  private migrateBoxes() {
    const cols = (this.db.prepare("PRAGMA table_info(boxes)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("text")) return; // already the contents shape
    const rows = this.db.prepare("SELECT * FROM boxes ORDER BY id").all() as FlatBoxRow[];
    this.db.exec("BEGIN");
    try {
      this.db.exec(`CREATE TABLE boxes_v2 (${BOX_COLUMNS})`);
      const insert = this.db.prepare(
        `INSERT INTO boxes_v2 (id, creator, owner, size, contents, announce, created, opened, label, origin, loc, tiles, fwd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of rows) {
        insert.run(r.id, r.creator, r.owner, r.size, JSON.stringify(foldContents(r)), r.announce, r.created, r.opened, r.label, r.origin, r.loc, r.tiles, r.fwd);
      }
      this.db.exec("DROP TABLE boxes");
      this.db.exec("ALTER TABLE boxes_v2 RENAME TO boxes");
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    console.log(`[planet] migrated ${rows.length} treasure box(es) to typed contents`);
  }

  close() {
    this.db.close();
  }

  names(): [string, string] {
    const rows = this.db.prepare("SELECT id, name FROM players ORDER BY id").all() as {
      id: number;
      name: string;
    }[];
    return [rows[0]?.name ?? DEFAULT_NAMES[0], rows[1]?.name ?? DEFAULT_NAMES[1]];
  }

  rename(id: PlayerId, name: string) {
    this.db.prepare("UPDATE players SET name = ? WHERE id = ?").run(name, id);
  }

  saveState(id: PlayerId, state: StateData) {
    this.db
      .prepare("UPDATE players SET state = ?, updated = ? WHERE id = ?")
      .run(JSON.stringify(state), Date.now(), id);
  }

  state(id: PlayerId): StateData | null {
    const row = this.db.prepare("SELECT state FROM players WHERE id = ?").get(id) as
      | { state: string | null }
      | undefined;
    if (!row?.state) return null;
    try {
      return JSON.parse(row.state) as StateData;
    } catch {
      return null;
    }
  }

  // --- the shared secret word (chosen in-game on first visit) --------------

  private kvGet(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  private kvSet(key: string, value: string) {
    this.db
      .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  hasPass(): boolean {
    return this.kvGet("pass") !== null;
  }

  setPass(pass: string) {
    const salt = randomBytes(16);
    const hash = scryptSync(pass, salt, 32);
    this.kvSet("pass", `${salt.toString("hex")}:${hash.toString("hex")}`);
  }

  checkPass(pass: string): boolean {
    const stored = this.kvGet("pass");
    if (!stored) return false;
    const [saltHex, hashHex] = stored.split(":");
    const hash = scryptSync(pass, Buffer.from(saltHex, "hex"), 32);
    return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
  }

  addMessage(from: PlayerId, text: string, media?: MediaRef): ChatEntry {
    const ts = Date.now();
    const res = this.db
      .prepare("INSERT INTO messages (sender, text, ts, media) VALUES (?, ?, ?, ?)")
      .run(from, text, ts, media ? JSON.stringify(media) : null);
    this.db
      .prepare(
        "DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ?)",
      )
      .run(HISTORY_KEEP);
    const id = Number(res.lastInsertRowid);
    return media ? { id, from, text, ts, media } : { id, from, text, ts };
  }

  getMessage(id: number): { sender: PlayerId; ts: number; media?: MediaRef } | null {
    const row = this.db.prepare("SELECT sender, ts, media FROM messages WHERE id = ?").get(id) as
      | { sender: number; ts: number; media: string | null }
      | undefined;
    if (!row) return null;
    const out: { sender: PlayerId; ts: number; media?: MediaRef } = {
      sender: row.sender as PlayerId,
      ts: row.ts,
    };
    if (row.media) {
      try {
        out.media = JSON.parse(row.media) as MediaRef;
      } catch {
        /* ignore corrupt media refs */
      }
    }
    return out;
  }

  deleteMessage(id: number) {
    this.db.prepare("DELETE FROM messages WHERE id = ?").run(id);
  }

  history(limit = 200): ChatEntry[] {
    const rows = this.db
      .prepare("SELECT id, sender, text, ts, media FROM messages ORDER BY id DESC LIMIT ?")
      .all(limit) as { id: number; sender: number; text: string; ts: number; media: string | null }[];
    return rows.reverse().map((r) => {
      const entry: ChatEntry = { id: Number(r.id), from: r.sender as PlayerId, text: r.text, ts: r.ts };
      if (r.media) {
        try {
          entry.media = JSON.parse(r.media) as MediaRef;
        } catch {
          /* ignore corrupt media refs */
        }
      }
      return entry;
    });
  }

  // --- treasure boxes ---------------------------------------------------------

  addBox(input: NewBox): FullBox {
    const res = this.db
      .prepare(
        `INSERT INTO boxes (creator, owner, size, contents, announce, created, opened, label, origin, loc, tiles, fwd)
         VALUES (?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      )
      .run(
        input.creator,
        input.size,
        JSON.stringify(input.contents),
        input.announce ? 1 : 0,
        Date.now(),
        input.loc,
        input.loc,
        JSON.stringify(input.tiles),
        JSON.stringify(input.fwd),
      );
    return this.getBox(Number(res.lastInsertRowid))!;
  }

  getBox(id: number): FullBox | null {
    const row = this.db.prepare("SELECT * FROM boxes WHERE id = ?").get(id) as BoxRow | undefined;
    return row ? rowToBox(row) : null;
  }

  boxes(): FullBox[] {
    return (this.db.prepare("SELECT * FROM boxes ORDER BY id").all() as BoxRow[]).map(rowToBox);
  }

  /** Boxes currently standing in world `loc` (held boxes have loc NULL). */
  boxesIn(loc: string): FullBox[] {
    return (this.db.prepare("SELECT * FROM boxes WHERE loc = ? ORDER BY id").all(loc) as BoxRow[]).map(
      rowToBox,
    );
  }

  /** Records the first opening; later openings change nothing. */
  openBox(id: number, ts: number) {
    this.db.prepare("UPDATE boxes SET opened = ? WHERE id = ? AND opened IS NULL").run(ts, id);
  }

  /** Out of the world, into `owner`'s collection. */
  keepBox(id: number, owner: PlayerId, label: string | null) {
    this.db
      .prepare("UPDATE boxes SET owner = ?, label = ?, loc = NULL, tiles = '[]' WHERE id = ?")
      .run(owner, label, id);
  }

  labelBox(id: number, label: string | null) {
    this.db.prepare("UPDATE boxes SET label = ? WHERE id = ?").run(label, id);
  }

  /** A held box goes back into the world. */
  putBox(id: number, loc: string, tiles: number[], fwd: Vec3) {
    this.db
      .prepare("UPDATE boxes SET loc = ?, tiles = ?, fwd = ? WHERE id = ?")
      .run(loc, JSON.stringify(tiles), JSON.stringify(fwd), id);
  }

  /** The creator took a sealed box back: gone for good (its media files are the server's job). */
  deleteBox(id: number) {
    this.db.prepare("DELETE FROM boxes WHERE id = ?").run(id);
  }

  /** The creator changed a sealed box; where it stands, its size and its history stay. */
  editBox(id: number, contents: BoxContents, announce: boolean) {
    this.db.prepare("UPDATE boxes SET contents = ?, announce = ? WHERE id = ?").run(JSON.stringify(contents), announce ? 1 : 0, id);
  }

  /** Tests only: write a raw contents string to check the corrupt-row fallback. */
  debugSetContents(id: number, raw: string) {
    this.db.prepare("UPDATE boxes SET contents = ? WHERE id = ?").run(raw, id);
  }

  /** The creator picked their own box up to move it: out of the world, still nobody's. */
  liftBox(id: number) {
    this.db.prepare("UPDATE boxes SET loc = NULL, tiles = '[]' WHERE id = ?").run(id);
  }

  /**
   * Lifts every box standing in `loc` on any of `tiles` (loc null, no tiles),
   * so it lands in its holder's pocket like any lifted or kept box; returns
   * the ids lifted, in order. Idempotent: a second call finds nothing.
   */
  liftBoxesOff(loc: string, tiles: readonly number[]): number[] {
    const off = new Set(tiles);
    const lifted = this.boxesIn(loc).filter((b) => b.tiles.some((t) => off.has(t))).map((b) => b.id);
    for (const id of lifted) this.liftBox(id);
    return lifted;
  }

  // --- building ownership ----------------------------------------------------

  /** null means open to both. The fixed houses are answered from code, never from the table. */
  ownerOf(id: string): PlayerId | null {
    if (Object.hasOwn(FIXED_OWNERS, id)) return FIXED_OWNERS[id];
    const row = this.db.prepare("SELECT owner FROM buildings WHERE id = ?").get(id) as
      | { owner: number }
      | undefined;
    return row ? (row.owner as PlayerId) : null;
  }

  /** null deletes the row (open to both); anything else upserts it. */
  setOwner(id: string, owner: PlayerId | null) {
    if (owner === null) {
      this.db.prepare("DELETE FROM buildings WHERE id = ?").run(id);
    } else {
      this.db
        .prepare(
          "INSERT INTO buildings (id, owner) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET owner = excluded.owner",
        )
        .run(id, owner);
    }
  }

  musicSession(id: PlayerId): MusicSession {
    const raw = this.kvGet(`music:${id}`);
    if (!raw) return emptySession();
    try {
      const s = JSON.parse(raw) as MusicSession;
      if (!s || !Array.isArray(s.queue)) return emptySession();
      if (s.repeat !== "off" && s.repeat !== "all" && s.repeat !== "one") s.repeat = "off";
      return s;
    } catch {
      return emptySession();
    }
  }

  saveMusicSession(id: PlayerId, session: MusicSession) {
    this.kvSet(`music:${id}`, JSON.stringify(session));
  }

  spotifyRefresh(id: PlayerId): string | null {
    return this.kvGet(`spotify:${id}`);
  }

  setSpotifyRefresh(id: PlayerId, token: string | null) {
    if (token === null) this.db.prepare("DELETE FROM kv WHERE key = ?").run(`spotify:${id}`);
    else this.kvSet(`spotify:${id}`, token);
  }

  /** Every owned building, the fixed houses included. */
  owners(): { id: string; owner: PlayerId }[] {
    const rows = this.db.prepare("SELECT id, owner FROM buildings").all() as {
      id: string;
      owner: number;
    }[];
    const fixed = Object.entries(FIXED_OWNERS).map(([id, owner]) => ({ id, owner }));
    return [...fixed, ...rows.map((r) => ({ id: r.id, owner: r.owner as PlayerId }))];
  }
}
