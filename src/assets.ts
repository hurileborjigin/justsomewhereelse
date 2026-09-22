import { Mesh, type Group, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MANIFEST = {
  globe: "/models/globe.glb",
  bee: "/models/bee.glb",
  donkey: "/models/donkey.glb",
  tree_a: "/models/tree_a.glb",
  tree_b: "/models/tree_b.glb",
  tree_c: "/models/tree_c.glb",
  grass: "/models/grass.glb",
  house_a: "/models/house_a.glb",
  house_b: "/models/house_b.glb",
  tower: "/models/tower.glb",
  barn: "/models/barn.glb",
  room_house_a: "/models/room_house_a.glb",
  room_house_b: "/models/room_house_b.glb",
  room_tower: "/models/room_tower.glb",
  room_barn: "/models/room_barn.glb",
} as const;

export type AssetName = keyof typeof MANIFEST;
export type Assets = Record<AssetName, Group>;

export async function loadAssets(): Promise<Assets> {
  const loader = new GLTFLoader();
  const out = {} as Assets;
  await Promise.all(
    (Object.keys(MANIFEST) as AssetName[]).map(async (name) => {
      const gltf = await loader.loadAsync(MANIFEST[name]);
      out[name] = gltf.scene;
    }),
  );
  return out;
}

/**
 * Named-node lookup that fails loudly: node names are the contract between
 * the Blender scripts and the client-side animation code.
 */
export function node(root: Object3D, name: string): Object3D {
  const n = root.getObjectByName(name);
  if (!n) throw new Error(`Model is missing required node "${name}" - re-run "npm run models"`);
  return n;
}

export function firstMesh(root: Object3D): Mesh {
  let found: Mesh | null = null;
  root.traverse((o) => {
    if (!found && o instanceof Mesh) found = o;
  });
  if (!found) throw new Error("Model contains no mesh");
  return found;
}
