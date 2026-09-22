import { Clock, Vector3, type Scene } from "three";
import type { CharacterId } from "../shared/protocol.ts";
import { CharacterView } from "./animate.ts";
import { loadAssets } from "./assets.ts";
import { FollowCamera } from "./camera.ts";
import { Chat } from "./chat.ts";
import { greatCircleDir, tileCenter } from "./grid.ts";
import { Input } from "./input.ts";
import { Net } from "./net.ts";
import { Player } from "./player.ts";
import { RemotePlayer } from "./remote.ts";
import { scatterWorld, type Building } from "./scatter.ts";
import { createScene } from "./scene.ts";
import { BUILDING_NAMES, GlobeWorld, RoomWorld } from "./world.ts";

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

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
  const doorTileMap = new Map<number, Building>();
  for (const b of buildings) for (const d of b.doorTiles) doorTileMap.set(d, b);

  // building interiors, created lazily per instance and cached
  const rooms = new Map<string, RoomWorld>();
  const getRoom = (b: Building) => {
    let room = rooms.get(b.id);
    if (!room) {
      room = new RoomWorld(b.id, b.kind, assets);
      rooms.set(b.id, room);
    }
    return room;
  };

  const input = new Input();
  const player = new Player(globeWorld);
  const remote = new RemotePlayer();
  const cam = new FollowCamera();

  const localView = new CharacterView(assets, "bee", scene);
  const remoteView = new CharacterView(assets, "donkey", scene);
  remoteView.setVisible(false);

  let myId: 0 | 1 = 0;
  let spawned = false;
  let currentBuilding: Building | null = null;
  cam.snap(player);

  const dot = $("dot");
  const statusText = $("status-text");
  const who = $("who");
  const swapBtn = $("swap") as HTMLButtonElement;
  const enterBtn = $("enter") as HTMLButtonElement;

  function applyCharacters(mine: CharacterId, theirs: CharacterId) {
    player.setCharacter(mine);
    localView.setCharacter(mine);
    remote.character = theirs;
    remoteView.setCharacter(theirs);
    who.textContent = mine === "bee" ? "You are the bee 🐝" : "You are the donkey 🫏";
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

  let doorAction: (() => void) | null = null;
  const refreshDoorAction = () => {
    doorAction = null;
    if (!player.moving) {
      if (player.world.isGlobe) {
        const b = doorTileMap.get(player.tile);
        if (b) {
          enterBtn.textContent = `Enter the ${BUILDING_NAMES[b.kind]} 🚪 (E)`;
          doorAction = () => enterBuilding(b);
        }
      } else if (player.tile === (player.world as RoomWorld).exitTile) {
        enterBtn.textContent = "Go back outside 🚪 (E)";
        doorAction = leaveBuilding;
      }
    }
    enterBtn.hidden = !doorAction;
  };
  enterBtn.addEventListener("click", () => {
    doorAction?.();
    enterBtn.blur();
  });
  addEventListener("keydown", (e) => {
    if (e.code !== "KeyE") return;
    if (document.activeElement instanceof HTMLInputElement) return;
    doorAction?.();
  });

  // ---- networking ----------------------------------------------------------

  const net = new Net({
    onStatus(connected) {
      dot.classList.toggle("on", connected);
      statusText.textContent = connected ? "connected" : "offline — retrying…";
      if (!connected) remote.present = false;
    },
    onMessage(msg) {
      switch (msg.t) {
        case "welcome": {
          myId = msg.id === 0 ? 0 : 1;
          applyCharacters(msg.character, msg.character === "bee" ? "donkey" : "bee");
          if (!spawned) {
            player.spawnAt(myId);
            cam.snap(player);
            spawned = true;
          }
          if (msg.peer) {
            remote.present = true;
            applyCharacters(msg.character, msg.peer.character);
            remote.spawnAt(msg.peer.id === 0 ? 0 : 1);
            if (msg.peer.state) remote.setState(msg.peer.state);
          }
          swapBtn.hidden = false;
          break;
        }
        case "peer-joined": {
          remote.present = true;
          remote.character = msg.character;
          remoteView.setCharacter(msg.character);
          remote.spawnAt(msg.id === 0 ? 0 : 1);
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
          chat.addMessage("peer", remote.character, msg.text);
          break;
        }
        case "characters": {
          applyCharacters(msg.assign[myId], msg.assign[1 - myId]);
          break;
        }
        case "full": {
          $("hud").hidden = true;
          swapBtn.hidden = true;
          const overlay = document.createElement("div");
          overlay.id = "full-overlay";
          overlay.textContent = "This tiny planet already has two hearts on it 💚";
          document.body.append(overlay);
          break;
        }
      }
    },
  });
  net.connect();
  swapBtn.addEventListener("click", () => {
    net.swap();
    swapBtn.blur();
  });

  const chat = new Chat((text) => {
    net.chat(text);
    chat.addMessage("me", player.character, text);
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

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const world = player.world;

    player.update(dt, input, cam.camera);
    cam.update(dt, player);
    refreshDoorAction();

    localView.update(dt, t, world, player.pos, player.quat, player.moving);

    // the partner is visible only when you are in the same world
    const together = remote.present && remote.loc === world.id;
    if (together) {
      if (remoteScene !== world.scene) {
        remoteView.setScene(world.scene);
        remoteScene = world.scene;
      }
      remote.update(dt);
      remoteView.update(dt, t, world, remote.pos, remote.quat, remote.moving);
    }
    remoteView.setVisible(together);

    chat.update(cam.camera, player.pos, player.character, remote.pos, remote.character, together);

    if (world.isGlobe) {
      // keep the sky gradient and the "sun" oriented to the player's sky
      up.copy(player.pos).normalize();
      sky.quaternion.setFromUnitVectors(Y, up);
      cam.camera.getWorldDirection(camRight).cross(up).negate();
      sun.position.copy(player.pos).addScaledVector(up, 40).addScaledVector(camRight, 22);
      hemi.position.copy(up).multiplyScalar(50);
    }

    net.tick(dt, player);
    renderer.render(world.scene, cam.camera);
  });

  // dev hook for scripted tests (see scripts/drive-*.mjs) - not part of the game
  Object.assign(window as object, {
    __tp: {
      player,
      buildings,
      enterBuilding,
      leaveBuilding,
      teleport: (tile: number) => switchWorld(tile, player.forward.clone(), globeWorld),
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
