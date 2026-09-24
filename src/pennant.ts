import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from "three";
import { SURFACE, type PlayerId } from "../shared/protocol.ts";
import { greatCircleDir, neighborsOf, tileCenter } from "./grid.ts";
import { tangentFrameQuat } from "./math.ts";
import type { Building } from "./scatter.ts";

/** The owners' colours: honey gold for gloria, copper green for khurlee. */
export const OWNER_COLORS: [string, string] = ["#e2b34a", "#4f9a7e"];

const POLE_H = 1.2;
const SIDE = 0.9; // how far beside the doorway the pole stands, so it never blocks the door

const poleGeo = new CylinderGeometry(0.03, 0.036, POLE_H, 8).translate(0, POLE_H / 2, 0);
const knobGeo = new SphereGeometry(0.06, 10, 8).translate(0, POLE_H + 0.03, 0);
// a triangle flying from the top of the pole, outward along +X
const flagGeo = new BufferGeometry();
flagGeo.setAttribute(
  "position",
  new Float32BufferAttribute([0, POLE_H - 0.02, 0, 0, POLE_H - 0.42, 0, 0.62, POLE_H - 0.22, 0], 3),
);
flagGeo.computeVertexNormals();
const poleMat = new MeshStandardMaterial({ color: "#3a2e26", roughness: 0.8 });
const flagMats = OWNER_COLORS.map(
  // a vertical flag catches little of the overhead sun: a touch of its own colour keeps it bright
  (c) => new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.45, roughness: 0.7, side: DoubleSide }),
);

/** A small pole and flag beside each owned building's door on the globe, in the owner's colour. */
export class Pennants {
  private scene: Scene;
  private buildings: Building[];
  private shown = new Map<string, { group: Group; owner: PlayerId }>();

  constructor(scene: Scene, buildings: Building[]) {
    this.scene = scene;
    this.buildings = buildings;
  }

  /** Shows, recolours or removes the pennant for `id`. */
  set(id: string, owner: PlayerId | null) {
    const current = this.shown.get(id);
    if (current && current.owner === owner) return;
    if (current) {
      this.scene.remove(current.group);
      this.shown.delete(id);
    }
    if (owner === null) return;
    const b = this.buildings.find((x) => x.id === id);
    if (!b || b.doorTiles.length === 0) return;
    const group = build(b, owner);
    this.scene.add(group);
    this.shown.set(id, { group, owner });
  }

  /** Every building at once (a welcome). */
  sync(ownerOf: (id: string) => PlayerId | null) {
    for (const b of this.buildings) this.set(b.id, ownerOf(b.id));
  }

  /** Dev hook: which buildings fly which colour. */
  debug(): Record<string, PlayerId> {
    return Object.fromEntries([...this.shown].map(([id, s]) => [id, s.owner]));
  }
}

function build(b: Building, owner: PlayerId): Group {
  const door = b.doorTiles[0];
  // the building tile the door opens from (the first one when none touches it)
  const from = b.tiles.find((t) => neighborsOf(t).includes(door)) ?? b.tiles[0];
  const c = tileCenter(from);
  const d = tileCenter(door);
  const fwd = greatCircleDir(c, d, new Vector3());
  // on the line between the building and its doorstep, stepped to the right of the doorway
  const edge = c.clone().add(d).normalize();
  const right = new Vector3().crossVectors(edge, fwd).normalize();
  const up = edge.multiplyScalar(SURFACE).addScaledVector(right, SIDE).normalize();

  const group = new Group();
  group.add(new Mesh(poleGeo, poleMat), new Mesh(knobGeo, poleMat), new Mesh(flagGeo, flagMats[owner]));
  group.position.copy(up).multiplyScalar(SURFACE - 0.03);
  tangentFrameQuat(up.clone(), fwd, group.quaternion);
  return group;
}
