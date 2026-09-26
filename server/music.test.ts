import assert from "node:assert/strict";
import { test } from "node:test";
import { DRIFT_MS, GRACE_MS, MusicRoom, emptySession, type Track } from "./music.ts";

const song = (uri: string, durationMs = 10_000): Track => ({
  uri,
  name: uri,
  artists: "someone",
  image: null,
  durationMs,
});

const A = song("spotify:track:a");
const B = song("spotify:track:b");
const C = song("spotify:track:c");

test("the second player joins what is already playing and their session freezes", () => {
  const room = new MusicRoom();
  room.sessions[0] = { ...emptySession(), track: A, paused: false, positionMs: 1000, at: 0, queue: [B] };
  room.online(0, 1000);
  room.online(1, 2000);
  assert.equal(room.sharedOwner, 0);
  assert.equal(room.sessions[1].track, null);
  assert.equal(room.hear(1, 2000).track?.uri, A.uri);
  room.apply({ t: "add", by: 1, track: C }, 2500);
  assert.deepEqual(room.sessions[0].queue.map((t) => t.uri), [B.uri, C.uri]);
  assert.equal(room.sessions[1].track, null);
  assert.deepEqual(room.sessions[1].queue, []);
});

test("a paused or empty room stays quiet until someone presses play", () => {
  const room = new MusicRoom();
  room.sessions[0] = { ...emptySession(), track: A, paused: true, positionMs: 400, at: 0 };
  room.online(0, 0);
  room.online(1, 10);
  assert.equal(room.sharedOwner, null);
  assert.equal(room.hear(1, 10).track, null);

  const empty = new MusicRoom();
  empty.online(0, 0);
  empty.online(1, 10);
  empty.apply({ t: "play", by: 1 }, 20);
  assert.equal(empty.sharedOwner, null);

  empty.apply({ t: "play-now", by: 1, track: C }, 30);
  assert.equal(empty.sharedOwner, 1);
  assert.equal(empty.hear(0, 30).track?.uri, C.uri);
  assert.equal(empty.sessions[0].track, null);
});

test("play, pause, seek, next and add change the shared session", () => {
  const room = new MusicRoom();
  room.sessions[0] = { ...emptySession(), track: A, paused: false, positionMs: 0, at: 0, queue: [B] };
  room.online(0, 0);
  room.online(1, 0);
  room.apply({ t: "pause", by: 1 }, 1000);
  assert.equal(room.sessions[0].paused, true);
  assert.equal(room.sessions[0].positionMs, 1000);
  room.apply({ t: "seek", by: 0, positionMs: 250 }, 1100);
  assert.equal(room.sessions[0].positionMs, 250);
  room.apply({ t: "play", by: 1 }, 1200);
  assert.equal(room.sessions[0].paused, false);
  room.apply({ t: "add", by: 0, track: C }, 1300);
  room.apply({ t: "next", by: 1 }, 1400);
  assert.equal(room.sessions[0].track?.uri, B.uri);
  assert.deepEqual(room.sessions[0].queue.map((t) => t.uri), [C.uri]);
  assert.equal(room.sessions[1].track, null);
});

test("the queue advances once when a song ends", () => {
  const room = new MusicRoom();
  room.sessions[0] = { ...emptySession(), track: A, paused: false, positionMs: 0, at: 0, queue: [B] };
  room.online(0, 0);
  room.apply({ t: "tick", now: A.durationMs }, A.durationMs);
  assert.equal(room.sessions[0].track?.uri, B.uri);
  assert.deepEqual(room.sessions[0].queue, []);
  room.apply({ t: "tick", now: A.durationMs + B.durationMs }, A.durationMs + B.durationMs);
  assert.equal(room.sessions[0].track, null);
  assert.equal(room.sessions[0].paused, true);
});

test("when the owner leaves, the other player returns to their own session", () => {
  const room = new MusicRoom();
  const long = song("spotify:track:a", 120_000);
  const own = song("spotify:track:c", 120_000);
  room.sessions[0] = { ...emptySession(), track: long, paused: false, positionMs: 0, at: 0, queue: [B] };
  room.sessions[1] = { ...emptySession(), track: own, paused: false, positionMs: 500, at: 0 };
  room.online(0, 0);
  room.online(1, 100);
  assert.equal(room.sharedOwner, 0);
  room.offline(0, 200);
  room.apply({ t: "tick", now: 200 + GRACE_MS }, 200 + GRACE_MS);
  assert.equal(room.sharedOwner, null);
  assert.equal(room.onlineAt(0), false);
  assert.equal(room.hear(1, 200 + GRACE_MS).track?.uri, own.uri);
  assert.equal(room.sessions[0].track?.uri, long.uri);
  const effects = room.lastEffects;
  assert.equal(effects.find((e) => e.id === 0)?.do, "pause");
});

test("when the joiner leaves, the owner keeps playing", () => {
  const room = new MusicRoom();
  const long = song("spotify:track:a", 120_000);
  room.sessions[0] = { ...emptySession(), track: long, paused: false, positionMs: 0, at: 0 };
  room.sessions[1] = { ...emptySession(), track: C, paused: false, positionMs: 0, at: 0 };
  room.online(0, 0);
  room.online(1, 100);
  room.offline(1, 200);
  room.apply({ t: "tick", now: 200 + GRACE_MS }, 200 + GRACE_MS);
  assert.equal(room.hear(0, 200 + GRACE_MS).track?.uri, long.uri);
  assert.equal(room.sessions[0].paused, false);
  assert.equal(room.sessions[1].track?.uri, C.uri);
});

test("a reconnect inside the grace does not count as leaving", () => {
  const room = new MusicRoom();
  room.sessions[0] = { ...emptySession(), track: A, paused: false, positionMs: 0, at: 0 };
  room.online(0, 0);
  room.online(1, 100);
  room.offline(1, 200);
  room.online(1, 200 + GRACE_MS - 1);
  assert.equal(room.sharedOwner, 0);
  assert.equal(room.hear(1, 200 + GRACE_MS - 1).track?.uri, A.uri);
  assert.equal(room.sessions[1].track, null);
});

test("a song one account cannot play stays on the session and only that speaker waits", () => {
  const room = new MusicRoom();
  room.sessions[0] = { ...emptySession(), track: A, paused: false, positionMs: 0, at: 0 };
  room.online(0, 0);
  room.online(1, 0);
  const heard = room.hear(1, 100, false);
  assert.equal(room.sessions[0].track?.uri, A.uri);
  assert.equal(heard.waiting, true);
  assert.equal(room.hear(0, 100, true).waiting, false);
});

test("a song that has ended starts the next one, and repeat brings songs back", () => {
  const room = new MusicRoom();
  room.sessions[0] = { ...emptySession(), track: A, paused: false, positionMs: 0, at: 0, queue: [B] };
  room.online(0, 0);
  const ended = room.report(0, { uri: A.uri, paused: true, positionMs: A.durationMs }, A.durationMs);
  assert.equal(ended.do, "follow");
  assert.equal(room.sessions[0].track?.uri, B.uri);
  assert.equal(room.sessions[0].queue.length, 0);
  room.apply({ t: "repeat", by: 0 }, A.durationMs);
  assert.equal(room.sessions[0].repeat, "all");
  room.apply({ t: "add", by: 0, track: C }, A.durationMs);
  room.apply({ t: "tick", now: A.durationMs + B.durationMs }, A.durationMs + B.durationMs);
  assert.equal(room.sessions[0].track?.uri, C.uri);
  assert.equal(room.sessions[0].queue[0]?.uri, B.uri);
  room.apply({ t: "repeat", by: 0 }, A.durationMs + B.durationMs);
  assert.equal(room.sessions[0].repeat, "one");
  room.apply({ t: "tick", now: A.durationMs + B.durationMs + C.durationMs }, A.durationMs + B.durationMs + C.durationMs);
  assert.equal(room.sessions[0].track?.uri, C.uri);
  assert.equal(room.sessions[0].positionMs, 0);
});

test("a song can be taken off the queue", () => {
  const room = new MusicRoom();
  room.sessions[0] = { ...emptySession(), track: A, paused: false, positionMs: 0, at: 0, queue: [B, C] };
  room.online(0, 0);
  room.apply({ t: "drop", by: 0, index: 0 }, 1000);
  assert.deepEqual(room.sessions[0].queue.map((t) => t.uri), [C.uri]);
});

test("a speaker that is a little behind does not get seeked", () => {
  const room = new MusicRoom();
  room.sessions[0] = { ...emptySession(), track: A, paused: false, positionMs: 0, at: 0 };
  room.online(0, 0);
  const ok = room.report(0, { uri: A.uri, paused: false, positionMs: 1000 + DRIFT_MS }, 1000);
  assert.equal(ok.do, "ok");
  assert.equal(room.sessions[0].track?.uri, A.uri);
  assert.equal(room.sessions[0].positionMs, 1000 + DRIFT_MS);
  const adopt = room.report(0, { uri: B.uri, paused: false, positionMs: 0 }, 1000);
  assert.equal(adopt.do, "follow");
  assert.equal(room.sessions[0].track?.uri, B.uri);
});
