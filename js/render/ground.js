// The ground texture under the battle mat: grave blight and forest floors change the ground itself
// (like blight or creep in other RTS games) instead of sitting on top as a second layer.
//  GROUND.map: a DataTexture at TEX texels per inch over the board
//    R = blight (undead grave ground, both sides), G = forest floor,
//    B = soil variation noise (the faint violet cracks inside blight are drawn per pixel in the shader)
//  Edges fade over EDGE inches past each circle and are broken up by value noise, so borders
//  between landscapes are soft and organic. Only the board's ground material samples it (groundPatch).
import * as THREE from 'three';

const TEX = 4, EDGE = 1.6;
export const GROUND = { map: { value: null }, size: { value: new THREE.Vector2(48, 32) } };

function vnoise(seed) {
  const h = (i, j) => { const v = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return v - Math.floor(v); };
  return (x, z) => {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
}
const N1 = vnoise(41), N2 = vnoise(43), N3 = vnoise(47);
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

let ver = 0, W = 48, H = 32, data = null, tex = null, forests = [], blight = [], blightSig = '';

// how much of a circle set covers (x, z): 1 inside, fading to 0 over EDGE past the rim, with a noisy rim
function cover(circles, x, z, wob) {
  let v = 0;
  for (const c of circles) {
    const d = Math.hypot(x - c.x, z - c.z) - c.r + wob;
    if (d > EDGE) continue;
    v = Math.max(v, 1 - sstep(-EDGE * 0.35, EDGE, d));
    if (v >= 1) break;
  }
  return v;
}

function paint() {
  const nx = W * TEX, nz = H * TEX;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) / TEX, z = (j + 0.5) / TEX, k = (j * nx + i) * 4;
    // a noisy rim: two octaves, about ±0.9"
    const wob = (N1(x * 0.7, z * 0.7) - 0.5) * 1.3 + (N2(x * 2.1, z * 2.1) - 0.5) * 0.6;
    const b = cover(blight, x, z, wob), f = cover(forests, x, z, wob * 0.8);
    data[k] = Math.round(b * 255);
    data[k + 1] = Math.round(f * 255);
    data[k + 2] = Math.round(N3(x * 0.9, z * 0.9) * 255);
    data[k + 3] = 255;
  }
  tex.needsUpdate = true;
}

// a new board (and its forests): called by buildTable
export function setGround(w, h, terrain) {
  W = w; H = h;
  data = new Uint8Array(W * TEX * H * TEX * 4);
  tex?.dispose();
  tex = new THREE.DataTexture(data, W * TEX, H * TEX, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  GROUND.map.value = tex; GROUND.size.value.set(W, H);
  forests = terrain.filter(t => t.kind === 'forest').map(t => ({ x: t.x, z: t.z, r: t.r - 0.3 }));
  blight = []; blightSig = ''; ver++;
  paint();
}
// bumps whenever the board is rebuilt (layers drawn on the ground redo their work)
export const groundVersion = () => ver;

// the grave circles of both sides (repaints only when they change)
export function setBlight(circles) {
  const sig = circles.map(c => `${c.x},${c.z},${c.r.toFixed(2)}`).join('|');
  if (!data || sig === blightSig) return;
  blightSig = sig; blight = circles.map(c => ({ x: c.x, z: c.z, r: c.r }));
  paint();
}

// how much blight / forest floor covers a point (for scattering props with density falling at the edges)
export function blightAt(x, z) { return sampleCh(x, z, 0); }
export function forestAt(x, z) { return sampleCh(x, z, 1); }
function sampleCh(x, z, ch) {
  if (!data) return 0;
  const i = Math.floor(x * TEX), j = Math.floor(z * TEX);
  if (i < 0 || j < 0 || i >= W * TEX || j >= H * TEX) return 0;
  return data[(j * W * TEX + i) * 4 + ch] / 255;
}

// patch the board material: tint the ground colour before lighting, add the faint violet glow after
export function groundPatch(sh) {
  sh.uniforms.groundMap = GROUND.map; sh.uniforms.groundSize = GROUND.size;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vGXZ;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvGXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vGXZ;\nuniform sampler2D groundMap;\nuniform vec2 groundSize;\nfloat gBl = 0.0; float gCr = 0.0;\nfloat gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y); }')
    .replace('#include <color_fragment>', `#include <color_fragment>
      if (vGXZ.x > 0.0 && vGXZ.x < groundSize.x && vGXZ.y > 0.0 && vGXZ.y < groundSize.y) {
        vec4 gd = texture2D(groundMap, vGXZ / groundSize);
        vec3 moss = mix(vec3(0.06, 0.115, 0.033), vec3(0.095, 0.072, 0.028), gd.b);   // linear colours
        diffuseColor.rgb = mix(diffuseColor.rgb, moss * (0.8 + 1.2 * dot(diffuseColor.rgb, vec3(0.33))), gd.g * 0.85);
        vec3 bl = mix(vec3(0.016, 0.011, 0.02), vec3(0.042, 0.027, 0.05), gd.b);
        diffuseColor.rgb = mix(diffuseColor.rgb, bl, gd.r * 0.96);
        gBl = gd.r;
        if (gBl > 0.01) { float rg = 1.0 - abs(gNoise(vGXZ * 0.9) * 2.0 - 1.0); float rg2 = 1.0 - abs(gNoise(vGXZ * 2.3 + 7.0) * 2.0 - 1.0); gCr = smoothstep(0.965, 0.995, rg) * gNoise(vGXZ * 0.35 + 3.0) + 0.4 * smoothstep(0.975, 0.997, rg2); }
      }`)
    .replace('#include <opaque_fragment>', `
      outgoingLight += vec3(0.08, 0.02, 0.12) * gCr * gBl * gBl;
      #include <opaque_fragment>`);
}
