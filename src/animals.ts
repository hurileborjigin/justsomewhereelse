import {
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type Object3D,
  type Scene,
} from "three";
import { SEED, SURFACE } from "../shared/protocol.ts";
import { node, type Assets } from "./assets.ts";
import {
  SPAWN_TILES,
  TILE_COUNT,
  greatCircleDir,
  isBlockedFor,
  neighborsOf,
  tileCenter,
} from "./grid.ts";
import { dampAngle, mulberry32, tangentFrameQuat } from "./math.ts";
import type { Building } from "./scatter.ts";

/**
 * Ambient animals wandering the globe. Like the world scatter, they cost zero
 * network traffic: both players run the identical seeded simulation, anchored
 * to wall-clock time (the day-seeded random walk is replayed from UTC
 * midnight on load, then advanced live), so the herds stand in the same
 * places on both screens. Animals never block movement - they are dressing.
 *
 * Each herd stays within `homeArc` of its home: cows at the barn, sheep on
 * the opera plaza, horses by the ger, dogs and the cat around the village
 * houses. Animation reuses the named-node contract: LegFL/FR/BL/BR swing,
 * Tail wags, Head (cow/sheep/horse) dips to graze, EarL/EarR (cat/dog) flick.
 */

type SpeciesId = "cat" | "dog" | "cow" | "sheep" | "horse";

type SpeciesSpec = {
  id: SpeciesId;
  count: number;
  speed: number; // units/s while stepping
  moveChance: number; // chance a decision becomes a step (vs idling)
  idle: [number, number]; // idle duration range in seconds
  homeArc: number; // leash radius around home, radians of great circle
  grazes: boolean; // dips the Head while idle
  legSwing: number;
  bounce: number;
  tail: { idleSpeed: number; idleAmp: number; walkAmp: number };
  scale: [number, number];
  shadow: number;
};

const SPECIES: SpeciesSpec[] = [
  { id: "cat", count: 1, speed: 2.6, moveChance: 0.55, idle: [1.5, 8], homeArc: 0.5, grazes: false,
    legSwing: 0.5, bounce: 0.04, tail: { idleSpeed: 1.8, idleAmp: 0.35, walkAmp: 0.3 }, scale: [0.95, 1.05], shadow: 0.28 },
  { id: "dog", count: 2, speed: 3.2, moveChance: 0.75, idle: [0.6, 3], homeArc: 0.6, grazes: false,
    legSwing: 0.6, bounce: 0.06, tail: { idleSpeed: 7, idleAmp: 0.45, walkAmp: 0.6 }, scale: [0.95, 1.1], shadow: 0.35 },
  { id: "cow", count: 4, speed: 1.6, moveChance: 0.4, idle: [2, 9], homeArc: 0.45, grazes: true,
    legSwing: 0.35, bounce: 0.03, tail: { idleSpeed: 1.6, idleAmp: 0.25, walkAmp: 0.2 }, scale: [0.95, 1.1], shadow: 0.65 },
  { id: "sheep", count: 6, speed: 2.0, moveChance: 0.5, idle: [1.5, 7], homeArc: 0.4, grazes: true,
    legSwing: 0.45, bounce: 0.05, tail: { idleSpeed: 2.5, idleAmp: 0.15, walkAmp: 0.3 }, scale: [0.85, 1.1], shadow: 0.45 },
  { id: "horse", count: 2, speed: 3.4, moveChance: 0.55, idle: [1.5, 6], homeArc: 0.7, grazes: true,
    legSwing: 0.5, bounce: 0.06, tail: { idleSpeed: 1.4, idleAmp: 0.3, walkAmp: 0.25 }, scale: [0.95, 1.08], shadow: 0.6 },
];

type Animal = {
  spec: SpeciesSpec;
  obj: Group;
  shadow: Mesh;
  legs: Object3D[];
  tail: Object3D;
  head: Object3D | null;
  ears: Object3D[];
  phase: number; // desyncs the herd's idle wiggles
  home: number;
  startTile: number;
  rng: () => number;
  tile: number;
  from: number;
  to: number;
  stepping: boolean;
  stepStart: number; // absolute seconds (epoch)
  stepDur: number;
  nextDecision: number;
  grazing: boolean;
  walkPhase: number;
  heading: Vector3;
};

const DAY_MS = 86_400_000;
const Z = new Vector3(0, 0, 1);
const _pos = new Vector3();
const _up = new Vector3();
const _fwd = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();

export class Animals {
  private animals: Animal[] = [];
  /** Tiles currently held (or being stepped onto) - keeps the herd spread. */
  private reserved = new Set<number>();
  private day = -1;

  constructor(scene: Scene, assets: Assets, buildings: Building[]) {
    // day-independent choices (homes, sizes) come from their own seeded rng
    const rng = mulberry32((SEED ^ 0x5eedb0b) >>> 0);
    const door = (pred: (b: Building) => boolean) => buildings.find(pred)?.doorTiles[0] ?? -1;
    const houses = buildings.filter((b) => b.kind === "house_a" || b.kind === "house_b");
    const anchors: Record<SpeciesId, number> = {
      cow: door((b) => b.kind === "barn"),
      sheep: door((b) => b.id === "opera"),
      horse: door((b) => b.id === "ger"),
      dog: houses[0]?.doorTiles[0] ?? -1,
      cat: houses[1]?.doorTiles[0] ?? houses[0]?.doorTiles[0] ?? -1,
    };

    const walkable = (k: number) =>
      !isBlockedFor(k, false) && !this.reserved.has(k) && !SPAWN_TILES.includes(k);
    const anyWalkable = (): number => {
      for (let tries = 0; tries < 200; tries++) {
        const k = Math.floor(rng() * TILE_COUNT);
        if (walkable(k)) return k;
      }
      return SPAWN_TILES[0]; // unreachable on any sane planet
    };
    const startNear = (home: number, arc: number): number => {
      const c = tileCenter(home);
      for (const limit of [Math.min(arc, 0.3), arc]) {
        const cands: number[] = [];
        const cos = Math.cos(limit);
        for (let k = 0; k < TILE_COUNT; k++) {
          if (tileCenter(k).dot(c) >= cos && walkable(k)) cands.push(k);
        }
        if (cands.length) return cands[Math.floor(rng() * cands.length)];
      }
      return anyWalkable();
    };

    for (const spec of SPECIES) {
      const home = anchors[spec.id] >= 0 ? anchors[spec.id] : anyWalkable();
      for (let n = 0; n < spec.count; n++) {
        const startTile = startNear(home, spec.homeArc);
        this.reserved.add(startTile); // so herd-mates pick distinct starts
        const obj = assets[spec.id].clone(true);
        obj.scale.setScalar(spec.scale[0] + rng() * (spec.scale[1] - spec.scale[0]));
        const shadow = makeBlobShadow(spec.shadow * obj.scale.x);
        scene.add(obj, shadow);
        this.animals.push({
          spec,
          obj,
          shadow,
          legs: ["LegFL", "LegFR", "LegBL", "LegBR"].map((name) => node(obj, name)),
          tail: node(obj, "Tail"),
          head: obj.getObjectByName("Head") ?? null,
          ears: ["EarL", "EarR"].map((name) => obj.getObjectByName(name)).filter((e) => !!e),
          phase: rng() * Math.PI * 2,
          home,
          startTile,
          rng,
          tile: startTile,
          from: startTile,
          to: startTile,
          stepping: false,
          stepStart: 0,
          stepDur: 1,
          nextDecision: 0,
          grazing: false,
          walkPhase: rng() * Math.PI * 2,
          heading: new Vector3(),
        });
      }
    }
    this.reset(Math.floor(Date.now() / DAY_MS));
  }

  /** Rewind to this UTC day's start; update() then replays up to "now". */
  private reset(day: number) {
    this.day = day;
    this.reserved.clear();
    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i];
      a.rng = mulberry32((SEED ^ Math.imul(day, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0);
      a.tile = a.startTile;
      a.stepping = false;
      a.grazing = false;
      a.nextDecision = day * 86400 + a.rng() * 4;
      this.reserved.add(a.tile);
      const nb = neighborsOf(a.tile).find((n) => n >= 0);
      greatCircleDir(tileCenter(a.tile), tileCenter(nb ?? a.home), a.heading);
      _up.copy(tileCenter(a.tile));
      tangentFrameQuat(_up, _fwd.copy(a.heading), a.obj.quaternion);
    }
  }

  /** Replay decisions in global time order (deterministic across clients). */
  private advance(until: number) {
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.animals.length; i++) {
        const a = this.animals[i];
        if (a.nextDecision > until) continue;
        if (best < 0 || a.nextDecision < this.animals[best].nextDecision) best = i;
      }
      if (best < 0) break;
      this.decide(this.animals[best]);
    }
  }

  private decide(a: Animal) {
    const sp = a.spec;
    const now = a.nextDecision;
    if (a.stepping) {
      a.tile = a.to;
      a.stepping = false;
    }
    if (a.rng() < sp.moveChance) {
      const homeCos = Math.cos(sp.homeArc);
      const homeC = tileCenter(a.home);
      const cands: number[] = [];
      for (const n of neighborsOf(a.tile)) {
        if (n < 0 || this.reserved.has(n) || isBlockedFor(n, false)) continue;
        if (tileCenter(n).dot(homeC) < homeCos) continue;
        cands.push(n);
      }
      // momentum: a candidate that keeps the current heading counts double
      const len = cands.length;
      if (len > 1) {
        for (let i = 0; i < len; i++) {
          const n = cands[i];
          if (greatCircleDir(tileCenter(a.tile), tileCenter(n), _dir).dot(a.heading) > 0.5) {
            cands.push(n);
          }
        }
      }
      if (cands.length) {
        const to = cands[Math.floor(a.rng() * cands.length)];
        this.reserved.delete(a.tile);
        this.reserved.add(to);
        a.from = a.tile;
        a.to = to;
        a.stepping = true;
        a.grazing = false;
        a.stepStart = now;
        a.stepDur = (tileCenter(a.from).angleTo(tileCenter(to)) * SURFACE) / sp.speed;
        greatCircleDir(tileCenter(a.from), tileCenter(a.to), a.heading);
        a.nextDecision = now + a.stepDur;
        return;
      }
    }
    a.grazing = sp.grazes && a.rng() < 0.6;
    a.nextDecision = now + sp.idle[0] + a.rng() * (sp.idle[1] - sp.idle[0]);
  }

  update(dt: number, t: number) {
    const nowMs = Date.now();
    const day = Math.floor(nowMs / DAY_MS);
    // at UTC midnight everyone re-seeds and pops back home (keeps the two
    // clients replaying the identical walk regardless of when they loaded)
    if (day !== this.day) this.reset(day);
    const now = nowMs / 1000;
    this.advance(now);

    for (const a of this.animals) {
      const sp = a.spec;
      const moving = a.stepping;
      if (moving) {
        const k = Math.min((now - a.stepStart) / a.stepDur, 1);
        _pos.copy(tileCenter(a.from)).lerp(tileCenter(a.to), k).normalize();
      } else {
        _pos.copy(tileCenter(a.tile));
      }
      _up.copy(_pos);
      _pos.multiplyScalar(SURFACE);

      a.walkPhase += dt * (moving ? sp.speed * 3.2 : 0);
      const w = a.walkPhase;
      a.obj.position.copy(_pos);
      if (moving) a.obj.position.addScaledVector(_up, Math.abs(Math.sin(w)) * sp.bounce);
      tangentFrameQuat(_up, _fwd.copy(a.heading), _q);
      a.obj.quaternion.rotateTowards(_q, 7 * dt);

      const swing = moving ? Math.sin(w) * sp.legSwing : 0;
      a.legs[0].rotation.x = dampAngle(a.legs[0].rotation.x, swing, 14, dt); // FL
      a.legs[3].rotation.x = dampAngle(a.legs[3].rotation.x, swing, 14, dt); // BR
      a.legs[1].rotation.x = dampAngle(a.legs[1].rotation.x, -swing, 14, dt); // FR
      a.legs[2].rotation.x = dampAngle(a.legs[2].rotation.x, -swing, 14, dt); // BL

      a.tail.rotation.z = moving
        ? Math.sin(w) * sp.tail.walkAmp
        : Math.sin(t * sp.tail.idleSpeed + a.phase) * sp.tail.idleAmp;

      if (a.head) {
        const dip = a.grazing && !moving ? 0.55 + Math.sin(t * 2.8 + a.phase) * 0.05 : 0;
        a.head.rotation.x = dampAngle(a.head.rotation.x, dip, 3, dt);
      }
      if (a.ears.length === 2) {
        const flick = moving ? Math.sin(w) * 0.15 : Math.sin(t * 2.2 + a.phase) * 0.05;
        a.ears[0].rotation.x = flick;
        a.ears[1].rotation.x = -flick;
      }

      a.shadow.position.copy(_up).multiplyScalar(SURFACE + 0.02);
      a.shadow.quaternion.setFromUnitVectors(Z, _up);
    }
  }

  /** For scripted tests (window.__tp): where is everyone right now? */
  debug() {
    return this.animals.map((a) => ({
      species: a.spec.id,
      tile: a.stepping ? a.to : a.tile,
      home: a.home,
    }));
  }
}

function makeBlobShadow(scale: number): Mesh {
  const mesh = new Mesh(
    new CircleGeometry(1, 24),
    new MeshBasicMaterial({ color: 0x1c3a12, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  mesh.scale.setScalar(scale);
  mesh.renderOrder = 1;
  return mesh;
}
