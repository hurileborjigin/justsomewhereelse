import { Clock, Vector3 } from "three";
import type { CharacterId } from "../shared/protocol.ts";
import { CharacterView } from "./animate.ts";
import { loadAssets } from "./assets.ts";
import { FollowCamera } from "./camera.ts";
import { Chat } from "./chat.ts";
import { Input } from "./input.ts";
import { Net } from "./net.ts";
import { Player } from "./player.ts";
import { RemotePlayer } from "./remote.ts";
import { scatterWorld } from "./scatter.ts";
import { createScene } from "./scene.ts";

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
  scatterWorld(scene, assets);

  const input = new Input();
  const player = new Player();
  const remote = new RemotePlayer();
  const cam = new FollowCamera();

  const localView = new CharacterView(assets, "bee", scene);
  const remoteView = new CharacterView(assets, "donkey", scene);
  remoteView.setVisible(false);

  let myId: 0 | 1 = 0;
  let spawned = false;
  player.spawnAt(0);
  cam.snap(player);

  const dot = $("dot");
  const statusText = $("status-text");
  const who = $("who");
  const waiting = $("waiting");
  const swapBtn = $("swap") as HTMLButtonElement;

  function applyCharacters(mine: CharacterId, theirs: CharacterId) {
    player.setCharacter(mine);
    localView.setCharacter(mine);
    remote.character = theirs;
    remoteView.setCharacter(theirs);
    who.textContent = mine === "bee" ? "You are the bee 🐝" : "You are the donkey 🫏";
  }

  const net = new Net({
    onStatus(connected) {
      dot.classList.toggle("on", connected);
      statusText.textContent = connected ? "connected" : "offline — retrying…";
      if (!connected) {
        remote.present = false;
        remoteView.setVisible(false);
        waiting.hidden = false;
      }
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
            remoteView.setVisible(true);
          }
          waiting.hidden = remote.present;
          swapBtn.hidden = false;
          break;
        }
        case "peer-joined": {
          remote.present = true;
          remote.character = msg.character;
          remoteView.setCharacter(msg.character);
          remote.spawnAt(msg.id === 0 ? 0 : 1);
          remoteView.setVisible(true);
          waiting.hidden = true;
          break;
        }
        case "peer-left": {
          remote.present = false;
          remoteView.setVisible(false);
          waiting.hidden = false;
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

  const clock = new Clock();
  const up = new Vector3();
  const camRight = new Vector3();
  const Y = new Vector3(0, 1, 0);

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    player.update(dt, input, cam.camera);
    cam.update(dt, player);
    if (remote.present) remote.update(dt);

    localView.update(dt, t, player.pos, player.quat, player.moving);
    if (remote.present) remoteView.update(dt, t, remote.pos, remote.quat, remote.moving);
    chat.update(cam.camera, player.pos, player.character, remote.pos, remote.character, remote.present);

    // keep the sky gradient and the "sun" oriented to the player's sky
    up.copy(player.pos).normalize();
    sky.quaternion.setFromUnitVectors(Y, up);
    cam.camera.getWorldDirection(camRight).cross(up).negate();
    sun.position.copy(player.pos).addScaledVector(up, 40).addScaledVector(camRight, 22);
    hemi.position.copy(up).multiplyScalar(50);

    net.tick(dt, player);
    renderer.render(scene, cam.camera);
  });
}

boot();
