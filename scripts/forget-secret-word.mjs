// Maintenance: forget the shared secret word so identity 0 (gloria) chooses a
// new one on her next visit, exactly like the very first visit. Runs on the
// Fly machine through the "Reset the secret word" GitHub Action, or locally
// against a dev database:
//   DB_PATH=data/planet.db node scripts/forget-secret-word.mjs
// The running server needs no restart: it asks the database for the word on
// every lobby and login.
import { DatabaseSync } from "node:sqlite";

if (process.env.PLANET_PASS) {
  console.error(
    "PLANET_PASS is set in the environment, so the word lives there, not in the database. Unset that secret to use the in-game setup.",
  );
  process.exit(2);
}

const path = process.env.DB_PATH ?? "data/planet.db";
const db = new DatabaseSync(path);
const { changes } = db.prepare("DELETE FROM kv WHERE key = 'pass'").run();
db.close();
console.log(
  changes
    ? `secret word forgotten (${path}); identity 0 sets a new one at her next visit`
    : `no secret word was stored in ${path}; the planet is already in setup mode`,
);
