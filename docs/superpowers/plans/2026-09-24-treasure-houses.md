# Treasure Houses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two large gallery treasure houses (gloria's Hive, khurlee's Copper Hall), building ownership with knock-and-let-in doors, floating box labels, and two-step box placement with a ground shade.

**Architecture:** Owners live in a new SQLite table and knocks/grants in server memory, all decided by a pure `server/access.ts`; the protocol gains claim/knock/door messages. A pure `src/gallery.ts` computes the gallery layout once; `npm run models` exports it to JSON for the Blender script, and the client's `RoomWorld` reads the same module for bay tiles. Placing mode (`src/placing.ts`) replaces direct placement for new and kept boxes, driven by a per-tile footprint check.

**Tech Stack:** TypeScript (Node type stripping on the server), Three.js, Vite, `node:sqlite`, `ws`, Blender Python, Node test runner, Playwright drive scripts.

**Spec:** `docs/superpowers/specs/2026-09-24-treasure-houses-design.md`

## Global Constraints

- Shared and server code runs under Node type stripping: no enums, no namespaces, no parameter properties, explicit `.ts` extensions on imports (`erasableSyntaxOnly` is on).
- `src/gallery.ts` must import nothing from `three` (Node imports it to write the JSON).
- Never use the em dash character anywhere: code, copy, docs, commit messages.
- Commit messages are one line, no trailers, no `Co-Authored-By`.
- Markdown edits: one sentence per line.
- Copy, verbatim from the spec: "Enter gloria's crooked house (E)", "Enter your crooked house (E)", "Enter the crooked house (E)", "Knock at gloria's crooked house (E)", "Let khurlee in (E)", "Sign", "Make it mine", "Open it to both", "The crooked house is open to both.", "The crooked house is yours.", "The crooked house is gloria's. Knock and she can let you in.", "This is gloria's Hive.", "This is your Copper Hall.", "gloria is not on the planet right now", "khurlee is knocking at your crooked house", "You knocked. gloria will come to the door.", "gloria opened the door", "Walk to move the shade", "Put it down (E)", "Cancel". Names and building names are substituted from live data.
- Building names: `hive` = "Hive", `hall` = "Copper Hall"; owner colours: gloria honey gold `#e2b34a`, khurlee copper green `#4f9a7e`.
- Gallery: 20 wide, 42 deep, 18 L bays (3x4), 24 M bays (2x2), 46 S shelves (1x1); plinth height 0.5 units.
- Timers: knocks and unused grants expire after 10 minutes.
- The seeded scatter must stay byte-for-byte identical in outcome: the two houses are occupied after all scattering, on tiles left completely free.
- When regenerating models, only the new GLBs may change; restore every other GLB with `git checkout -- public/models/<file>` before committing (Blender output is not byte-stable).
- UI changes are checked in a real browser with screenshots on desktop (1280x800) and phone (390x844 touch); anything that looks off gets fixed.
- `npm run typecheck`, `npm test`, `npm run smoke`, `npm run build` stay green from Task 2 on.

## Review Focus

- A grant must end when the guest steps out, not when the owner leaves (Task 2 smoke).
- Knocking when the owner is offline must not leave a pending knock that later lets the knocker in (Task 1 unit).
- Existing kept boxes placed via "Place here" still work, now via placing mode (Task 7 drive).
- A box footprint straddling a bay and floor, or two bays, is red (Task 5 unit).
- Players already standing inside a building they no longer may enter land on its doorstep (Task 6 drive).

---

### Task 1: Access rules, owner storage and protocol types

**Files:**
- Modify: `shared/protocol.ts`, `server/store.ts`
- Create: `server/access.ts`, `server/access.test.ts`
- Test: `server/store.test.ts`

**Interfaces:**
- Produces in `shared/protocol.ts`: `FIXED_OWNERS: Record<string, PlayerId> = { hive: 0, hall: 1 }`; `KNOCK_TTL_MS = 10 * 60 * 1000`; `type BuildingOp = "claim" | "knock" | "open"`; `type BuildingDenyReason = "invalid" | "fixed" | "owner" | "away" | "noknock" | "open"`; `type DoorGrant = { id: string; guest: PlayerId }`; client messages `{ t: "building-claim"; id: string; owner: PlayerId | null }`, `{ t: "knock"; id: string }`, `{ t: "door-open"; id: string }`; server messages `{ t: "building"; id: string; owner: PlayerId | null }`, `{ t: "knock"; id: string; from: PlayerId }`, `{ t: "door"; id: string; guest: PlayerId; open: boolean }`, `{ t: "building-deny"; op: BuildingOp; id: string; reason: BuildingDenyReason }`; `welcome` gains `buildings: { id: string; owner: PlayerId }[]`, `doors: DoorGrant[]`, `knocks: { id: string; from: PlayerId }[]`.
- Produces in `server/store.ts`: table `buildings (id TEXT PRIMARY KEY, owner INTEGER NOT NULL)`; `ownerOf(id): PlayerId | null` (fixed houses from `FIXED_OWNERS`), `setOwner(id, owner: PlayerId | null)` (null deletes the row), `owners(): { id: string; owner: PlayerId }[]` (rows plus the fixed houses).
- Produces `server/access.ts`: a class `Access` with no I/O:
  - `constructor(ownerOf: (id) => PlayerId | null, now: () => number)`
  - `claim(me, id, owner): BuildingDenyReason | null` (validates: fixed -> `fixed`; claiming requires current owner null and `owner === me`; opening requires current owner `me` and `owner === null`; anything else `owner`). On opening it drops pending knocks and grants for that building and returns them through `lastEnded(): DoorGrant[]` so the server can broadcast `door` closes.
  - `knock(me, id, ownerOnline: boolean): BuildingDenyReason | null` (owner null or me -> `open`; offline -> `away`; else records `{ id, from: me, at: now }`, replacing an older knock for the same building).
  - `open(me, id): { guest: PlayerId } | BuildingDenyReason` (me must be owner else `owner`; a live knock must exist else `noknock`; creates a grant `{ id, guest, entered: false, at }`, deletes the knock).
  - `mayEnter(p, id): boolean` (owner null, owner p, or a live grant for p).
  - `moved(p, loc): DoorGrant[]` (for each grant of p: if loc === grant.id mark entered; if entered and loc !== grant.id end it; returns ended grants).
  - `left(p): DoorGrant[]` (ends every grant of p).
  - `expire(): DoorGrant[]` (drops knocks older than `KNOCK_TTL_MS` and unentered grants older than it; returns ended grants).
  - `grants(): DoorGrant[]`, `knocksFor(owner): { id; from }[]` (live only).
  - `validBuildingId(id)`: `/^[a-z0-9_-]{1,32}$/` and not `globe`; `claim`, `knock`, `open` return `invalid` otherwise.

- [ ] **Step 1: Write failing tests** in `server/access.test.ts` covering: claim open building, claim by the other player of an owned building refused `owner`, open-to-both by owner, fixed houses `fixed`, invalid id, knock offline `away` leaves no knock (a later `open` returns `noknock`), knock at open or own building `open`, knock then open grants and `mayEnter` true, open by non-owner `owner`, `moved` enter then leave ends the grant, owner walking away does not end it, `left` ends it, `expire` after 10 minutes of a fake clock drops a knock and an unentered grant but not an entered one, opening to both ends grants via `lastEnded`. Extend `server/store.test.ts` with owners round-trip, null deleting the row, fixed houses answered without rows, `owners()` including the fixed houses.
- [ ] **Step 2:** Run `node --test server/access.test.ts server/store.test.ts`; expect failures.
- [ ] **Step 3:** Implement the protocol types, the store methods (create the table in the constructor with `CREATE TABLE IF NOT EXISTS`), and `server/access.ts`.
- [ ] **Step 4:** Run the tests; all pass. `npx tsc --noEmit` may fail only in `server/index.ts` for the new welcome fields (Task 2 adds them); nothing else.
- [ ] **Step 5:** Commit: `Ownership: owners in SQLite and pure access rules for claiming, knocking and letting in`.

### Task 2: Server wiring and smoke coverage

**Files:**
- Modify: `server/index.ts`, `scripts/smoke.mjs`

**Interfaces:**
- Consumes Task 1.
- Produces: the three client messages handled; `building`, `knock`, `door`, `building-deny` sent as the spec says; welcome carrying `buildings`, `doors`, `knocks`; grants ended from `state` messages (`access.moved(id, state.loc)`), from disconnect (`access.left(id)`), and a 30-second interval calling `access.expire()`; every ended grant broadcast as `door` with `open: false`.

- [ ] **Step 1:** Wire an `Access` instance with `store.ownerOf` and `Date.now`. `building-claim`: deny or `store.setOwner` then broadcast `building`, and broadcast `door` closes for `lastEnded()`. `knock`: deny or send `knock` to the owner. `door-open`: deny or broadcast `door` open. Keep the existing message handler's try/catch.
- [ ] **Step 2:** Smoke: extend `scripts/smoke.mjs` after the box section with: welcome contains `buildings` with `hive: 0` and `hall: 1` and empty `doors`; A claims `b0` -> both get `building`; B claiming `b0` -> `owner`; A claiming `hive`... A is 0 so claiming `hive` -> `fixed`; B claims `hive` -> `fixed`; `building-claim` for `globe` -> `invalid`; B knocks at `b0` -> A gets `knock` from 1; A `door-open` `b0` -> both get `door` open guest 1; B sends a state with `loc: "b0"` then `loc: "globe"` -> both get `door` open false; B `door-open` on `b0` -> `owner`; A `door-open` with no knock -> `noknock`; A closes its socket, B knocks at `b0` -> `away`; reconnect A, B knocks, A opens, B disconnects -> A gets `door` open false; A opens `b0` to both -> `building` owner null. Adapt to the smoke's existing client helpers and ordering (messages to both players must both be consumed).
- [ ] **Step 3:** `npm run typecheck && npm test && npm run smoke`; all green.
- [ ] **Step 4:** Commit: `Server: claim, knock and let in, with grants ending when the guest steps out`.

### Task 3: The gallery layout

**Files:**
- Create: `src/gallery.ts`, `src/gallery.test.ts`, `assets/blender/gallery.json`
- Modify: `scripts/models.mjs`

**Interfaces:**
- Produces `src/gallery.ts` (imports `BoxSize` type only):
  - `GALLERY_W = 20`, `GALLERY_H = 42`, `PLINTH_H = 0.5`.
  - `type Bay = { id: number; size: BoxSize; tiles: [number, number][]; faces: "left" | "right" | "up" | "down" }` (`faces` is the side of the bay open to an aisle, in tile axes: left = -i, right = +i, up = -j, down = +j).
  - `GALLERY: { w: number; h: number; exit: [number, number]; bays: Bay[]; pillars: [number, number][] }` computed once from the spec's columns: L bays along both long walls (i 0..3 and 16..19), aisles i 4..5, 10..11, 14..15, M spine i 6..9 (6..7 facing left, 8..9 facing right), S spine i 12..13 (12 facing left, 13 facing right), S shelves along the far wall (j 0) and beside the door; a pillar tile between neighbouring bays along each column; an entrance hall of open floor in the last rows; exit tile `(10, 41)`. Choose exact j ranges so the counts are 18 L, 24 M, 46 S and every bay's open side touches an aisle or the entrance hall.
  - `bayAt(i, j): Bay | null`, `isPillar(i, j): boolean`.
  - `footprintVerdict(tiles: [number, number][], size: BoxSize): boolean[]` (per tile, in input order): if every tile lies in one bay whose size is at least `size` (order s < m < l), all true; otherwise bay and pillar tiles false and floor tiles true (terrain, boxes and doors are the caller's job).
- `scripts/models.mjs`: before running Blender, import `../src/gallery.ts` and write `assets/blender/gallery.json` (`{ w, h, exit, plinth, bays, pillars }`, pretty-printed); commit the JSON.

- [ ] **Step 1:** Tests: counts 18/24/46; no tile in two bays and no bay on a pillar or the exit tile; every bay has at least one tile whose neighbour on its open side is floor; every floor tile is reachable from the exit by 4-neighbour steps over floor; `footprintVerdict` for an L footprint inside an L bay (all true), an M inside an L bay (true), an L over an S shelf and floor (the shelf tile false, floor true), two S tiles across two shelves (both false), all-floor (all true).
- [ ] **Step 2:** Run `node --test src/gallery.test.ts`; fail. Implement. Pass.
- [ ] **Step 3:** Add the JSON export to `scripts/models.mjs` (as a function run before Blender; also runnable alone with `node scripts/models.mjs --layout-only`, which writes the JSON and exits). Run it and commit the JSON.
- [ ] **Step 4:** Commit: `Gallery: one pure layout of 88 bays for both treasure houses, exported for Blender`.

### Task 4: The Hive and the Copper Hall models

**Files:**
- Create: `assets/blender/houses.py`
- Modify: `assets/blender/_common.py` (palette only), `src/assets.ts`
- Generated: `public/models/hive.glb`, `hall.glb`, `room_hive.glb`, `room_hall.glb`

**Interfaces:**
- Consumes `assets/blender/gallery.json`.
- Produces four GLBs following the existing conventions (origin at base centre, front/door on -Y, two-tile exteriors about 2 x 4 units with the long axis along Y like the opera; rooms with floor top at Z=0, centred on the origin, door on the -Y wall, single-sided inward walls, no ceiling, tile (i, j) of a W x H room at x=(i-(W-1)/2)*2, y=-(j-(H-1)/2)*2).
- The Hive outside: honey-gold hexagonal pavilion, domed cap, amber honeycomb windows, round arched door. Inside: honey floor, honeycomb relief panels on the walls, warm lamps along the walls, plinths and pillars per the JSON in a honey-stone tone.
- The Copper Hall outside: dark-brick hall, green copper roof, small cupola, round windows, arched timber door. Inside: slate floor, dark brick walls with green copper trim, round windows, plinths in slate with copper edging, pillars in brick.
- Plinths are boxes of `PLINTH_H` covering each bay's tiles with a small margin; each bay gets a small blank plaque on its open side at floor level.
- `src/assets.ts` registers `hive`, `hall`, `room_hive`, `room_hall`.

- [ ] **Step 1:** Write `houses.py`; run `npm run models`; restore every GLB other than the four new ones.
- [ ] **Step 2:** View the four models: render them in the running game or with a quick Three.js page, screenshot, and check proportions, the door side, and that plinth positions match the JSON (a plinth for bay 0 at its tiles).
- [ ] **Step 3:** Commit: `Models: the Hive and the Copper Hall, outside and as gallery halls`.

### Task 5: The houses in the world, bays in the rooms, per-tile footprints

**Files:**
- Modify: `src/world.ts`, `src/scatter.ts`, `src/footprint.ts`, `src/camera.ts`, `src/treasures.ts`, `src/main.ts`
- Test: `src/footprint.test.ts`, `src/world.test.ts`

**Interfaces:**
- Consumes `src/gallery.ts`, the Task 4 assets.
- Produces:
  - `BuildingKind` gains `"hive" | "hall"`; `BUILDING_NAMES` gains `hive: "Hive"`, `hall: "Copper Hall"`; `ROOM_SPECS` entries for both use the gallery dimensions, blocked tiles = bay tiles plus pillars, `bg` warm dark for the Hive and cool dark for the Hall.
  - `World` gains `canHold(k: number): boolean` (the terrain part of placement: on the globe as today's `!isBlockedFor(k, "donkey")`; in a room, a bay tile is holdable, a pillar or furniture is not, a box-occupied tile is not) and `floorHeight(k: number): number` (0 except `PLINTH_H` on gallery bay tiles). `isBlockedFor` still blocks bay tiles for walking.
  - `RoomWorld.zoomMax: number` (2.2 for existing rooms, 6 for the galleries); `FollowCamera` uses `player.world` zoom max when in a room.
  - `footprintTiles(world, tile, forward, size): number[] | null` (the geometric footprint regardless of rules; null only when the rectangle does not exist or close) and `footprintCheck(world, tiles, size, free): boolean[]`: per tile `free(k)`, and in a gallery also AND-ed with `footprintVerdict`. `footprintFor` stays, implemented as tiles plus all-true check.
  - `main.ts` `canPlaceOn` uses `world.canHold(k)` instead of `!isBlockedFor(k, "donkey")`, keeping door, spawn, exit and partner checks.
  - `treasures.ts` mounts a box at `world.floorHeight` of its first tile in rooms.
  - `scatter.ts`: after all scattering, place the two houses on fixed tiles: the Hive on face 3 near the opera, the Copper Hall on face 2 near the ger. Choose the tiles with a throwaway script that runs the scatter headlessly (or in the dev page via a temporary hook) and lists two-tile pairs plus a door tile that are completely unoccupied (`isFree` true and not grass, not lake, not protected, not a spawn); record the chosen `[face, i, j]` triples as constants with a comment; `occupy` them and push the buildings with ids `hive` and `hall`.
- [ ] **Step 1:** Tests: `footprintCheck` in a gallery room (L into L bay all true; L over an S shelf partly false; floor all true); a `world.test.ts` case that the seeded scatter's building list and occupied-tile set are unchanged except for the two new buildings (compare against a snapshot of ids and tile counts taken before the change, captured in the test as constants).
- [ ] **Step 2:** Implement; typecheck, tests, build.
- [ ] **Step 3:** In the browser: walk to both houses, enter them (open doors in this task: no ownership checks yet besides nothing), leave a box on a bay and on the floor, check the box sits on the plinth, zoom out to see the hall; screenshots of both exteriors and halls, desktop and phone; fix what looks off.
- [ ] **Step 4:** Commit: `World: the treasure houses stand on the planet, their halls hold boxes on plinths`.

### Task 6: Ownership on the client

**Files:**
- Create: `src/ownership.ts`, `src/ownership.test.ts`
- Modify: `src/net.ts`, `src/main.ts`, `index.html`

**Interfaces:**
- Consumes the Task 1 protocol.
- Produces `src/ownership.ts`: class `Ownership` holding owners, grants and incoming knocks from `welcome`, `building`, `door`, `knock`; pure `doorChoice(me, buildingId, ownership): "enter" | "knock"`, `letIn(me, buildingId, ownership): PlayerId | null` (the pending knocker when `me` owns it); `ownerOf(id)`.
- `net.ts`: `claimBuilding(id, owner)`, `knock(id)`, `openDoor(id)`.
- `main.ts`:
  - The door action on a doorstep: "Enter ... (E)" when `doorChoice` is enter, "Knock at ... (E)" otherwise (sends a knock and toasts "You knocked. ..."); inside on the exit tile, "Go back outside" as today.
  - "Let khurlee in (E)" as the first button (E fires it) when `letIn` returns a knocker, both on the doorstep and on the exit tile inside.
  - The "Sign" button under the door button on doorsteps opens a small sheet (styled like the Treasures panel) with the spec's copy and buttons.
  - Toasts for incoming knocks, door opened, deny reasons (`away` -> "gloria is not on the planet right now"; others short and friendly).
  - Pennants: a small pole and flag mesh beside each owned building's door tile on the globe, coloured by owner, added and removed as owners change.
  - `restore`: a saved position inside a building the player may not enter puts them on its doorstep.
  - `__tp` dev hooks: `ownership: () => ({ owners, grants, knocks })`.
- [ ] **Step 1:** Unit tests for `doorChoice` and `letIn`.
- [ ] **Step 2:** Implement; typecheck, tests, smoke, build.
- [ ] **Step 3:** Browser, two players: A claims a house via the sign; B sees Knock; B knocks, A gets the toast; A walks to the door, sees Let khurlee in, presses E; B enters; B leaves and sees Knock again; A opens it to both; B enters freely. Screenshots of the sign sheet, the knock toast, the let-in stack and a pennant, desktop and phone.
- [ ] **Step 4:** Commit: `Doors: owners, pennants, the sign, knocking and letting in`.

### Task 7: Placing mode

**Files:**
- Create: `src/placing.ts`
- Modify: `src/treasures.ts`, `src/postcard.ts`, `src/main.ts`, `index.html`

**Interfaces:**
- Consumes `footprintTiles`, `footprintCheck`, `World.floorHeight`.
- Produces `class Placing` with `start(opts: { size: BoxSize | null; fixedSize?: BoxSize; onConfirm(tiles: number[], size: BoxSize, world: World, forward: Vector3): Promise<void>; onCancel(): void }): void`, `get active(): boolean`, `update()` called each frame (recomputes the shade from the player's tile and facing), `cancel()`.
- Shade: one flat translucent quad per footprint tile slightly above the ground (at `floorHeight` in rooms, radially on the globe), green `#58b368` at 45% opacity or red `#e05a5a`, re-used meshes, removed on end.
- Bar: `#placing` at the bottom with the hint, S/M/L buttons (new boxes only), "Put it down (E)" (disabled unless all green), "Cancel"; E confirms, Escape cancels (capture-phase key listener like photo mode); `body.placing` hides the HUD like `body.photo`.
- Compose: "Leave it here" calls `onSend`, which now sets the dialog away and starts placing; confirm builds contents, uploads, places (`request("place", ...)`), then the card closes; a refusal toasts and stays in placing; cancel brings the card back. Remove the size picker, the hint and `fitsNow` from the card.
- Kept or lifted box "Place here": starts placing with `fixedSize: box.size`; confirm sends `putBox`.
- [ ] **Step 1:** Implement; typecheck, tests, build.
- [ ] **Step 2:** Browser: new postcard, Leave it here, shade appears green, walk next to a tree and see red tiles, pick L, confirm, the box stands on exactly those tiles (compare `__tp.treasures.list()` tiles with the shade's tiles exposed through `__tp.placing()`); cancel returns to the card with its text; a kept box placed into a gallery bay; screenshots desktop and phone.
- [ ] **Step 3:** Commit: `Placing: a ground shade shows where the box lands, and it goes down on confirm`.

### Task 8: Floating labels

**Files:**
- Create: `src/labels.ts`
- Modify: `src/treasures.ts`, `src/main.ts`, `index.html`

**Interfaces:**
- Produces `class BoxLabels` with `update(camera, world, boxes)`: one `.box-label` element per labelled box mounted in the current world, positioned above the chest top (projected like `chat.ts`'s `project`), hidden behind the camera or farther than 40 units, text escaped via `textContent`, pill style matching the name tags but smaller.
- [ ] **Step 1:** Implement, call it each frame after the camera update.
- [ ] **Step 2:** Browser: labelled boxes in a gallery show their tags; relabel updates it; sealed boxes show nothing; screenshots.
- [ ] **Step 3:** Commit: `Labels: every labelled box shows its label above the chest`.

### Task 9: Drive, README and the visual pass

**Files:**
- Create: `scripts/drive-houses.mjs`
- Modify: `scripts/drive-treasure.mjs` (it now places through placing mode), `README.md`

- [ ] **Step 1:** Update `scripts/drive-treasure.mjs` for placing mode (every former direct send now confirms in placing mode); both viewports pass on fresh databases.
- [ ] **Step 2:** `scripts/drive-houses.mjs`: the spec's Playwright list (claim, knock, let in, enter, kept out before and after, shade red over a tree and green on grass, confirm lands on the green tiles, L into an L bay and S into an S shelf in the Hive, L over an S shelf red, labels, pennant); screenshots to `/tmp/haven-houses-*.png`; both viewports pass on fresh databases; fresh-database guard as in the treasure drive.
- [ ] **Step 3:** README: a "Treasure houses" section (one sentence per line) describing the two houses, ownership, knocking and the two-step placement.
- [ ] **Step 4:** Review every screenshot and fix anything that looks off.
- [ ] **Step 5:** `npm run typecheck && npm test && npm run smoke && npm run build`; commit: `Drive and README: treasure houses, doors and two-step placement`.
