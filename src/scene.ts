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

  // golden hour: a warm low sun and peachy ambience
  const hemi = new HemisphereLight(0xffd2a1, 0x8a7a50, 1.15);
  const sun = new DirectionalLight(0xffb36b, 2.4);
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
