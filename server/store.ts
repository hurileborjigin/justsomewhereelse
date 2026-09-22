// Persistence for the two-player world: who the players are, where they were
// last, the character assignment and the chat history. SQLite via node:sqlite
// (built into Node), one file on disk - on Fly.io it lives on the mounted
// volume (DB_PATH=/data/planet.db).
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ChatEntry, PlayerId, StateData } from "../shared/protocol.ts";

const DEFAULT_NAMES: [string, string] = ["gloria", "khurlee"];
const HISTORY_KEEP = 1000;

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
    `);
    const seed = this.db.prepare("INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)");
    seed.run(0, DEFAULT_NAMES[0]);
    seed.run(1, DEFAULT_NAMES[1]);
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

  addMessage(from: PlayerId, text: string): ChatEntry {
    const ts = Date.now();
    this.db.prepare("INSERT INTO messages (sender, text, ts) VALUES (?, ?, ?)").run(from, text, ts);
    this.db
      .prepare(
        "DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ?)",
      )
      .run(HISTORY_KEEP);
    return { from, text, ts };
  }

  history(limit = 200): ChatEntry[] {
    const rows = this.db
      .prepare("SELECT sender, text, ts FROM messages ORDER BY id DESC LIMIT ?")
      .all(limit) as { sender: number; text: string; ts: number }[];
    return rows.reverse().map((r) => ({ from: r.sender as PlayerId, text: r.text, ts: r.ts }));
  }
}
