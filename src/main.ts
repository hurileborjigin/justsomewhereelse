import { Clock, Quaternion, Vector3, type Scene } from "three";
import { CHARACTER_OF, type PlayerId, type StateData } from "../shared/protocol.ts";
import { Animals } from "./animals.ts";
import { CharacterView } from "./animate.ts";
import { loadAssets } from "./assets.ts";
import { FollowCamera } from "./camera.ts";
import { Chat } from "./chat.ts";
import { SPAWN_TILES, greatCircleDir, tileCenter } from "./grid.ts";
import { Input } from "./input.ts";
import { Net } from "./net.ts";
import { PhotoMode } from "./photo.ts";
import { Player } from "./player.ts";
import { RemotePlayer } from "./remote.ts";
import { scatterWorld, type Building } from "./scatter.ts";
import { applySkyForHour, createScene } from "./scene.ts";
import { setupTouchControls } from "./touch.ts";
import { chestIcon } from "./postcard.ts";
import { Treasures } from "./treasures.ts";
import { BUILDING_NAMES, GlobeWorld, RoomWorld, nearestFreeTile } from "./world.ts";

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

const AUTH_KEY = "tp-auth";

async function boot() {
  const canvas = $("game") as HTMLCanvasElement;
  const { renderer, scene, sky, sun, hemi } = createScene(canvas);

  const loading = $("loading");
  let assets;
  try {
    assets = await loadAssets();
  } catch (err) {
    loading.textContent = `Could not load the models — run "npm run models" first. (${err})`;
    throw err;
  }
  loading.remove();

  scene.add(assets.globe);
  const globeWorld = new GlobeWorld(scene);
  const buildings = scatterWorld(scene, assets);
  const animals = new Animals(scene, assets, buildings);
  const doorTileMap = new Map<number, Building>();
  for (const b of buildings) for (const d of b.doorTiles) doorTileMap.set(d, b);

  // building interiors, created lazily per instance and cached
  const rooms = new Map<string, RoomWorld>();
  const getRoom = (b: Building) => {
    let room = rooms.get(b.id);
    if (!room) {
      room = new RoomWorld(b.id, b.kind, assets);
      rooms.set(b.id, room);
      treasures.mountWorld(room);
    }
    return room;
  };

  const input = new Input();
  const player = new Player(globeWorld);
  const remote = new RemotePlayer();
  const cam = new FollowCamera();
  setupTouchControls(input, cam);
  const photo = new PhotoMode(renderer, cam, () => renderer.render(player.world.scene, cam.camera));

  const localView = new CharacterView(assets, "bee", scene);
  const remoteView = new CharacterView(assets, "donkey", scene);
  remoteView.setVisible(false);

  let myId: PlayerId = 0;
  let names: [string, string] = ["…", "…"];
  let spawned = false;
  let currentBuilding: Building | null = null;
  cam.snap(player);

  const dot = $("dot");
  const statusText = $("status-text");
  const enterBtn = $("enter") as HTMLButtonElement;
  const boxBtn = $("box-btn") as HTMLButtonElement;

  /** Characters are fixed: identity 0 is the bee, identity 1 the donkey. */
  function applyCharacters() {
    player.setCharacter(CHARACTER_OF[myId]);
    localView.setCharacter(CHARACTER_OF[myId]);
    remote.character = CHARACTER_OF[1 - myId];
    remoteView.setCharacter(CHARACTER_OF[1 - myId]);
    chat.setNames(names[myId], names[1 - myId]);
  }

  // ---- login ---------------------------------------------------------------

  const loginEl = $("login");
  const loginForm = $("login-form") as HTMLFormElement;
  const loginPass = $("login-pass") as HTMLInputElement;
  const loginPass2 = $("login-pass2") as HTMLInputElement;
  const loginNote = $("login-note");
  const loginSubmit = $("login-submit") as HTMLButtonElement;
  const loginError = $("login-error");
  const whoButtons = [...loginForm.querySelectorAll<HTMLButtonElement>("#login-who button")];
  let pickedId: PlayerId | null = null;
  let pendingAuth: { id: PlayerId; pass: string } | null = null;
  let triedStored = false;
  let setupMode = false; // true until the secret word has been created in-game
  let openMode = false; // true when the planet requires no secret word at all
  let lobbyOnline: [boolean, boolean] = [false, false];

  const storedAuth = (): { id: PlayerId; pass: string } | null => {
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY) ?? "null");
    } catch {
      return null;
    }
  };

  for (const btn of whoButtons) {
    btn.addEventListener("click", () => {
      pickedId = Number(btn.dataset.id) === 0 ? 0 : 1;
      refreshLoginForm();
    });
  }
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (pickedId === null) {
      loginError.textContent = "Pick who you are first";
      return;
    }
    const creating = !openMode && setupMode && pickedId === 0;
    if (creating) {
      if (loginPass.value.length < 3) {
        loginError.textContent = "The secret word needs at least 3 characters";
        return;
      }
      if (loginPass.value !== loginPass2.value) {
        loginError.textContent = "The two words don't match";
        return;
      }
    }
    pendingAuth = { id: pickedId, pass: openMode ? "" : loginPass.value };
    loginError.textContent = "";
    net.join(pendingAuth.id, pendingAuth.pass, creating);
  });

  function refreshLoginForm(error?: string) {
    if (error !== undefined) loginError.textContent = error;
    whoButtons.forEach((b, i) => {
      b.textContent = names[i] + (lobbyOnline[i] ? " (already here)" : "");
      b.disabled = lobbyOnline[i];
      if (lobbyOnline[i] && pickedId === i) pickedId = null;
      b.classList.toggle("picked", pickedId === i);
    });
    const creating = !openMode && setupMode && pickedId === 0;
    const waitingForCreator = !openMode && setupMode && pickedId !== 0;
    loginNote.hidden = openMode || !setupMode;
    loginNote.textContent = creating
      ? `Welcome, ${names[0]}! This planet is brand new — choose the secret word you two will share.`
      : `This planet is brand new — ${names[0]} chooses the secret word first 💚`;
    loginPass.placeholder = creating ? "Choose a secret word" : "Secret word";
    loginPass.hidden = openMode || waitingForCreator;
    loginPass2.hidden = !creating;
    loginSubmit.textContent = creating ? "Create it & step onto the planet" : "Step onto the planet";
    loginSubmit.disabled = waitingForCreator;
  }

  function showLogin(error = "") {
    loginEl.hidden = false;
    refreshLoginForm(error);
  }

  // ---- entering & leaving buildings ---------------------------------------

  function switchWorld(tile: number, forward: Vector3, world: GlobeWorld | RoomWorld) {
    player.enterWorld(world, tile, forward);
    localView.setScene(world.scene);
    cam.snap(player);
  }

  function enterBuilding(b: Building) {
    currentBuilding = b;
    const room = getRoom(b);
    const s = room.enterSpawn();
    switchWorld(s.tile, s.forward, room);
  }

  function leaveBuilding() {
    const b = currentBuilding;
    if (!b) return;
    currentBuilding = null;
    const door = b.doorTiles[0];
    const away = greatCircleDir(tileCenter(b.tiles[0]), tileCenter(door), new Vector3());
    switchWorld(door, away, globeWorld);
  }

  /** Resume from a persisted position (or spawn fresh if it can't be applied). */
  function restore(state: StateData | null) {
    if (state) {
      const building = state.loc === "globe" ? null : buildings.find((b) => b.id === state.loc);
      const world = state.loc === "globe" ? globeWorld : building ? getRoom(building) : null;
      if (world) {
        currentBuilding = building ?? null;
        const fwd = new Vector3(0, 0, 1).applyQuaternion(
          new Quaternion(state.q[0], state.q[1], state.q[2], state.q[3]),
        );
        switchWorld(nearestFreeTile(world, state.tile, CHARACTER_OF[myId]), fwd, world);
        return;
      }
    }
    currentBuilding = null;
    player.spawnAt(myId);
    localView.setScene(globeWorld.scene);
    cam.snap(player);
  }

  let doorAction: (() => void) | null = null;
  let boxAction: (() => void) | null = null;
  // runs every frame: touch the DOM only when the label actually changes
  const setText = (e: HTMLElement, text: string) => {
    if (e.textContent !== text) e.textContent = text;
  };
  const refreshActions = () => {
    doorAction = null;
    boxAction = null;
    if (!player.moving && !treasures.dialogOpen) {
      if (player.world.isGlobe) {
        const b = doorTileMap.get(player.tile);
        if (b) {
          setText(enterBtn, `Enter the ${BUILDING_NAMES[b.kind]} 🚪 (E)`);
          doorAction = () => enterBuilding(b);
        }
      } else if (player.tile === (player.world as RoomWorld).exitTile) {
        setText(enterBtn, "Go back outside 🚪 (E)");
        doorAction = leaveBuilding;
      }
      const box = treasures.actionAt(player.world, player.tile, player.forward);
      if (box) {
        // E fires the first visible button, so the box only claims it when alone
        const before = box.label ? `Open “${box.label}” ` : "Open the treasure box ";
        const after = doorAction ? "" : " (E)";
        if (boxBtn.dataset.label !== before + after) {
          boxBtn.dataset.label = before + after;
          boxBtn.replaceChildren(before, chestIcon(), ...(after ? [after] : []));
        }
        boxAction = () => treasures.open(box);
      }
    }
    enterBtn.hidden = !doorAction;
    boxBtn.hidden = !boxAction;
  };
  enterBtn.addEventListener("click", () => {
    doorAction?.();
    enterBtn.blur();
  });
  boxBtn.addEventListener("click", () => {
    boxAction?.();
    boxBtn.blur();
  });
  addEventListener("keydown", (e) => {
    if (e.code !== "KeyE") return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    if (treasures.dialogOpen) return;
    (doorAction ?? boxAction)?.();
  });

  // ---- networking ----------------------------------------------------------

  const net = new Net({
    onStatus(connected) {
      dot.classList.toggle("on", connected);
      statusText.textContent = connected ? "" : "reconnecting…";
      if (!connected) remote.present = false;
    },
    onMessage(msg) {
      switch (msg.t) {
        case "lobby": {
          if (net.joined) break;
          names = msg.names;
          setupMode = msg.setup;
          openMode = msg.open;
          lobbyOnline = msg.online;
          const stored = storedAuth();
          if (!triedStored && !msg.setup && stored && !msg.online[stored.id]) {
            triedStored = true;
            pendingAuth = stored;
            net.join(stored.id, stored.pass);
          } else {
            showLogin();
          }
          break;
        }
        case "deny": {
          localStorage.removeItem(AUTH_KEY);
          if (msg.reason === "exists") setupMode = false;
          const reasons = {
            pass: setupMode ? "That word is too short" : "That's not the secret word 🙈",
            taken: "That one is already playing",
            setup: `${names[0]} chooses the secret word first 💚`,
            exists: "The secret word is already chosen — just enter it",
          } as const;
          showLogin(reasons[msg.reason]);
          break;
        }
        case "welcome": {
          if (pendingAuth) localStorage.setItem(AUTH_KEY, JSON.stringify(pendingAuth));
          loginEl.hidden = true;
          setupMode = false;
          myId = msg.id;
          names = msg.names;
          applyCharacters();
          treasures.setIdentity(myId, names);
          treasures.setAll(msg.boxes); // before restore(): blocked tiles must exist for the nudge
          if (!spawned) {
            restore(msg.state);
            spawned = true;
          }
          remote.present = msg.peer.online;
          if (msg.peer.online) {
            remote.spawnAt(myId === 0 ? 1 : 0);
            if (msg.peer.state) remote.setState(msg.peer.state);
          }
          chat.clear();
          for (const entry of msg.history) {
            chat.addMessage(
              entry.from === myId ? "me" : "peer",
              CHARACTER_OF[entry.from],
              names[entry.from],
              entry,
              false,
            );
          }
          break;
        }
        case "peer-joined": {
          remote.present = true;
          remote.spawnAt(msg.id);
          remote.loc = "globe";
          break;
        }
        case "peer-left": {
          remote.present = false;
          break;
        }
        case "state": {
          remote.setState(msg);
          break;
        }
        case "chat": {
          chat.addMessage(
            msg.from === myId ? "me" : "peer",
            CHARACTER_OF[msg.from],
            names[msg.from],
            msg,
          );
          break;
        }
        case "recalled": {
          chat.removeMessage(msg.id);
          break;
        }
        case "names": {
          names = msg.names;
          chat.setNames(names[myId], names[1 - myId]);
          treasures.setIdentity(myId, names);
          break;
        }
        case "box": {
          treasures.apply(msg.box);
          break;
        }
        case "box-deny": {
          treasures.deny(msg);
          break;
        }
        case "box-gone": {
          treasures.remove(msg.id);
          break;
        }
      }
    },
  });
  net.connect();

  // own messages render when the server echoes them back (that echo carries
  // the id that makes the 2h recall work)
  const chat = new Chat(
    (text, media) => net.chat(text, media),
    () => {
      const name = prompt("Your name on the planet:", names[myId]);
      if (name?.trim()) net.rename(name.trim());
    },
    (id) => net.recall(id),
  );

  const placeName = (loc: string) => {
    if (loc === "globe") return "Tiny Planet";
    const b = buildings.find((x) => x.id === loc);
    return b ? `the ${BUILDING_NAMES[b.kind]}` : "somewhere";
  };

  const treasures = new Treasures(assets, {
    player: () => ({ world: player.world, tile: player.tile, forward: player.forward, moving: player.moving }),
    resolveWorld: (loc) => (loc === "globe" ? globeWorld : (rooms.get(loc) ?? null)),
    placeName,
    canPlaceOn: (world, k) => {
      // the donkey's rule covers trees, buildings, furniture, other boxes AND water
      if (world.isBlockedFor(k, "donkey")) return false;
      if (world.isGlobe) {
        if (doorTileMap.has(k) || SPAWN_TILES.includes(k)) return false;
      } else if (k === (world as RoomWorld).exitTile) {
        return false;
      }
      return !(remote.present && remote.loc === world.id && remote.tile === k);
    },
    onDialog: (open) => input.setMuted(open),
    onPanelOpen: () => {
      if (innerWidth < 640) chat.setOpen(false);
    },
    net,
  });
  // on a phone the two panels would overlap: opening one tucks the other away
  $("chat-open").addEventListener("click", () => {
    if (innerWidth < 640) treasures.setPanelOpen(false);
  });

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    cam.resize();
  };
  addEventListener("resize", resize);
  resize();

  // ---- frame loop -----------------------------------------------------------

  const clock = new Clock();
  const up = new Vector3();
  const camRight = new Vector3();
  const Y = new Vector3(0, 1, 0);
  let remoteScene: Scene | null = null;
  let wasAdjacent = false;
  let hourOverride: number | null = null; // dev hook for testing sky phases

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const world = player.world;

    // the partner is visible only when you are in the same world
    const together = remote.present && remote.loc === world.id;
    player.peerTile = together ? remote.tile : -1;

    player.update(dt, input, cam.camera);
    cam.update(dt, player);
    treasures.update(dt);
    refreshActions();

    // reunion hops: whenever the two end up on neighboring squares
    const adjacent = together && remote.tile >= 0 && world.areNeighbors(player.tile, remote.tile);
    if (adjacent && !wasAdjacent) {
      localView.celebrate();
      remoteView.celebrate();
    }
    wasAdjacent = adjacent;

    localView.update(dt, t, world, player.pos, player.quat, player.moving);

    if (together) {
      if (remoteScene !== world.scene) {
        remoteView.setScene(world.scene);
        remoteScene = world.scene;
      }
      remote.update(dt);
      remoteView.update(dt, t, world, remote.pos, remote.quat, remote.moving);
    }
    remoteView.setVisible(together);

    chat.update(cam.camera, world, player.pos, player.character, remote.pos, remote.character, together);

    if (world.isGlobe) {
      animals.update(dt, t);
      // the sky follows YOUR local clock (hers follows Sydney, his Munich)
      const now = new Date();
      const hour = hourOverride ?? now.getHours() + now.getMinutes() / 60;
      const sunHeight = applySkyForHour(hour, sky, sun, hemi);
      up.copy(player.pos).normalize();
      sky.quaternion.setFromUnitVectors(Y, up);
      cam.camera.getWorldDirection(camRight).cross(up).negate();
      sun.position.copy(player.pos).addScaledVector(up, sunHeight).addScaledVector(camRight, 34);
      hemi.position.copy(up).multiplyScalar(50);
    }

    net.tick(dt, player);
    renderer.render(world.scene, cam.camera);
  });

  // dev hook for scripted tests (see scripts/drive-*.mjs) - not part of the game
  Object.assign(window as object, {
    __tp: {
      player,
      input,
      buildings,
      enterBuilding,
      leaveBuilding,
      teleport: (tile: number) => switchWorld(tile, player.forward.clone(), globeWorld),
      setHour: (h: number | null) => (hourOverride = h),
      animals: () => animals.debug(),
      joined: () => net.joined,
      treasures: { list: () => treasures.list() },
      photo: () => photo.take(),
      lookAt: (tile: number) =>
        switchWorld(
          player.tile,
          greatCircleDir(tileCenter(player.tile), tileCenter(tile), new Vector3()),
          globeWorld,
        ),
      debug: () => ({
        loc: player.world.id,
        tile: player.tile,
        remoteLoc: remote.loc,
        remotePresent: remote.present,
      }),
    },
  });
}

boot();
