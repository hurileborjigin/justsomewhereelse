# Shared Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both players share one Spotify session while logged in, and each resumes a frozen personal session when alone.

**Architecture:** A pure `server/music.ts` owns the two personal sessions, the shared owner, the ten-second leave grace, queue advance and drift. `server/spotify.ts` is the only module that talks to Spotify. The server calls it after each music command. The client is a Haven speaker (Web Playback SDK) plus a left-hand panel.

**Tech Stack:** TypeScript, Node type stripping, `node:sqlite`, `ws`, Spotify Web API and Web Playback SDK, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-25-shared-music-design.md`

## Global Constraints

- No enums, no namespaces, no parameter properties. Explicit `.ts` extensions on imports.
- Never use the em dash character.
- Commit messages are one line, no trailers.
- Markdown: one sentence per line.
- Drift threshold is 2000 ms. Leave grace is 10000 ms. Position reports every 5000 ms.
- Speaker name is `Haven`.
- Volume is never synced. Tracks only. No previous-track control.
- A Spotify failure must not rewrite the session.
- Copy, verbatim: "not on your Spotify", "Connect Spotify", "Spotify did not answer".

## File structure

- `server/music.ts` owns session rules. No network.
- `server/music.test.ts` covers the spec's session cases.
- `server/spotify.ts` refreshes tokens and calls the Web API. Tests fake `fetch`.
- `server/store.ts` persists two sessions and two refresh tokens.
- `shared/protocol.ts` gains music messages.
- `server/index.ts` applies commands, pushes playback, serves the OAuth callback.
- `src/music.ts` is the panel and the Haven speaker.
- `index.html` holds the panel markup and styles.

---

### Task 1: Session rules

**Files:**
- Create: `server/music.ts`
- Test: `server/music.test.ts`

- [ ] **Step 1: Write failing tests** for join, quiet room, play/pause/seek/next/add, queue end, leave, ten-second grace, and a song one account cannot play.

- [ ] **Step 2: Run** `node --test server/music.test.ts` and confirm fail.

- [ ] **Step 3: Implement** `MusicRoom` with `emptySession`, `apply`, `positionAt`, `hear`.

- [ ] **Step 4: Run** the same test. Expected: pass.

- [ ] **Step 5: Commit** `Session rules for shared and personal music`.

### Task 2: Persistence and protocol

**Files:**
- Modify: `server/store.ts`, `shared/protocol.ts`
- Test: `server/store.test.ts`

Sessions and Spotify refresh tokens survive a new `Store` on the same database.
Welcome includes `music`. Client messages: `music-play`, `music-pause`, `music-seek`, `music-next`, `music-add`, `music-now`, `music-device`, `music-report`. Server messages: `music`, `music-token`, `music-catalog`, `music-devices`, `music-deny`.

### Task 3: Spotify client

**Files:**
- Create: `server/spotify.ts`
- Test: `server/spotify.test.ts`

`Spotify` takes a `fetch` implementation. It exchanges a code, refreshes a token, plays, pauses, seeks, lists devices, transfers, searches tracks, lists playlists and liked songs. A non-OK play of a missing track returns `unavailable`. Other failures return `failed` and do not invent a new session.

### Task 4: Server wiring

**Files:**
- Modify: `server/index.ts`

On join, `MusicRoom.online`. On socket close, start grace. A ten-second timer calls `offline`. Commands apply, then Spotify is told per speaker. Retries: three tries, 400 ms apart, then `music-deny` reason `spotify`. OAuth: `GET /spotify/login?id=` and `GET /spotify/callback`.

### Task 5: Panel and Haven speaker

**Files:**
- Create: `src/music.ts`
- Modify: `index.html`, `src/main.ts`, `src/net.ts`

Left panel, music button beside Treasures. Phone: opening one tucks the other. Connect Spotify until a token exists. Web Playback SDK device name `Haven`. Reports every five seconds. Handoff lists devices.

### Task 6: Verify

`npm test`, `npm run typecheck`, `npm run build`. Manual pass is the spec's two-account checklist, blocked until `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are set.
