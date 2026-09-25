import { Quaternion, Timer, Vector3, type Scene } from "three";
import { CHARACTER_OF, FIXED_OWNERS, type BuildingDenyReason, type PlayerId, type StateData } from "../shared/protocol.ts";
import { Animals } from "./animals.ts";
import { CharacterView } from "./animate.ts";
import { loadAssets } from "./assets.ts";
import { FollowCamera } from "./camera.ts";
import { Chat } from "./chat.ts";
import { el, placeMusicBeside, toast } from "./dom.ts";
import { SPAWN_TILES, greatCircleDir, isBlockedFor, neighborsOf, tileCenter } from "./grid.ts";
import { Input } from "./input.ts";
import { BoxLabels } from "./labels.ts";
import { DragLook } from "./look.ts";
import { Music } from "./music.ts";
import { Net } from "./net.ts";
import { Ownership, buildingPhrase, doorChoice, letIn, signText } from "./ownership.ts";
import { Pennants } from "./pennant.ts";
import { CameraFade } from "./fade.ts";
import { PHOTO_AIM, PhotoMode } from "./photo.ts";
import { Placing } from "./placing.ts";
import { Player } from "./player.ts";
import { RemotePlayer } from "./remote.ts";
import { scatterWorld, type Building } from "./scatter.ts";
import { applySkyForHour, createScene } from "./scene.ts";
import { setupTouchControls } from "./touch.ts";
import { chestIcon } from "./postcard.ts";
import { Treasures } from "./treasures.ts";
import { BUILDING_NAMES, GlobeWorld, RoomWorld, nearestFreeTile, type World } from "./world.ts";

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

const AUTH_KEY = "tp-auth";

/** True when this tab runs an older bundle than the server serves and has not reloaded for it yet. */
function staleBundle(serverBuild: string): boolean {
  if (import.meta.env.DEV) return false; // the dev bundle (a fresh timestamp each run) is never stale
  if (serverBuild === "dev" || serverBuild === __BUILD_ID__) return false;
  const key = "tp-reloaded-for";
  try {
    if (sessionStorage.getItem(key) === serverBuild) return false; // reloaded already; carry on rather than loop
    sessionStorage.setItem(key, serverBuild);
  } catch {
    return false;
  }
  return true;
}

async function boot() {
  const canvas = $("game") as HTMLCanvasElement;
  const { renderer, scene, sky, sun, hemi } = createScene(canvas);

  const loading = $("loading");
  let assets;
  try {
    assets = await loadAssets();
  } catch (err) {
    loading.textContent = `Could not load the models. Run "npm run models" first. (${err})`;
    throw err;
  }
  loading.remove();

  scene.add(assets.globe);
  const globeWorld = new GlobeWorld(scene);
  const buildings = scatterWorld(scene, assets);
  const fade = new CameraFade(scene); // buildings (and chests) between the camera and the character fade out
  const animals = new Animals(scene, assets, buildings);
  const doorTileMap = new Map<number, Building>();
  for (const b of buildings) for (const d of b.doorTiles) doorTileMap.set(d, b);
  // who owns what, mirrored from the server; the fixed houses fly their pennants from the start
  const ownership = new Ownership();
  const pennants = new Pennants(scene, buildings);
  pennants.sync((id) => ownership.ownerOf(id));

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
  new DragLook(canvas, cam, () => photo.isActive);

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
  const letInBtn = $("let-in") as HTMLButtonElement;
  const signBtn = $("sign-btn") as HTMLButtonElement;

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
      ? `Welcome, ${names[0]}! This planet is brand new: choose the secret word you two will share.`
      : `This planet is brand new: ${names[0]} chooses the secret word first 💚`;
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

  /** Out onto the building's first doorstep, facing away from it. */
  function stepOutOf(b: Building) {
    currentBuilding = null;
    const door = b.doorTiles[0];
    const away = greatCircleDir(tileCenter(b.tiles[0]), tileCenter(door), new Vector3());
    switchWorld(door, away, globeWorld);
  }

  function leaveBuilding() {
    if (currentBuilding) stepOutOf(currentBuilding);
  }

  /** Resume from a persisted position (or spawn fresh if it can't be applied). */
  function restore(state: StateData | null) {
    if (state) {
      const building = state.loc === "globe" ? null : buildings.find((b) => b.id === state.loc);
      // saved inside a building this player may no longer enter: back on its doorstep
      if (building && !ownership.mayEnter(myId, building.id)) {
        stepOutOf(building);
        return;
      }
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

  // ---- doors: owners, knocking, letting in, the sign ------------------------

  const nameOf = (id: string) => {
    const b = buildings.find((x) => x.id === id);
    return b ? BUILDING_NAMES[b.kind] : "building";
  };
  /** "the crooked house", "your crooked house" or "gloria's crooked house". */
  const phrase = (b: Building) => buildingPhrase(BUILDING_NAMES[b.kind], ownership.ownerOf(b.id), myId, names);

  function knockAt(b: Building) {
    const owner = ownership.ownerOf(b.id);
    if (owner === null || owner === myId) return;
    net.knock(b.id);
    ownership.knockSent(b.id);
    // an absent owner is answered by the server's refusal instead
    if (remote.present) toast(`You knocked. ${names[owner]} will come to the door.`);
  }

  const DENY_TEXT: Record<BuildingDenyReason, (id: string) => string> = {
    away: (id) => `${names[ownership.ownerOf(id) ?? 1 - myId]} is not on the planet right now`,
    owner: () => "That is not yours to change",
    fixed: (id) => `The ${nameOf(id)} always belongs to ${names[FIXED_OWNERS[id] ?? 0]}`,
    noknock: () => "Nobody is knocking right now",
    open: () => "You can walk right in",
    invalid: () => "That door does not open",
  };

  const signEl = $("sign");
  const signTitle = $("sign-title");
  const signTextEl = $("sign-text");
  const signAction = $("sign-action") as HTMLButtonElement;
  let signAt: Building | null = null;
  const renderSign = () => {
    const b = signAt;
    if (!b) return;
    const name = BUILDING_NAMES[b.kind];
    const s = signText(b.id, name, ownership.ownerOf(b.id), myId, names);
    setText(signTitle, name[0].toUpperCase() + name.slice(1));
    setText(signTextEl, s.text);
    signAction.hidden = s.action === null;
    setText(signAction, s.action === "open" ? "Open it to both" : "Make it mine");
  };
  function setSign(b: Building | null) {
    if (!b && !signAt) return; // nothing to close: leave the walking mute to whoever owns it (photo mode)
    signAt = b;
    signEl.hidden = !b;
    input.setMuted(!!b || treasures.dialogOpen);
    renderSign();
  }
  signBtn.addEventListener("click", () => {
    const b = doorTileMap.get(player.tile);
    if (player.world.isGlobe && b) setSign(b);
    signBtn.blur();
  });
  $("sign-close").addEventListener("click", () => setSign(null));
  /** Photo mode: the sign steps away first, it has no place in the viewfinder. */
  function takePhoto() {
    if (placing.active) return Promise.resolve(null); // the shade and the viewfinder never share the screen
    setSign(null);
    input.setMuted(false); // walking works while framing a shot (the Treasures dialog mutes again afterwards)
    return photo.take(PHOTO_AIM[player.character]);
  }
  signAction.addEventListener("click", () => {
    if (!signAt) return;
    const owner = ownership.ownerOf(signAt.id);
    net.claimBuilding(signAt.id, owner === null ? myId : null);
    signAction.blur();
  });
  addEventListener("keydown", (e) => {
    if (e.code === "Escape" && signAt) setSign(null);
  });

  let letInAction: (() => void) | null = null;
  let doorAction: (() => void) | null = null;
  let boxAction: (() => void) | null = null;
  // runs every frame: touch the DOM only when the label actually changes
  function setText(e: HTMLElement, text: string) {
    if (e.textContent !== text) e.textContent = text;
  }
  /** An action button's label: text, an optional icon, and the " (E)" hint that touch phones hide (no E key there). */
  function setAction(btn: HTMLElement, text: string, key: boolean, icon?: () => Node) {
    const id = `${text}|${key}|${!!icon}`;
    if (btn.dataset.label === id) return;
    btn.dataset.label = id;
    const hint = key ? [el("span", "key-hint", " (E)")] : [];
    btn.replaceChildren(text, ...(icon ? [icon()] : []), ...hint);
  }
  const refreshActions = () => {
    letInAction = null;
    doorAction = null;
    boxAction = null;
    let doorstep: Building | null = null;
    if (!player.moving && !treasures.dialogOpen && !signAt) {
      // the building whose door this player stands at, outside on its doorstep or inside on the exit tile
      const outside = player.world.isGlobe;
      doorstep = outside ? (doorTileMap.get(player.tile) ?? null) : null;
      const inside = !outside && player.tile === (player.world as RoomWorld).exitTile ? currentBuilding : null;
      const at = doorstep ?? inside;
      const guest = at ? letIn(myId, at.id, ownership) : null;
      if (at && guest !== null) {
        setAction(letInBtn, `Let ${names[guest]} in`, true);
        letInAction = () => {
          // the button goes at once, even within this frame: a second tap cannot send a second door-open
          ownership.answered(at.id);
          letInAction = null;
          letInBtn.hidden = true;
          net.openDoor(at.id);
        };
      }
      // E fires the first visible button, so only that one shows (E)
      const e = !letInAction;
      if (doorstep) {
        const b = doorstep;
        if (doorChoice(myId, b.id, ownership) === "enter") {
          setAction(enterBtn, `Enter ${phrase(b)}\u00a0🚪`, e);
          doorAction = () => enterBuilding(b);
        } else {
          setAction(enterBtn, `Knock at ${phrase(b)}\u00a0🚪`, e);
          doorAction = () => knockAt(b);
        }
      } else if (inside) {
        setAction(enterBtn, "Go back outside\u00a0🚪", e); // the door never wraps onto a line of its own
        doorAction = leaveBuilding;
      }
      const box = treasures.actionAt(player.world, player.tile, player.forward);
      if (box) {
        const text = box.label ? `Open “${box.label}” ` : "Open the treasure box ";
        setAction(boxBtn, text, !letInAction && !doorAction, chestIcon);
        boxAction = () => treasures.open(box);
      }
    }
    letInBtn.hidden = !letInAction;
    enterBtn.hidden = !doorAction;
    signBtn.hidden = !doorstep;
    boxBtn.hidden = !boxAction;
  };
  letInBtn.addEventListener("click", () => {
    letInAction?.();
    letInBtn.blur();
  });
  enterBtn.addEventListener("click", () => {
    doorAction?.();
    enterBtn.blur();
  });
  boxBtn.addEventListener("click", () => {
    boxAction?.();
    boxBtn.blur();
  });
  addEventListener("keydown", (e) => {
    if (e.code !== "KeyE" || e.repeat) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    if (treasures.dialogOpen || signAt) return;
    (letInAction ?? doorAction ?? boxAction)?.();
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
          if (staleBundle(msg.build)) {
            location.reload();
            break;
          }
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
            exists: "The secret word is already chosen, just enter it",
          } as const;
          showLogin(reasons[msg.reason]);
          break;
        }
        case "welcome": {
          if (staleBundle(msg.build)) {
            location.reload();
            break;
          }
          if (pendingAuth) localStorage.setItem(AUTH_KEY, JSON.stringify(pendingAuth));
          triedStored = false; // a dropped line comes back in with the stored word, not the login screen
          loginEl.hidden = true;
          setupMode = false;
          myId = msg.id;
          names = msg.names;
          applyCharacters();
          treasures.setIdentity(myId, names);
          treasures.setAll(msg.boxes); // before restore(): blocked tiles must exist for the nudge
          ownership.reset(msg); // before restore(): a building this player may not enter puts them outside
          pennants.sync((id) => ownership.ownerOf(id));
          renderSign();
          if (!spawned) {
            restore(msg.state);
            spawned = true;
          }
          remote.present = msg.peer.online;
          if (msg.peer.online) {
            remote.spawnAt(myId === 0 ? 1 : 0);
            if (msg.peer.state) remote.setState(msg.peer.state);
          }
          music.show(msg.music);
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
        case "building": {
          const before = ownership.ownerOf(msg.id);
          const waited = ownership.waiting(myId, msg.id);
          ownership.setOwner(msg.id, msg.owner);
          pennants.set(msg.id, msg.owner);
          renderSign();
          if (msg.owner === null && before !== null && before !== myId && waited) {
            toast(`The ${nameOf(msg.id)} is open to both now`);
          }
          break;
        }
        case "knock": {
          ownership.knocked(msg.id, msg.from);
          toast(`${names[msg.from]} is knocking at your ${nameOf(msg.id)}`);
          break;
        }
        case "door": {
          ownership.door(msg.id, msg.guest, msg.open);
          const owner = ownership.ownerOf(msg.id);
          if (msg.open && msg.guest === myId && owner !== null) toast(`${names[owner]} opened the door`);
          break;
        }
        case "building-deny": {
          if (msg.op === "knock") ownership.knockDenied(msg.id);
          toast(DENY_TEXT[msg.reason](msg.id));
          break;
        }
        case "music":
          music.show(msg.view);
          break;
        case "music-auth":
          music.auth(msg.url);
          break;
        case "music-token":
          music.token(msg.access);
          break;
        case "music-catalog":
          music.catalog(msg.catalog);
          break;
        case "music-devices":
          music.devices(msg.devices);
          break;
        case "music-deny":
          music.deny(msg.reason);
          break;
      }
    },
  });
  net.connect();

  // own messages render when the server echoes them back (that echo carries
  // the id that makes the 2h recall work)
  const chat = new Chat(
    (text, media) => net.chat(text, media),
    (id) => net.recall(id),
  );

  const placeName = (loc: string) => {
    if (loc === "globe") return "Haven";
    const b = buildings.find((x) => x.id === loc);
    return b ? `the ${BUILDING_NAMES[b.kind]}` : "somewhere";
  };

  /** Per-tile placement rule: may part of a box stand on tile `k` of `world`? */
  const canPlaceOn = (world: World, k: number) => {
    // terrain: trees, buildings, furniture, pillars, other boxes and water refuse; gallery bays hold
    if (!world.canHold(k)) return false;
    if (world.isGlobe) {
      if (doorTileMap.has(k) || SPAWN_TILES.includes(k)) return false;
    } else if (k === (world as RoomWorld).exitTile) {
      return false;
    }
    return !(remote.present && remote.loc === world.id && remote.tile === k);
  };
  // walking works while placing (the shade follows); the card or the sign mute it again afterwards
  const placing = new Placing({
    player: () => ({ world: player.world, tile: player.tile, forward: player.forward }),
    canPlaceOn,
    onActive: (on) => {
      if (on) setSign(null);
      input.setMuted(!on && (treasures.dialogOpen || signAt !== null));
    },
    // "Put it down" waits while the line is down, or while an earlier box is still unanswered
    ready: () => net.joined && !treasures.unanswered,
  });

  const treasures = new Treasures(assets, {
    currentWorld: () => player.world,
    resolveWorld: (loc) => (loc === "globe" ? globeWorld : (rooms.get(loc) ?? null)),
    placeName,
    placing,
    onDialog: (open) => input.setMuted((open || signAt !== null) && !placing.active),
    onPanelOpen: () => {
      if (innerWidth < 640) {
        chat.setOpen(false);
        music.setOpen(false);
      }
    },
    takePicture: takePhoto,
    cancelPicture: () => photo.cancel(),
    fade,
    net,
  });
  const music = new Music(net);
  const boxLabels = new BoxLabels($("box-labels"));
  // on a phone the two panels would overlap: opening one tucks the other away
  $("chat-open").addEventListener("click", () => {
    if (innerWidth < 640) {
      treasures.setPanelOpen(false);
      music.setOpen(false);
    }
  });
  $("music-open").addEventListener("click", () => {
    if (innerWidth < 640) {
      treasures.setPanelOpen(false);
      chat.setOpen(false);
    }
  });

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    cam.resize();
    placeMusicBeside();
  };
  addEventListener("resize", resize);
  // a phone floats the toast at the top: it goes below whichever panel is open instead of over it
  const panels = [$("treasure-panel"), $("chat-panel")];
  const panelsObserver = new ResizeObserver(() => {
    const bottom = Math.max(0, ...panels.map((p) => p.getBoundingClientRect()).map((r) => (r.height > 0 ? r.bottom : 0)));
    document.documentElement.style.setProperty("--panels-bottom", `${Math.round(bottom)}px`);
  });
  for (const p of panels) panelsObserver.observe(p);
  resize();

  // ---- frame loop -----------------------------------------------------------

  const timer = new Timer();
  timer.connect(document); // a hidden tab resumes without one huge step
  const up = new Vector3();
  const _chest = new Vector3();
  const camRight = new Vector3();
  const Y = new Vector3(0, 1, 0);
  let remoteScene: Scene | null = null;
  let wasAdjacent = false;
  let hourOverride: number | null = null; // dev hook for testing sky phases

  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    const world = player.world;

    // the partner is visible only when you are in the same world
    const together = remote.present && remote.loc === world.id;
    player.peerTile = together ? remote.tile : -1;

    player.update(dt, input, cam.camera, cam.turned);
    cam.update(dt, player);
    placing.update();
    // anything hiding the character (say the tall Hive right behind a player who just stepped out, or a chest) fades
    fade.update(dt, cam.camera, world.scene, _chest.copy(player.pos).addScaledVector(world.up(player.pos, up), 0.5));
    treasures.update(dt);
    refreshActions();

    // reunion hops: whenever the two end up on neighboring squares
    const adjacent = together && remote.tile >= 0 && world.areNeighbors(player.tile, remote.tile);
    if (adjacent && !wasAdjacent) {
      localView.celebrate();
      remoteView.celebrate();
    }
    wasAdjacent = adjacent;

    // whoever has a box in their pocket carries it on their back
    localView.setCarrying(treasures.carrying(myId));
    remoteView.setCarrying(treasures.carrying(myId === 0 ? 1 : 0));
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
    boxLabels.update(cam.camera, world, treasures.mountedBoxes());

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

    music.tick(dt, world.isGlobe);
    net.tick(dt, player);
    if (world instanceof RoomWorld) world.faceCamera(cam.camera.position);
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
      ownership: () => ownership.snapshot(),
      pennants: () => pennants.debug(),
      fade: () => fade.debug(),
      buildingVisible: (id: string) => scene.children.find((o) => o.userData.building === id)?.visible,
      neighbors: (tile: number) => neighborsOf(tile),
      walkable: (tile: number) => !isBlockedFor(tile, false) && !doorTileMap.has(tile),
      treasures: {
        list: () => treasures.list(),
        // where each chest in the current world stands: its height shows a box on a plinth
        mounted: () => treasures.mountedBoxes().map((m) => ({ id: m.box.id, loc: m.world.id, y: m.pos.y })),
      },
      photo: takePhoto,
      placing: () => placing.debug(),
      walls: () => (player.world instanceof RoomWorld ? player.world.wallsShown() : null),
      look: () => cam.look,
      turned: () => cam.turned,
      localView,
      remoteView,
      camPos: () => cam.camera.position.toArray(),
      // raw requests, for drives that need many boxes set up quickly (drive-houses' labelled hall)
      net,
      zoom: (f: number) => cam.setZoomFraction(f),
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
