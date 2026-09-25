# Shared music

Design spec for Haven.
Status: approved in conversation on 2026-09-25, written up for review.

## Purpose

The two players can listen to Spotify together while both are logged in, and each can listen alone when the other is not.
Together, both hear the same song at the same place in it, and either of them can change it.
Alone, each returns to the music that was waiting for them.
Sound comes from the Haven tab, and either player can hand only their own ear to another Spotify device.

Spotify has no API for its own Jam.
Haven keeps the sessions and tells each Spotify account what to play.

## Sessions

The server is the authority, the same way it is for chat and treasure boxes.
It does not play sound.
Each Haven tab is a Spotify speaker, and the server tells both accounts what to play.

Each player has one personal session, stored in the planet database.
A session holds the current track, whether it is paused, the position as "this many milliseconds at this server time," and the queue of tracks after the current one.
A track is a Spotify track URI plus the title, artist, album art and duration needed to draw it.
Podcasts and other Spotify types are out of scope.

While both players are logged in, one personal session is the shared session and both speakers follow it.
The other personal session stays frozen.
The shared session is the personal session of whoever was already playing when the second player arrived.
Songs added while together are written onto that session, so they remain with that player afterwards.
The player who joined gets their own session back untouched once they are alone.

"Logged in" means a joined WebSocket, in any world.
Being inside a building does not end the share.

If the player already online is paused, or has no current track, the room stays quiet.
The first player to press play makes their personal session the shared one.
If that session has a paused track, play resumes it.
If it has no current track and the queue is not empty, play starts the first queued track and removes it from the queue.
If it has nothing, play does nothing until they choose a song.

When one player leaves, the other returns to their own session.
If the shared session was already theirs, it keeps going.
The leaver's speaker is paused.
Their personal session stays as it was when they joined, and it resumes the next time they are alone.
If they come back while the other is still playing, they join again and their personal session stays frozen.
A server restart keeps both sessions.
On reconnect, Haven seeks each speaker back to the stored place.

Volume is per speaker.
It is never shared.

## How a session moves

While a song is playing, both clients aim at the position implied by the server time.
While it is paused, the position stays still.

The controls are play, pause, a scrubber, next and add.
There is no previous-track control.
The scrubber can move back to the start of the song.
Add puts a song at the end of the queue that is actually playing.
Next starts the following song.
When the current song reaches its end, the server advances the queue once, so both players change songs together.
If the queue is then empty, the music stops: no current track, paused.
Two commands at once apply in arrival order.

The server clock wins.
Every five seconds each speaker reports where it actually is.
If one speaker is more than two seconds off, and the track and pause flag still match, Haven seeks only that speaker back.
A lagging speaker does not rewrite the session.

A dropped connection waits ten seconds.
If the player comes back inside that window, they are still in the session and Haven seeks their speaker back into place.
After ten seconds it counts as leaving.
Presence for the rest of the world still drops as soon as the socket closes.
Only music uses the grace.

## Choosing songs

Each player picks from their own Spotify: search, their playlists and Liked Songs.
Tracks only.

Play now replaces the current track of the session that is live and starts it immediately.
Add appends to that session's queue.
While sharing, both actions change the shared session, even when that session belongs to the other player.
The joiner's frozen session is not changed.
While alone, the same actions change only that player's session.
If both are online and nothing is playing, the first song played now makes that player's session the shared one.

## Spotify and speakers

Each player signs in with Spotify once.
Haven stores the refresh token in the planet database and uses it to mint short-lived access tokens.
The browser receives only a short-lived token, so the Web Playback SDK can turn that tab into a speaker named Haven.
The client secret stays in the server environment.

The Spotify app runs in development mode, with both accounts on its allow list.
Both accounts need Premium.
The permissions are playback, streaming, the player's playlists and Liked Songs.

The Haven tab is the default speaker.
Handoff lists that player's other Spotify devices and transfers only their playback.
The session stays in Haven.
The other player keeps whatever speaker they were already using.

After a handoff, buttons on that Spotify device count as commands.
A reported track change, pause or resume is applied to the session, and the other player follows.
A report that only differs in position is drift, and Haven seeks that speaker back.
If the Haven tab is in the background and the browser stops the sound, the session does not change.
When the tab is audible again, Haven seeks that speaker to the server position.

Playback commands go through the server, which calls Spotify for each player's current device.
The browser's job is to be a speaker and to send button presses.

## The panel

Music is a panel on the left, in the same glass style as Treasures and Chat.
When it is closed, a music button sits beside the Treasures button.
On a phone, opening Music tucks Treasures away, and opening Treasures tucks Music away.

The open panel shows:

- whether you are listening with the other player or on your own
- the current song, a scrubber, play/pause and next
- the queue
- search
- playlists and Liked Songs
- handoff, as a list of this player's other Spotify devices

Until Spotify is connected, the panel offers Connect Spotify and the other controls do nothing.

## When Spotify or a speaker fails

A failure does not rewrite the session.
The other player's music does not jump because one speaker had a problem.

- Not signed in: the panel offers Connect Spotify.
- The account is not Premium, or the login has gone stale: the panel says so and asks the player to connect again.
- The stored session is kept.
- A song is missing from the other account: the player who can play it still hears it.
- The other panel shows that title with "not on your Spotify," and that speaker stays quiet until the next song that account can play.
- If neither account can play it, both speakers stay quiet and the session still advances when the song's duration elapses.
- The Haven tab is not a speaker yet, or a handed-off device is gone: the panel says there is no speaker.
- The session does not change.
- When a speaker returns, Haven seeks it to the current position.
- A command that does not get through is retried a few times, with a short pause between tries.
- If it still fails, the panel says Spotify did not answer, and Haven stops retrying that command.
- Haven does not skip ahead or rewrite the queue because of a retry.

## Testing

Session rules live in a module that does not call Spotify.
Tests cover:

- the second player joins what is already playing, and their own session freezes
- a paused or empty room stays quiet until someone presses play
- play, pause, seek, next and add change the shared session
- the queue advances once when a song ends
- when one player leaves, the other returns to their own session
- a reconnect inside ten seconds does not count as leaving
- a song one account cannot play stays on the session, and only that speaker waits

Spotify sits behind a small client the tests can fake, so a test can assert that pause was sent to both speakers without a network.
Sign-in, the Haven speaker and handoff are a manual pass with both Premium accounts: sign in, play alone, have the other player join, skip, add, leave, and come back to the song that was waiting.

## Out of scope

Spotify's own Jam, podcasts, a previous-track stack, shared volume, and browsing the other player's library.
