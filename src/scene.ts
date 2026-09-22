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

  const hemi = new HemisphereLight(0xbfe3ff, 0x7ec850, 1.2);
  const sun = new DirectionalLight(0xfff4d6, 2.2);
  sun.position.set(0, 60, 0); // repositioned every frame relative to the player
  scene.add(hemi, sun);

  const sky = makeSky();
  scene.add(sky);

  return { renderer, scene, sky, sun, hemi };
}

function makeSky(): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new Color("#8ec9ff") },
      bottom: { value: new Color("#fdf0dc") },
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
      uniform vec3 bottom;
      varying vec3 vDir;
      void main() {
        float h = clamp(normalize(vDir).y * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(mix(bottom, top, pow(h, 1.4)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new Mesh(new SphereGeometry(320, 24, 16), material);
  mesh.frustumCulled = false;
  return mesh;
}
