# Treasure boxes

Design spec for the treasure-hunting feature of Tiny Planet.
Status: approved in conversation on 2026-09-23, written up for review.

## Purpose

Either player can write a postcard, attach photos or videos, pack it into a treasure box and leave the box anywhere: on the globe or inside any building.
The other player stumbles on the box while walking around, has no idea what is inside, opens it, and may keep it.
Kept boxes live in a personal collection, can be labeled, and can be placed back into the world, for example on the floor of your own house, which then becomes a treasure house you can walk through together.
Success is the moment your partner finds an unmarked box, opens it, and is surprised.

## Concepts and rules

### The box

A box has these properties.

- `creator`: the player who wrote it.
- `owner`: the player who kept it, or none while it has never been kept.
- `size`: `s`, `m` or `l`.
- `text`: the postcard message, at most 2000 characters, may be empty when media is attached.
- `media`: zero to six photos or videos, each an existing media reference from the upload endpoint.
- `announce`: whether the partner may be told that a sealed box is waiting for them.
- `created`: timestamp.
- `opened`: timestamp of the first opening, or none while sealed.
- `label`: an optional short note of at most 40 characters, written by the owner after keeping the box.
- `origin`: the world id where the box was first left, so the postmark stays right after the box moves.
- `loc` and `tiles`: the world id and the footprint tiles while the box stands in the world, or none while it is held in a collection.
- `fwd`: the creator's facing direction at placement, as a unit vector, used to orient the model.

A box is never deleted and its media files are never removed.

### Sizes and footprints

| size | footprint | tiles |
| --- | --- | --- |
| S | 1 by 1 | 1 |
| M | 2 wide by 2 deep | 4 |
| L | 3 wide by 4 deep | 12 |

Columns run across the placing player's facing direction, rows run away from the player.
Column 0 is the player's facing line and row 1 is the square directly in front of the player.
S covers column 0, row 1.
M covers columns 0 and +1 and rows 1 and 2, so it extends to the player's right.
L covers columns -1, 0 and +1 and rows 1 to 4, so it is centered on the facing line.

Every footprint tile must satisfy all of these.

- It exists in the current world.
- It is not blocked by a tree, a building, furniture or another box.
- It is not water, even for the bee.
- It is not a building door step on the globe and not the exit tile of a room.
- It is not one of the two spawn tiles.
- It does not hold the partner.

Grass tiles are allowed.
On the globe the footprint is found by walking neighbor lookups while carrying the heading along the great circle, the same way the barn finds its second tile today.
The rectangle must close: walking forward then sideways must reach the same tile as walking sideways then forward.
Near cube corners a large footprint may fail to close, and then that size does not fit at that spot.

### Ownership rules

- Anyone standing next to a box may open it.
- Only a player who is not the creator may keep a box.
- Only the owner may label a box or place a held box back into the world.
- A placed box keeps its owner, so the owner may pick it up again and the creator still may not.
- Contents are visible to a player only if they created the box or the box has been opened.

## Player flows

### Leaving a box

A 🎁 button sits in the top-left corner of the screen and opens the Treasures panel.
The panel has a "Leave a treasure here" button that opens the postcard in compose mode.
While any postcard dialog is open, walking input and the E key are ignored, and Esc closes the dialog.

The compose dialog shows the sizes that fit where the player currently stands and disables the others with the hint "no room here".
When any size is disabled, a line under the size picker reads "Sizes greyed out do not fit where you stand", so phone users see the hint too.
Sending uploads the attached files one by one through the existing `/media` endpoint, then sends the placement to the server.
The box appears for both players at once.
If the server rejects the placement, the dialog stays open and shows why.

The creator cannot keep the box afterwards, but can open it to reread it and to see whether the partner has opened it yet.

### Finding a box

A sealed box shows no label and nothing about its contents.
Standing on any tile that shares an edge with a footprint tile shows the action button "Open the treasure box 🎁 (E)".
If several boxes touch the player's tile, the one closest to the player's facing direction wins, then the lowest id.
If a door action and a box action apply at the same time, both buttons are shown stacked, the door action first.
E fires the first button, the second one is tapped or clicked.

If the client already holds the contents, because the player created the box or it was opened earlier, it shows the postcard directly.
Otherwise it sends an open request.
The server records the first opening, answers the requester with the full box, and broadcasts the change to both players.
Both clients swing the lid open in the world.
The opener sees the postcard in reading mode.

Below the postcard a player who is not the creator sees an optional label field, "Keep it 🎁" and "Leave it here".
The label field starts with the box's current label, and Enter in it keeps the box.
When the reader already owns the box, because they kept it earlier and placed it here, the button reads "Pick it up 🎁" instead.
Keeping removes the box from the world for both players and adds it to the keeper's collection with the label, if any.
Leaving it closes the dialog and the box stays where it is with its lid open.
The creator sees only a footer with "Still sealed" or "Opened by khurlee on 24 Sep".

### The Treasures panel

The panel opens from the 🎁 button and mirrors the chat panel on the opposite side of the screen.
It has three parts.

1. The waiting line: "2 sealed boxes are waiting for you somewhere 🎁".
   It counts boxes that stand in the world, were created by the partner, are still sealed, and have `announce` on.
   When the count is zero it reads "Nothing announced… but who knows".
   The 🎁 button carries the same count as a badge while the panel is closed.
2. Your collection: one row per box you own, held or placed, with its label or "no label yet", a size marker, who it is from, when you found it, where it stands, and a thumbnail of the first photo or video.
   Held boxes offer Open, Label and "Place here"; placed boxes offer Open and Label.
   Open shows the postcard in reading mode.
   Label asks for the note in a prompt, the way renaming does.
   "Place here" puts the box into the world in front of the player with the same footprint rules as leaving a new box, and tells the player when it does not fit.
3. Boxes you left: one row per box the player created, with its size, "sealed" or "opened", and where it is: "on the planet", the building name, or "kept by khurlee".

Once a box that carries a label stands in the world, the action button reads "Open “our first trip” 🎁 (E)" for both players.

## The postcard

The postcard is the heart of the feature and gets a real design.
It is used in three places: composing a new box, reading a box you opened in the world, and rereading a box from the panel.

### Typography

The message is set in Caveat, a handwriting typeface under the SIL Open Font License that also covers Cyrillic.
The font is vendored through the `@fontsource/caveat` package and bundled by Vite, so the page makes no third-party font requests.
Message text uses weight 500 at about 22 px on desktop and 20 px on phones, line height 1.35, in a blue-ink color.
Line breaks and emoji in the message are preserved.
Labels, names and buttons keep the app's rounded system font.

### Layout

The card is a landscape rectangle in a 3 by 2 ratio, at most 640 px wide, on cream paper with a soft shadow, small rounded corners and a thin warm-gray double border.
A dashed vertical divider stands at about 58 percent of the width.

The left side holds the message.
In reading mode the message scrolls inside the card when it is longer than the card.
In compose mode the left side is a text area styled exactly like the message, with a transparent background, no border and a faint character counter in the bottom corner.

The right side holds the postal dressing.

- A stamp in the top-right corner: a small perforated rectangle with a pastel background, the creator's character emoji inside and the words "TINY PLANET" along its bottom edge.
- A postmark: a thin ink circle with the date and the place, slightly rotated, overlapping the stamp corner in translucent ink.
  The place is "Tiny Planet" for the globe or the building name for a room.
- Address lines: "To: khurlee" followed by three dotted lines, the second of which carries the place in handwriting.
- The sign-off "from gloria" in handwriting at the bottom right.

Photos and videos are shown below the card as prints: white borders like instant-camera photos, alternating slight tilts of about two degrees, and a click opens the existing lightbox.
In compose mode the prints show the staged files with a remove button each, plus an add button.

Below the prints the compose mode shows the size picker with three small chest icons labeled S, M and L and their tile counts, the announce toggle "Let khurlee know a box is waiting" which defaults to on, and the send button "Leave it here 🎁".
Reading mode shows the keep controls or the creator footer as described above.

### Phones

Below 560 px of width the card turns portrait.
The message comes first, the divider becomes horizontal, and the stamp, postmark and address block follow below.
The dialog is scrollable as a whole and the buttons stay reachable at the bottom.

## The 3D chests

A new Blender script `assets/blender/treasure.py` exports `chest_s.glb`, `chest_m.glb` and `chest_l.glb` in the existing flat-shaded palette style.
Each chest has a beveled wooden body, two metal bands, a lock plate on the front and a lid.
The lid is a separate object named `Lid` whose origin lies on the hinge line at the back top edge, so the client can rotate it open around its local X axis.
The chest front faces Blender -Y, like every other model, and the client orients it to face the creator, which is the opposite of `fwd`.

| size | body width by depth by height in units | sits on |
| --- | --- | --- |
| S | 1.2 by 0.9 by 0.8 | one tile, 2 by 2 units |
| M | 3.0 by 3.0 by 1.6 | a 4 by 4 area |
| L | 5.0 by 7.0 by 2.4 | a 6 by 8 area |

Palette additions: a warm chest wood, a darker wood for the bands' shadow lines, a gold for the bands and lock, and an iron gray.
The model is placed at the footprint center: the normalized mean of the tile centers on the globe, the mean of the tile positions in a room.
A sealed box shows a closed lid.
An opened box shows the lid at about 100 degrees, and the transition is a short tween of about half a second.

## Client architecture

### New modules

- `src/footprint.ts`: the pure footprint function.
  Given a world, the player's tile, the facing vector and a size, it returns the ordered footprint tiles or null when the size does not fit.
  It also exposes the per-tile rules so the placement checks and the tests share one implementation.
- `src/treasures.ts`: owns the box list, the 3D groups per world, the dynamic blocked tiles, the adjacency query for the action button, the Treasures panel and the requests to the server.
  It receives a callback that resolves a world id to a loaded world, and is told when a room is created so it can mount that room's boxes.
- `src/postcard.ts`: builds the postcard DOM for compose and reading mode and returns the user's decisions through callbacks.
  It knows nothing about the network.

### Changes to existing modules

- `World` gets `setBlocked(tiles, blocked)`.
  The globe forwards to a new dynamic set in `grid.ts` that `isBlockedFor` and `isFree` consult, so animals route around boxes automatically.
  Rooms toggle entries in their private blocked set.
- `main.ts` wires the module: passes boxes from `welcome` and `box` messages, mounts rooms on creation, and composes the action buttons from the door action and the box action.
- `net.ts` gains one method per new client message.
- `index.html` gains the 🎁 button, the Treasures panel, the postcard dialog container and their styles.
- `assets.ts` registers the three chests.
- `input.ts` gains a way to mute movement while a dialog is open.
- `restore` in `main.ts` nudges the player to the nearest free neighbor when the persisted tile is now inside a footprint.

## Server

### Storage

A new `boxes` table is created on start with `CREATE TABLE IF NOT EXISTS`, next to the existing tables.

| column | type | notes |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| creator | INTEGER NOT NULL | player id |
| owner | INTEGER | player id, null until kept |
| size | TEXT NOT NULL | `s`, `m` or `l` |
| text | TEXT NOT NULL | may be empty |
| media | TEXT NOT NULL | JSON array of media refs |
| announce | INTEGER NOT NULL | 0 or 1 |
| created | INTEGER NOT NULL | ms timestamp |
| opened | INTEGER | ms timestamp, null while sealed |
| label | TEXT | null until labeled |
| origin | TEXT NOT NULL | world id where the box was first left, for the postmark |
| loc | TEXT | world id, null while held |
| tiles | TEXT NOT NULL | JSON array, empty while held |
| fwd | TEXT NOT NULL | JSON array of three numbers |

The store offers: add a box, get one, list all, list those standing in a world, mark opened, keep, label, and put back.

### Protocol

Shared constants: `BOX_TEXT_MAX_LEN = 2000`, `BOX_MEDIA_MAX = 6`, `BOX_LABEL_MAX_LEN = 40`, `BOX_SIZES` with the column and row lists per size, and the `Box` and `BoxSize` types.

New client messages.

- `box-place` with `size`, `text`, `media`, `announce`, `loc`, `tiles`, `fwd`.
- `box-open` with `id`.
- `box-keep` with `id` and an optional `label`.
- `box-label` with `id` and `label`.
- `box-put` with `id`, `loc`, `tiles`, `fwd`.

New server messages.

- `welcome` gains `boxes`, the full list filtered for the recipient.
- `box` with one box, sent to both players after every change, filtered per recipient.
- `box-deny` with `op` (which request it answers: place, open, keep, label or put), an optional `id` when the request named a box, and `reason`, sent only to the requester when a request is refused.
  Reasons: `invalid`, `overlap`, `partner`, `creator`, `owner`, `missing`.

Filtering means the server omits `text` and `media` unless the recipient created the box or the box has been opened.

### Validation

The server does not know the terrain, so terrain rules are the client's job, in line with the existing trust model between the two players.
The server enforces everything it can.

- Text length, media count, label length (a string or nothing), size value, `fwd` shape.
- Each media reference has the upload endpoint's shape and names a file that endpoint actually stored.
- `loc` looks like a building id: 1 to 32 characters of lowercase letters, digits, `_` or `-`.
- The tile count matches the size and all tiles are distinct non-negative integers, below `6 * N * N` on the globe.
- No footprint overlap with another box standing in the same world.
- The footprint does not contain the partner's tile in that world: the live tile when the partner is online, otherwise the persisted one.
- Keep is refused for the creator.
- Label and put are refused for anyone but the owner, and put is refused when the box is not held.
- Open on a missing box is refused.

## Edge cases

- If a room has not been created on a client yet, its boxes are mounted when the player first enters it.
- A `welcome` after a reconnect replaces the whole client-side list and rebuilds the 3D groups.
- A box placed by the partner inside the room you are standing in appears immediately with its blocked tiles.
- If both players place at the same spot at the same moment, the second request is refused with `overlap`.
- Leaving a box on the exact doorstep or exit tile is impossible, so nobody can be walled in.
- The action button never offers a box while the player is mid-step, matching the door behavior.

## Testing

- Unit tests with the Node test runner, a new `npm test` script, for the store's box operations and for the footprint function.
  Footprint tests cover all three sizes in a room grid, near a globe face edge, and at a cube corner where L must fail to close.
- The smoke test grows to cover: place, contents hidden from the partner until opened, open, keep with a label, label edit, put back, persistence across a reconnect, and the refusals for creator keep, non-owner label, and overlapping footprints.
- A new `scripts/drive-treasure.mjs` Playwright run: player A leaves an S box, player B walks up, opens it, keeps it with a label, then places it inside a house, with screenshots for both sides at each step.
- A manual pass on desktop and on a phone for the postcard layout in both orientations.
- `npm run typecheck` stays clean.
- The Fly deploy workflow runs typecheck, unit tests and the smoke test before deploying.

## Out of scope

- Taking back or deleting your own sealed box.
- Voice notes or drawings inside boxes.
- A sparkle or glow that helps spotting sealed boxes from afar.
- Hanging box photos on the existing room picture frames.
