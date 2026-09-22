import {
  BackSide,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  NeutralToneMapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  WebGLRenderer,
} from "three";

/**
 * Renderer, lights and sky. No shadow maps — characters get blob shadows
 * instead (see animate.ts), which reads better in this cartoon style anyway.
 * The sun and the sky dome are re-oriented to the player's "up" every frame
 * by main.ts, so lighting looks the same everywhere on the planet.
 */
export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = NeutralToneMapping;

  const scene = new Scene();

  const hemi = new HemisphereLight(0xffd2a1, 0x8a7a50, 1.15);
  const sun = new DirectionalLight(0xffb36b, 2.4);
  sun.position.set(0, 60, 0); // repositioned every frame relative to the player
  scene.add(hemi, sun);

  const sky = makeSky();
  scene.add(sky);

  return { renderer, scene, sky, sun, hemi };
}

// ---- the sky follows each player's own local time ---------------------------
// Keyframes over the 24h day; everything in between is blended smoothly.
// Munich and Sydney are ~9h apart, so the two of you usually see different
// skies - that is the point.

type SkyStop = {
  h: number;
  top: Color;
  mid: Color;
  bottom: Color;
  sun: Color;
  sunI: number;
  sunH: number; // how high the sun sits (low = long golden light)
  hemiSky: Color;
  hemiGround: Color;
  hemiI: number;
};

const stop = (
  h: number,
  [top, mid, bottom, sunC, hemiSky, hemiGround]: string[],
  sunI: number,
  sunH: number,
  hemiI: number,
): SkyStop => ({
  h,
  top: new Color(top),
  mid: new Color(mid),
  bottom: new Color(bottom),
  sun: new Color(sunC),
  sunI,
  sunH,
  hemiSky: new Color(hemiSky),
  hemiGround: new Color(hemiGround),
  hemiI,
});

const NIGHT = ["#141a38", "#232a52", "#35315c", "#8fa8e8", "#2c3560", "#1c2418"];
const DAWN = ["#6f7fc0", "#ee9d9e", "#ffce7d", "#ff9e6b", "#ffd2b0", "#6e6a4a"];
const DAY = ["#4f9be6", "#a5d4f5", "#eaf6da", "#fff3d2", "#bfe3ff", "#7ec850"];
const GOLDEN = ["#7d85c1", "#f59a7e", "#ffc46b", "#ffb36b", "#ffd2a1", "#8a7a50"];

const SKY_STOPS: SkyStop[] = [
  stop(0, NIGHT, 0.55, 30, 0.55),
  stop(5, NIGHT, 0.55, 30, 0.55),
  stop(7, DAWN, 1.9, 12, 0.95),
  stop(9.5, DAY, 2.3, 50, 1.25),
  stop(16.5, DAY, 2.3, 50, 1.25),
  stop(19, GOLDEN, 2.4, 14, 1.15),
  stop(21.5, NIGHT, 0.55, 30, 0.55),
  stop(24, NIGHT, 0.55, 30, 0.55),
];

/** Blend the sky, sun and ambience to the given local hour; returns the
 * sun height used to position the light. */
export function applySkyForHour(
  hour: number,
  sky: Mesh,
  sun: DirectionalLight,
  hemi: HemisphereLight,
): number {
  const h = ((hour % 24) + 24) % 24;
  let a = SKY_STOPS[0];
  let b = SKY_STOPS[SKY_STOPS.length - 1];
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    if (h >= SKY_STOPS[i].h && h <= SKY_STOPS[i + 1].h) {
      a = SKY_STOPS[i];
      b = SKY_STOPS[i + 1];
      break;
    }
  }
  const t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  const u = (sky.material as ShaderMaterial).uniforms;
  (u.top.value as Color).lerpColors(a.top, b.top, t);
  (u.mid.value as Color).lerpColors(a.mid, b.mid, t);
  (u.bottom.value as Color).lerpColors(a.bottom, b.bottom, t);
  sun.color.lerpColors(a.sun, b.sun, t);
  sun.intensity = a.sunI + (b.sunI - a.sunI) * t;
  hemi.color.lerpColors(a.hemiSky, b.hemiSky, t);
  hemi.groundColor.lerpColors(a.hemiGround, b.hemiGround, t);
  hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * t;
  return a.sunH + (b.sunH - a.sunH) * t;
}

function makeSky(): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new Color("#7d85c1") }, // dusky periwinkle overhead
      mid: { value: new Color("#f59a7e") }, // peach
      bottom: { value: new Color("#ffc46b") }, // golden glow at the horizon
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 mid;
      uniform vec3 bottom;
      varying vec3 vDir;
      void main() {
        float h = clamp(normalize(vDir).y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(bottom, mid, smoothstep(0.08, 0.52, h));
        col = mix(col, top, smoothstep(0.52, 0.95, h));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new Mesh(new SphereGeometry(320, 24, 16), material);
  mesh.frustumCulled = false;
  return mesh;
}
