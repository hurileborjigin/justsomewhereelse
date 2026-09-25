import assert from "node:assert/strict";
import { test } from "node:test";
import { Spotify } from "./spotify.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("play sends the track and position to the named device", async () => {
  let called: { url: string; body: string } | undefined;
  const spotify = new Spotify("id", "secret", "http://localhost/spotify/callback", async (url, init) => {
    called = { url: String(url), body: String(init?.body ?? "") };
    return new Response(null, { status: 204 });
  });
  const got = await spotify.play("token", "dev-1", "spotify:track:a", 1500);
  assert.equal(got.ok, true);
  assert.ok(called);
  assert.match(called.url, /\/me\/player\/play\?device_id=dev-1$/);
  assert.deepEqual(JSON.parse(called.body), { uris: ["spotify:track:a"], position_ms: 1500 });
});

test("a missing track is unavailable and does not look like a session change", async () => {
  const spotify = new Spotify("id", "secret", "http://localhost/cb", async () => json(404, { error: { message: "Not found" } }));
  const got = await spotify.play("token", "dev", "spotify:track:nope", 0);
  assert.deepEqual(got, { ok: false, reason: "unavailable" });
});

test("premium required is its own reason", async () => {
  const spotify = new Spotify("id", "secret", "http://localhost/cb", async () =>
    json(403, { error: { message: "Player command failed: Premium required" } }),
  );
  const got = await spotify.pause("token", "dev");
  assert.deepEqual(got, { ok: false, reason: "premium" });
});

test("search keeps only tracks", async () => {
  const spotify = new Spotify("id", "secret", "http://localhost/cb", async () =>
    json(200, {
      tracks: {
        items: [
          { type: "track", uri: "spotify:track:a", name: "Both Sides Now", artists: [{ name: "Joni Mitchell" }], duration_ms: 1000, album: { images: [{ url: "http://img" }] } },
          { type: "episode", uri: "spotify:episode:e", name: "A show" },
        ],
      },
    }),
  );
  const got = await spotify.search("token", "joni");
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.deepEqual(got.value, [
    { uri: "spotify:track:a", name: "Both Sides Now", artists: "Joni Mitchell", image: "http://img", durationMs: 1000 },
  ]);
});
