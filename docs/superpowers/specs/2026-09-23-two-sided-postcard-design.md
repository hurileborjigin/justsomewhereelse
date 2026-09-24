# Two-sided postcards

Design spec for the picture side of the postcard in Haven's treasure boxes.
Status: approved in conversation on 2026-09-23, written up for review.
It extends the treasure boxes spec in `2026-09-23-treasure-boxes-design.md`, which stays the reference for everything it does not change here.

## Purpose

A real postcard has a picture on one side and the writing on the other.
The postcard style in a treasure box gets the same: the writing side stays exactly as it is today, and a picture side is added behind it.
The sender puts a photo there, either a snapshot taken inside Haven with a viewfinder over the world, or a photo uploaded from the device, and adjusts how it is cropped and captioned.
Clicking the card flips it.
The finder opens the box, sees the picture first, and flips the card to read the message.

Along the way the box contents get a structure that says what a postcard is, instead of a bag of optional fields whose meaning depends on the style.

## What changes for players

### The card has two sides

The card in the postcard dialog becomes a flip card.
The writing face is today's card, unchanged.
The picture face sits behind it with the same size and shape.
The card turns around its vertical axis in about 0.6 seconds with a little perspective.
When the visitor prefers reduced motion, it switches without animation.

A small translucent pill at the bottom centre of the card names the other face: "picture side ↻" while the writing face shows, "writing side ↻" while the picture face shows.
Clicking the pill flips the card.
In reading mode a click or tap anywhere on the card flips it too; a drag, for example to select text, does not.
In compose mode a click on the paper of the writing face outside its inputs flips it as well.
On the picture face in compose mode only the pill flips, because dragging on the photo moves the photo.
The face that is turned away takes no clicks or focus, and the message field loses focus when the card turns away from it.

A postcard box holds only the card.
The loose prints that a box shows below a note or in a photo box are not offered for postcards.

### Which face shows first

Reading a postcard that has a picture starts on the picture face, like a real card, and one flip reads the message.
Reading a postcard without a picture starts on the writing face and shows no pill.
Composing starts on the writing face, as today.

### The picture face while composing

While the postcard has no picture, the face shows cream paper with a dashed inner frame, the words "The picture side" in small capitals, and two buttons stacked in the middle: "📷 Take a picture" in the primary style and "Upload a photo" in the secondary style.
"Take a picture" opens photo mode, described below.
"Upload a photo" opens the device's file picker for images only.

Once the postcard has a picture, the photo fills the face.

- Dragging the photo moves it.
- The mouse wheel over the photo and a two-finger pinch zoom it, between 1 and 3 times the size at which it just covers the face.
- A thin translucent zoom slider in the bottom right corner does the same for anyone without a wheel or a touchscreen.
- A caption field sits over the photo in the bottom left corner, set in the postcard handwriting in white ink with a soft dark shadow, placeholder "A caption (optional)…", at most 60 graphemes.
- Three round buttons in the top right corner carry white line icons on a translucent dark disc: a camera to take another picture, a picture frame to upload another photo, and a cross to remove the picture.

The crop the sender leaves is the crop the finder sees.

### The picture face while reading

The photo fills the face with the sender's crop, and the caption sits in the bottom left corner in the same handwriting.
Nothing else is drawn on the picture.

### Photo mode

"Take a picture" hides the postcard dialog without closing it: everything typed so far stays, and the card comes back exactly as it was.
Over the world a viewfinder appears.

- Dark translucent mats cover the screen except a clear window in the middle with a 3 by 2 shape.
  The window is as wide as fits within 92 percent of the screen width and 70 percent of the screen height.
  Thin white corner marks frame the window.
- A big round shutter button sits at the bottom centre.
- "Back to the card" sits in the top left corner.
- A hint line under the window reads "Drag to look around · scroll or pinch to zoom · walk as usual".

Looking around works with a drag anywhere on the mats or the window.
Dragging sideways walks the camera around your character.
Dragging up or down tilts the camera, from a little below its usual angle to nearly straight up, so the sky and the stars can fill the frame.
Zooming with the wheel, a pinch or the zoom slider works as usual.
Walking with the keys or the d-pad works as usual, and the camera keeps its offset relative to where the character faces.

While photo mode is on, the chat panel and its button, the treasure button and panel, the action buttons, the speech bubbles and the status line are hidden.
The d-pad and the zoom slider stay where they are shown today.
The E key does nothing and Enter does not focus the chat.

The shutter button, the space bar or Enter takes the picture.
One frame is rendered at up to three times the screen resolution, so that the window comes out at about 1500 pixels wide where the device allows, exactly the window is cut out of it, and the cut is encoded as a JPEG.
The screen flashes white for a moment.
Photo mode closes, the dialog comes back flipped to the picture face, and the shot is staged there with the focus in the middle and no zoom.
The character in the foreground is part of the shot, like a photo taken over their shoulder.

Escape or "Back to the card" leaves photo mode without a shot and brings the dialog back on the picture face.
Leaving photo mode either way eases the camera back to its usual place behind the character.

Because the sender may have walked during photo mode, a new box is left where the sender stands when they press "Leave it here", not where they stood when they opened the dialog.
When the dialog comes back, the size picker refreshes for the new spot.
The chosen size stays chosen if it still fits, otherwise the picker clears and the dialog asks for a size again.
Editing an existing box never moves it; photo mode while editing only changes the picture.

### Phones

Below 560 pixels of width the writing face turns portrait as it does today, and the picture face takes the same portrait shape.
The photo is cropped for that shape with the same focus and zoom, centred on the same point of the photo, so both players see the same part of the picture as far as the shapes allow.
Dragging and pinching adjust the crop on the phone as they do on the desktop.
In photo mode the viewfinder window keeps its 3 by 2 shape, so a phone held upright shows a wide window in the middle of the screen.

### Editing

Editing a sealed postcard opens the same dialog prefilled with the writing, the dressing and the picture with its crop and caption.
The picture can be moved, zoomed, recaptioned, replaced by a new shot or upload, or removed.
Saving stores the new picture and deletes the file of a picture that was replaced or removed.

### The Treasures panel

The thumbnail on a row of your collection shows the postcard's picture when the box is a postcard, otherwise the first photo or video as today.

## Model

### Contents

A box carries `contents`, one typed unit per style.

```ts
export type Picture = {
  image: MediaRef; // an uploaded photo, kind "image"
  focus: { x: number; y: number }; // 0..1: the point of the photo the card centres on
  zoom: number; // 1..3: 1 means the photo just covers the card
  caption: string; // handwriting over the picture, up to 60 graphemes, may be empty
};

export type Writing = { text: string; stamp: string; place: string; to: string; from: string };

export type BoxContents =
  | { style: "postcard"; picture: Picture | null; writing: Writing }
  | { style: "note"; text: string; media: MediaRef[] }
  | { style: "media"; caption: string; media: MediaRef[] };
```

The `Box` type loses `style`, `text`, `media` and `card` and gains `contents?: BoxContents`.
`contents` is present for the creator and, once the box has been opened, for both players.
A sealed box the partner has not opened carries no `contents` at all, so the style no longer leaks before opening.
`announce` stays a property of the box, outside `contents`.

Limits, as shared constants: `BOX_TEXT_MAX_LEN = 2000` for the text of a postcard or note and for the caption of a photo box, `BOX_MEDIA_MAX = 6` prints in a note or a photo box, `BOX_STAMP_MAX = 2`, `BOX_PLACE_MAX_LEN = 40`, `NAME_MAX_LEN = 24` for the "To" and "from" names, and new `PICTURE_CAPTION_MAX = 60` graphemes, `PICTURE_ZOOM_MIN = 1`, `PICTURE_ZOOM_MAX = 3`.

A postcard is filled when it has words or a picture.
A note is filled when it has words.
A photo box is filled when it has at least one print.

A shared helper `mediaOf(contents)` lists every media reference a contents value holds: the picture's image for a postcard, the prints for the other two styles.

### Crop

One pure function places a photo in a frame.
Given the frame size, the photo size, the focus and the zoom, it returns the photo's left, top, width and height in frame coordinates.

- The scale is the larger of the two ratios frame width over photo width and frame height over photo height, multiplied by the zoom, so the photo always covers the frame.
- The photo is positioned so that the focus point lands at the frame centre, then clamped so that no frame edge shows photo-free space.

Its inverse turns a clamped position back into a focus, so that dragging stores a focus that reproduces exactly what the sender saw.
Both compose and read use the same function, and it is applied again whenever the frame is resized.
The function lives in its own client module without DOM access, so the Node test runner can exercise it.

## Client architecture

### New modules

- `src/crop.ts`: the pure crop placement and its inverse.
- `src/picture.ts`: builds the picture face for compose and for reading.
  In compose it owns the staged picture, the drag, wheel, pinch and slider handling, the caption field and the three round buttons, and reports the picture draft back through callbacks.
  In reading it renders a stored picture.
- `src/photo.ts`: photo mode.
  It shows the viewfinder, turns pointer drags into camera look offsets, hides and restores the HUD through hooks, renders the high-resolution frame, cuts out the window and resolves with a JPEG blob, or with nothing on cancel.

### Changes to existing modules

- `src/camera.ts`: the follow camera accepts a look offset of yaw and tilt.
  Yaw rotates the camera's position around the character; tilt pitches the view direction about the camera's own position.
  Tilt is limited to about -15 to +75 degrees.
  Clearing the offset eases both values back to zero over a few frames.
- `src/postcard.ts`: the card becomes a flip container with two faces and the pill.
  Compose keeps one text field and one set of dressing inputs across the three styles as today, and adds the picture face for the postcard style.
  The draft it reports carries the style, the text, the writing fields, the staged picture (a kept reference or a new blob, plus focus, zoom and caption), the kept prints and the new files, the size and the announce flag.
  Compose exposes a way to refresh the sizes that fit, used when photo mode returns.
- `src/treasures.ts`: builds `contents` from the draft after uploading the new files and the new picture blob, sends `box-place` or `box-edit`, recomputes the placement spot at send time, and hands photo mode the hooks it needs.
- `src/main.ts`: provides photo mode with the renderer, the scene and camera to render a frame, the HUD elements to hide, and the walking mute; compares the welcome message's build id with its own and reloads once when they differ.
- `src/net.ts`: `placeBox` and `editBox` carry `contents` and `announce`.
- `index.html`: the flip and picture face styles, the photo mode overlay and its styles.
- `vite.config.ts`: defines the build id constant and writes the same id to `dist/build-id` at the end of a build.

## Server

### Storage

The `boxes` table is rebuilt once when it still has a `text` column.
The new shape is:

| column | type | notes |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | kept from the old row |
| creator | INTEGER NOT NULL | player id |
| owner | INTEGER | player id, null until kept |
| size | TEXT NOT NULL | `s`, `m` or `l` |
| contents | TEXT NOT NULL | JSON of `BoxContents` |
| announce | INTEGER NOT NULL | 0 or 1 |
| created | INTEGER NOT NULL | ms timestamp |
| opened | INTEGER | ms timestamp, null while sealed |
| label | TEXT | null until labeled |
| origin | TEXT NOT NULL | world id where the box was first left |
| loc | TEXT | world id, null while held |
| tiles | TEXT NOT NULL | JSON array, empty while held |
| fwd | TEXT NOT NULL | JSON array of three numbers |

The migration runs inside one transaction: create the new table, copy every row with its contents folded, drop the old table, rename the new one.
Folding an old row:

- a postcard becomes `{ style: "postcard", picture: null, writing: { text, stamp, place, to, from } }`, with the dressing from the old `card` or empty strings; prints on an old postcard are dropped, and no such box exists in the live database;
- a note becomes `{ style: "note", text, media }`;
- a photo box becomes `{ style: "media", caption: text, media }`.

The store's add takes a `NewBox` with `contents` and `announce`; its edit takes `contents` and `announce`.
The other operations are unchanged.

### Protocol

- `box-place` carries `size`, `contents`, `announce`, `loc`, `tiles` and `fwd`.
- `box-edit` carries `id`, `contents` and `announce`.
- `welcome` gains `build`, the server's build id.
- Filtering means the server omits `contents` unless the recipient created the box or the box has been opened.
- A message in the old flat shape, with `style`, `text`, `media` or `card` at the top level, is refused with `invalid`.

### Validation

Parsing of contents moves into `server/contents.ts`, a module without network code that the unit tests exercise directly.
It takes the raw `contents` value and returns a clean `BoxContents` or null.

- The style must be one of the three.
- Postcard: the text is a string cut at `BOX_TEXT_MAX_LEN` and trimmed; the four dressing fields are cleaned as today; the picture is null, or an object whose `image` is a media reference of kind `image` naming a file the upload endpoint stored, whose `focus.x`, `focus.y` and `zoom` are finite numbers clamped into their ranges, and whose `caption` is a string trimmed and cut at `PICTURE_CAPTION_MAX` graphemes; the postcard must be filled.
- Note: the text is cleaned the same way and must not be empty; `media` is an array of valid media references cut at `BOX_MEDIA_MAX`.
- Photo box: `media` as for a note and must not be empty; the caption is cleaned like the text.
- Anything else, including a missing `contents`, returns null and the request is refused with `invalid`.

### Media lifecycle

- Taking a box back deletes every file in `mediaOf(contents)`.
- Editing deletes every file that was in the old contents and is not in the new ones, which covers a replaced or removed picture and removed prints.
- Files uploaded for a request that is then refused are not tracked; this is the known upload ownership hole, unchanged by this spec.

## Stale tabs

A tab that still runs the old bundle cannot read or send the new box shape.
The build writes an id into the bundle as a compile-time constant and into `dist/build-id`.
The server reads that file at start and reports `dev` when it is missing.
`welcome` carries the id.
A client whose own id differs from the server's, when neither is `dev`, remembers the server's id in session storage and reloads once.
If the ids still differ after that reload, it carries on without reloading again, so a broken build cannot cause a loop.

## Edge cases

- A picture upload that fails keeps the dialog open and shows the error; the staged picture stays so the sender can try again.
- A shot taken on a device whose canvas cannot render at the higher resolution falls back to the screen resolution.
- Photo mode opened while the card is flipped to the picture face returns to the picture face; opened from the empty picture face, it does the same.
- Resizing the window while the picture face shows reapplies the crop to the new frame size.
- A postcard whose picture file is missing on the server shows the writing face and no pill, as if it had no picture.
- The partner opening a box during the sender's photo mode ends the edit as today: the save is refused with `opened` and the dialog says so.

## Testing

- Unit tests: crop placement for a landscape photo in a landscape frame, a portrait photo, a portrait frame, zoom, focus at the edges with clamping, and the inverse reproducing the focus; contents parsing for each style, each limit, a video offered as a picture, a missing file, clamped focus and zoom, an unfilled postcard, and the old flat shape; the store migration from a database in the old shape for all three styles; `mediaOf` for each style.
- Smoke: place a postcard with a picture after uploading it, the partner receives the box without contents, opens it and receives the picture with its crop and caption; edit replaces the picture and the old file is gone from disk; taking back removes the file; refusals for a video as picture, a picture naming a missing file, a postcard with neither words nor picture, and a message in the old flat shape; a reconnect carries the contents back; `welcome` carries `build`.
- Playwright: compose a postcard, flip to the picture face, upload a photo, drag it, zoom it, caption it, flip back, leave the box; the partner opens it and sees the picture face first with the caption, clicks and reads the message; photo mode opens, a drag upward tilts the camera, the shutter returns a staged shot on the picture face; the same on a phone viewport with both faces the same size.
  Screenshots at each step are reviewed for pixel fidelity.
- The Fly deploy workflow keeps running typecheck, unit tests and the smoke test before deploying.

## Out of scope

- Video on the picture side.
- More than one picture per postcard.
- Filters, frames or tints for the picture.
- Sending a photo mode shot to the chat.
