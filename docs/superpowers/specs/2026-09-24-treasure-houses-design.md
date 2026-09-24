# Treasure houses, building ownership and two-step placement

Design spec for Haven.
Status: approved in conversation on 2026-09-24, written up for review.
It builds on `2026-09-23-treasure-boxes-design.md` and `2026-09-23-two-sided-postcard-design.md`, which stay the reference for everything this spec does not change.

## Purpose

Each player gets a treasure house: a large gallery with display bays where every kept box stands with its label in view, so a treasure is easy to find again.
Buildings get owners.
A building is open to both, or owned by one player; the other player enters an owned building only when the owner comes to the door and lets them in.
Placing a box becomes a two-step act: first a shade on the ground shows exactly which tiles the box will take while the player walks to adjust it, then the player confirms and the box is put down.

## Ownership

### Owners

Every building has an owner: player 0 (gloria), player 1 (khurlee), or nobody, which means open to both.
The Hive belongs to gloria and the Copper Hall to khurlee, fixed: nobody can change them.
Every other building (the random houses, towers and barns, the opera house, the ger, the Frauenkirche) starts open to both.

The rules for changing an owner:

- A player may claim a building that is open to both; it becomes theirs.
- The owner may open their building to both again.
- Nobody can give a building to the other player or take one the other player owns.
- The fixed houses refuse every change.

### What players see

Outside, an owned building carries a small pennant beside its door in the owner's colour: honey gold for gloria, copper green for khurlee.
The door button names the owner: "Enter gloria's crooked house (E)", "Enter your crooked house (E)", or "Enter the crooked house (E)" when open to both.
The two treasure houses read "Enter gloria's Hive (E)" and "Enter khurlee's Copper Hall (E)".

Standing on a doorstep also shows a small "Sign" button under the door button.
It opens a short sheet in the style of the Treasures panel:

- open building: "The crooked house is open to both." with the button "Make it mine";
- the player's own building: "The crooked house is yours." with the button "Open it to both";
- the partner's building: "The crooked house is gloria's. Knock and she can let you in.";
- a treasure house: "This is gloria's Hive." or "This is your Copper Hall." with no button.

### Knocking and letting in

At the partner's building the door button reads "Knock at gloria's crooked house (E)".
Pressing it sends a knock through the server; when the owner is not on the planet the knocker gets the toast "gloria is not on the planet right now" and nothing else happens.
Otherwise the owner gets the toast "khurlee is knocking at your crooked house", wherever they are, and the knocker gets "You knocked. gloria will come to the door."
A knock stays pending for ten minutes; knocking again renews it.

When the owner stands at that building's door, on its doorstep outside or on the exit tile inside, and a knock is pending there, the owner's action stack shows "Let khurlee in (E)" above the usual Enter or Leave button.
Pressing it opens the door: the server records a grant and tells both players.
The guest gets the toast "gloria opened the door", and the guest's door button reads "Enter gloria's crooked house (E)".

A grant lasts one visit.
It ends when the guest, having gone in, steps out again; when the guest has not gone in within ten minutes; or when the guest leaves the planet.
While the grant holds the guest may come and go inside freely, and if the owner walks away or logs out the guest may stay.
A guest who logs in inside a building they may no longer enter appears on its doorstep outside.

The owner and anyone entering an open building never knock.

### Trust model

As with terrain today, the server is the source of truth for owners, knocks and grants, and the clients honour them.
The server does not reject position updates; that could be layered on later.
The server knows neither door tiles nor which buildings exist; it validates building ids by the existing world-id pattern and knows the two fixed houses by id.

## The two treasure houses

### Outside

Both are landmarks two tiles long with a doorstep, like the opera house and the Frauenkirche.

- **The Hive** (id `hive`, gloria's) stands on gloria's side of the planet near the opera house: a tall honey-gold hexagonal pavilion with a domed cap, glowing amber honeycomb windows and a round arched door.
- **The Copper Hall** (id `hall`, khurlee's) stands on khurlee's side near the ger and the Frauenkirche: a long dark-brick hall with a green copper roof, a small cupola on the ridge, round windows and an arched timber door.

Their tiles and doorsteps are chosen among tiles the current seeded world leaves free after all scattering (no building, tree, grass, lake, spawn or doorstep), and they are occupied after the scatter has run.
The seeded scatter must not change: every tree, building and grass tuft stays exactly where it is today, so boxes already standing on the globe keep their surroundings.

### Inside: one layout, two skins

A pure module computes the gallery layout once, and both the client and the Blender script use it.
`npm run models` writes the layout to a JSON file that the Blender script reads, so the shelves the players see and the tiles the rules accept cannot drift apart.

The hall is 20 tiles wide and 42 deep.
The door is in the middle of the near wall, on the exit tile, as in every room.
Across the width, from the left wall: L bays against the wall (4 tiles), an aisle (2), a spine of M bays back to back facing both neighbouring aisles (4), an aisle (2), a spine of S shelves back to back facing both ways (2), an aisle (2), L bays against the right wall (4).
Along the depth, the bays run between a row of S shelves along the far wall and an open entrance hall of a few rows by the door, with a pillar tile between neighbouring bays.

The counts are fixed: 18 L bays (nine per long wall), 24 M bays (twelve on each side of the M spine), 46 S shelves (eighteen on each side of the S spine, and ten along the far wall and beside the door).
That is 88 display places.
The aisles and the entrance hall are open floor where a box may also be put down with the usual rules.

Unit tests pin the counts, check that no two bays overlap, that every bay touches an aisle tile from which a player can place into it, and that every aisle tile is reachable from the exit tile.

### Bays

A bay is a raised stone plinth half a unit high, with a pillar between neighbouring bays.
Bay tiles cannot be walked on, but a box can stand on them.
An L bay is 3 by 4 tiles, an M bay 2 by 2, an S shelf 1 tile.
A box's footprint must lie entirely inside one bay whose size is at least the box's size (an L bay also takes an M or an S box), or entirely on open floor.
A box on a bay stands on top of the plinth.

The Hive's hall is honey gold with honeycomb relief on the walls and warm lamps.
The Copper Hall's is slate and dark brick with green copper trim and round windows.
Both halls allow the camera to zoom out far enough to take in most of the hall.

### Labels

Every box that carries a label shows it as a small tag floating above the chest, placed on screen like the name tags over the characters' heads.
This holds in the galleries and anywhere else a labelled box stands.
Sealed boxes show nothing, as today.
Tags behind the camera or far away are hidden.

## Placing a box in two steps

### The shade

"Leave it here" on a new box's card, and "Place here" on a kept or lifted box, no longer put anything down.
For a new box the dialog steps aside, the way it does for photo mode, and placing mode begins; for a kept box placing mode begins straight from the panel.

In placing mode a translucent footprint lies on the ground in front of the player and follows their tile and facing as they walk.
Each tile of the footprint is green where the box may stand and red where it may not: a tree, a building, another box, water, a doorstep, a spawn tile, the partner, or a bay the box does not fit in.
On a bay the shade lies on top of the plinth.

A bar at the bottom of the screen reads "Walk to move the shade" and holds:

- S, M and L buttons for a new box, S picked at the start (a kept box keeps its size and shows no buttons);
- "Put it down (E)", enabled only while every tile is green;
- "Cancel" (Escape does the same).

The chat, the Treasures panel and the action buttons are hidden while placing, as in photo mode; walking works as usual.

### Confirm

"Put it down" places the box on the green tiles.
For a new box it uploads the picture and the prints first, then sends the placement.
A refusal from the server (the partner stepped there, another box landed first) keeps the player in placing mode and shows the reason as a toast.
When the box stands, placing mode ends: a new box's card closes, and a kept box's panel stays closed.

Cancel ends placing mode.
For a new box it brings the card back exactly as it was; for a kept box nothing changes.

The size picker and the "Sizes greyed out" hint leave the card, since the shade shows fit directly.
Editing a box that stands in the world never enters placing mode.

## Server

### Storage

A new table `buildings (id TEXT PRIMARY KEY, owner INTEGER)` holds owners; a missing row means open to both.
The fixed houses are answered from code, not the table.
Knocks and grants live in memory; a server restart simply asks the owner to open again.

### Protocol

Client messages:

- `building-claim` with `id` and `owner`: the sender's own id to claim, or `null` to open to both.
- `knock` with `id`.
- `door-open` with `id`: the owner lets the pending knocker in.

Server messages:

- `building` with `id` and `owner`, to both players after a change.
- `knock` with `id` and `from`, to the owner.
- `door` with `id`, `guest` and `open`, to both players when a grant starts or ends.
- `building-deny` with `op` (`claim`, `knock` or `open`), `id` and `reason`: `invalid` (not a building id), `fixed` (a treasure house), `owner` (the building is not the sender's to change, or the sender already owns it), `away` (the owner is not on the planet), `noknock` (no pending knock to answer), `open` (knocking at a building the sender may already enter).
- `welcome` gains `buildings` (every non-empty owner, the fixed houses included), `doors` (open grants) and `knocks` (pending knocks for the recipient).

The server ends a grant from the position updates it already receives: once the guest's location has been the building, the first update with another location ends it; a guest's disconnect ends it; a grant never used expires after ten minutes.
The access rules live in a pure server module without network code, driven directly by unit tests.

## Client architecture

- `src/gallery.ts`: the pure layout (bays with tiles, size and plaque side; blocked pillar and wall tiles; dimensions) and the bay placement rule.
- `src/ownership.ts`: the mirrored owners, grants and knocks, and the pure door decision (enter, knock, let in) for a player at a building.
- `src/placing.ts`: placing mode: the shade meshes, the bar, per-tile validity, confirm and cancel.
- `src/labels.ts`: the floating box labels.
- `src/footprint.ts` gains a per-tile variant that reports which tiles of a footprint are valid instead of returning null on the first bad one.
- `src/world.ts`: the two new building kinds, rooms with bay tiles that are placeable but not walkable, a per-room camera zoom limit and a floor height per tile for boxes on plinths.
- `src/scatter.ts`: the two houses placed after the scatter.
- `src/treasures.ts`, `src/postcard.ts`: sending goes through placing mode; the size picker leaves the card.
- `src/main.ts`: the door stack (knock, let in, enter, sign), pennants, restoring to the doorstep, and the wiring.
- `assets/blender/houses.py`: the Hive and the Copper Hall outside and their two gallery interiors from the layout JSON.

## Edge cases

- The owner opens their building to both while a knock is pending: the knock is dropped and the knocker may simply enter.
- The owner claims a building while the partner is inside: the partner may stay; leaving and coming back needs a knock.
- A kept box placed in the partner's house during a visit stays there under the usual box rules.
- Placing mode while standing on a doorstep shows the doorstep tiles red.
- Resizing the window while placing keeps the bar at the bottom.
- A box already standing on one of the treasure houses' globe tiles would overlap the house: the chosen tiles must be checked against production boxes before deploying.

## Testing

- Unit: the gallery layout (counts, overlap, reachability, the bay placement rule), the store's owners, the pure access module (claim, open, knock, let in, grant start and end, expiry), the ownership door decision, the per-tile footprint.
- Smoke: claim and each refusal, the fixed houses, knocking at an absent owner, knock then open, the grant ending when the guest's state leaves the building, a disconnect ending a grant, and the welcome carrying owners, doors and knocks.
- Playwright: A claims a house and B's door button reads Knock; B knocks and A gets the toast; A walks to the door and lets B in; B enters; B is kept out before that and after leaving.
  Placing mode shows red over a tree and green on grass, and confirm lands the box on the green tiles.
  In the Hive an L box goes into an L bay and an S box into an S shelf, and an L box over an S shelf stays red.
  Labels float over labelled boxes; the pennant shows on a claimed building.
  Screenshots of both exteriors and both halls on desktop and phone are reviewed for fidelity.

## Out of scope

- Giving a building to the other player, and sending a guest out.
- The server refusing position updates.
- Engraved plaque text on the bays.
- A second floor.
