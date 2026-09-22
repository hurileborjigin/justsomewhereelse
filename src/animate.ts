import {
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Object3D,
  type Quaternion,
  type Scene,
} from "three";
import { CHARACTERS, SURFACE, type CharacterId } from "../shared/protocol.ts";
import { node, type Assets } from "./assets.ts";
import { dampAngle } from "./math.ts";

const _up = new Vector3();
const Z = new Vector3(0, 0, 1);

/**
 * Owns the visible model for one character (local or remote) and applies all
 * procedural animation: bee wing flutter + hover bob, donkey leg swing,
 * waddle and boing, plus a blob shadow glued to the tile surface.
 * All animation is code-driven via named GLB nodes - no baked animations.
 */
export class CharacterView {
  container = new Group();
  character: CharacterId | null = null;

  private model: Group | null = null;
  private wings: Object3D[] = [];
  private ears: Object3D[] = [];
  private legs: Object3D[] = [];
  private shadow: Mesh;
  private walkPhase = 0;

  constructor(
    private assets: Assets,
    character: CharacterId,
    scene: Scene,
  ) {
    this.shadow = makeBlobShadow();
    scene.add(this.container, this.shadow);
    this.setCharacter(character);
  }

  setCharacter(c: CharacterId) {
    if (this.character === c) return;
    this.character = c;
    if (this.model) this.container.remove(this.model);
    const model = this.assets[c].clone(true);
    this.model = model;
    this.container.add(model);
    if (c === "bee") {
      this.wings = [node(model, "WingL"), node(model, "WingR")];
      this.ears = [];
      this.legs = [];
      this.shadow.scale.setScalar(0.4);
    } else {
      this.wings = [];
      this.ears = [node(model, "EarL"), node(model, "EarR")];
      this.legs = ["LegFL", "LegFR", "LegBL", "LegBR"].map((n) => node(model, n));
      this.shadow.scale.setScalar(0.6);
    }
  }

  setVisible(v: boolean) {
    this.container.visible = v;
    this.shadow.visible = v;
  }

  update(dt: number, t: number, pos: Vector3, quat: Quaternion, moving: boolean) {
    const model = this.model;
    if (!model || !this.character) return;
    const def = CHARACTERS[this.character];
    this.walkPhase += dt * (moving ? def.speed * 3 : 0);
    const w = this.walkPhase;
    const up = _up.copy(pos).normalize();

    this.container.position.copy(pos);
    this.container.quaternion.copy(quat);

    if (this.character === "bee") {
      this.container.position.addScaledVector(up, 0.08 * Math.sin(t * 3));
      const flap = Math.sin(t * 46) * (moving ? 0.95 : 0.55);
      this.wings[0].rotation.z = 0.25 + flap;
      this.wings[1].rotation.z = -0.25 - flap;
      model.rotation.x = dampAngle(model.rotation.x, moving ? 0.22 : 0, 8, dt);
    } else {
      if (moving) this.container.position.addScaledVector(up, Math.abs(Math.sin(w)) * 0.09);
      model.rotation.z = dampAngle(model.rotation.z, moving ? Math.sin(w) * 0.07 : 0, 12, dt);
      model.scale.y = dampAngle(model.scale.y, moving ? 1 + 0.05 * Math.sin(2 * w) : 1, 12, dt);
      const swing = moving ? Math.sin(w) * 0.55 : 0;
      this.legs[0].rotation.x = dampAngle(this.legs[0].rotation.x, swing, 14, dt); // FL
      this.legs[3].rotation.x = dampAngle(this.legs[3].rotation.x, swing, 14, dt); // BR
      this.legs[1].rotation.x = dampAngle(this.legs[1].rotation.x, -swing, 14, dt); // FR
      this.legs[2].rotation.x = dampAngle(this.legs[2].rotation.x, -swing, 14, dt); // BL
      const earW = moving ? Math.sin(w) * 0.1 : Math.sin(t * 1.3) * 0.05;
      this.ears[0].rotation.z = earW;
      this.ears[1].rotation.z = -earW;
    }

    this.shadow.position.copy(up).multiplyScalar(SURFACE + 0.02);
    this.shadow.quaternion.setFromUnitVectors(Z, up);
  }
}

function makeBlobShadow(): Mesh {
  const mesh = new Mesh(
    new CircleGeometry(1, 24),
    new MeshBasicMaterial({ color: 0x1c3a12, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  mesh.renderOrder = 1;
  return mesh;
}
