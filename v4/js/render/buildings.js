// Low-poly miniature buildings and shrine nodes, in the same faceted hull style as the minis.
// Built per (type, faction), cached and shared; each view has its own material for fades.
import * as THREE from 'three';
import { PAINT, BUILDINGS } from '../data/units.js';
import { Kit, paintMat } from './kit.js';
import { rng } from '../sim/rng.js';

let R = Math.random;
const box = (cx, cy, cz, w, h, d) => {
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push([cx + sx * w / 2, cy + sy * h / 2, cz + sz * d / 2]);
  return out;
};
const ring = (cx, y, cz, r, n = 8, ph = 0) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2 + ph; return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]; });
const jit = (pts, a = 0.04) => pts.map(p => [p[0] + (R() - 0.5) * 2 * a, p[1] + (R() - 0.5) * 2 * a, p[2] + (R() - 0.5) * 2 * a]);

const STONE = [0xa39d90, 0x948e82, 0xb3ad9f], DSTONE = [0x4a4352, 0x3d3746, 0x55505e];
const WOOD = 0x8a5a34, DWOOD = 0x5c3a21, ROOF = 0x6b3a2e, BONE = 0xe6dcc3;

// stones laid in courses: a chunky wall block
function wallBlock(k, x, z, w, d, h, cols, y0 = 0) {
  const courses = Math.max(2, Math.round(h / 0.7));
  for (let c = 0; c < courses; c++) {
    const y = y0 + c * h / courses, hh = h / courses;
    const n = Math.max(1, Math.round(Math.max(w, d) / 1.1));
    for (let i = 0; i < n; i++) {
      const along = w >= d;
      const off = -0.5 + (i + 0.5) / n + (c % 2 ? 0.5 / n : 0) * 0;
      const bx = along ? x + off * w : x, bz = along ? z : z + off * d;
      const bw = along ? w / n - 0.04 : w, bd = along ? d : d / n - 0.04;
      k.hull(jit(box(bx, y + hh / 2, bz, bw, hh - 0.03, bd), 0.03), cols[(c + i) % cols.length]);
    }
  }
}

function keep(k, P, und) {
  const S = und ? DSTONE : STONE;
  // base plinth, main keep, four corner towers, battlements, banner / glow
  k.hull(jit(box(0, 0.15, 0, 4.2, 0.3, 4.2), 0.03), S[1]);
  wallBlock(k, 0, 0, 3.2, 3.2, 2.6, S, 0.3);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    k.hull(jit([...ring(sx * 1.55, 0.3, sz * 1.55, 0.7, 8), ...ring(sx * 1.55, 3.4, sz * 1.55, 0.62, 8)], 0.03), S[(sx + sz + 4) % 3]);
    k.hull(jit([...ring(sx * 1.55, 3.4, sz * 1.55, 0.78, 8), ...ring(sx * 1.55, 3.7, sz * 1.55, 0.78, 8)], 0.02), S[0]);
    if (und) k.hull(ring(sx * 1.55, 3.7, sz * 1.55, 0.6, 6).concat([[sx * 1.55, 4.5, sz * 1.55]]), 0x2b2533);
    else k.hull(ring(sx * 1.55, 3.7, sz * 1.55, 0.7, 8).concat([[sx * 1.55, 4.6, sz * 1.55]]), P.cloth);
  }
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; k.hull(box(Math.cos(a) * 1.2, 3.05, Math.sin(a) * 1.2, 0.45, 0.4, 0.45), S[2]); }
  k.hull(box(0, 0.9, 1.62, 0.9, 1.2, 0.1), und ? 0x1a161e : DWOOD, { sh: 0 });            // gate
  if (!und) { k.hull(box(0, 4.3, 0, 0.08, 2.4, 0.08), DWOOD); k.hull([[0, 5.4, 0], [0, 4.6, 0], [0.9, 5.2, 0.02], [0.9, 4.8, 0.02], [0, 5.4, 0.05]], P.cloth); }
  else { k.hull(jit([...ring(0, 2.9, 0, 0.5, 6), [0, 4.2, 0]]), BONE); k.add(new THREE.IcosahedronGeometry(0.28, 0), P.glow, { y: 4.4, sh: 0 }); }
}
function barracks(k, P, und) {
  if (!und) {
    wallBlock(k, 0, 0, 3.3, 2.3, 1.3, [WOOD, 0x7c4c2a, 0x9a6a3e]);
    k.hull([[-1.85, 1.3, -1.35], [1.85, 1.3, -1.35], [-1.85, 1.3, 1.35], [1.85, 1.3, 1.35], [-1.85, 2.4, 0], [1.85, 2.4, 0]], ROOF);
    k.hull(box(0, 0.6, 1.17, 0.8, 1.1, 0.1), DWOOD, { sh: 0 });
    k.hull(box(-1.2, 2.2, 0, 0.35, 0.9, 0.35), STONE[1]);      // chimney
    k.hull([[1.2, 2.9, 1.17], [1.2, 2.1, 1.17], [1.8, 2.7, 1.2], [1.8, 2.3, 1.2], [1.2, 2.9, 1.2]], P.cloth);
  } else {
    // ossuary: a squat hut of stacked bones and skulls
    wallBlock(k, 0, 0, 3.3, 2.3, 1.2, [BONE, 0xd4c9ae, 0xc8bd9e]);
    k.hull(jit([[-1.8, 1.2, -1.3], [1.8, 1.2, -1.3], [-1.8, 1.2, 1.3], [1.8, 1.2, 1.3], [0, 2.4, 0], [-1, 2.1, 0], [1, 2.1, 0]], 0.06), 0x5b3a7a);
    for (let i = 0; i < 5; i++) k.add(new THREE.IcosahedronGeometry(0.18, 0), BONE, { x: -1.2 + i * 0.6, y: 1.3, z: 1.2, sh: 0.1 });
    k.hull(box(0, 0.55, 1.17, 0.8, 1.0, 0.1), 0x1a161e, { sh: 0 });
  }
}
function tower(k, P, und) {
  if (!und) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.hull(jit([...box(sx * 0.55, 0.1, sz * 0.55, 0.2, 0.2, 0.2), ...box(sx * 0.4, 3.2, sz * 0.4, 0.18, 0.2, 0.18)], 0.02), WOOD);
    k.hull(jit(box(0, 3.3, 0, 1.4, 0.2, 1.4), 0.02), DWOOD);
    k.hull(jit(box(0, 3.75, 0, 1.3, 0.7, 1.3), 0.03), WOOD);
    k.hull([...ring(0, 4.1, 0, 1.05, 4, Math.PI / 4), [0, 5.0, 0]], ROOF);
    k.hull(box(0, 1.6, 0, 1.0, 0.12, 0.12), DWOOD); k.hull(box(0, 1.6, 0, 0.12, 0.12, 1.0), DWOOD);
  } else {
    // bone spire: twisted stacked bone segments with a glowing tip
    let y = 0, r = 0.75;
    for (let i = 0; i < 5; i++) { const h = 0.85; k.hull(jit([...ring(0, y, 0, r, 6, i * 0.4), ...ring(0, y + h, 0, r * 0.82, 6, i * 0.4 + 0.3)], 0.04), i % 2 ? BONE : 0xd4c9ae); y += h; r *= 0.82; }
    k.hull([...ring(0, y, 0, r, 5), [0, y + 0.9, 0]], 0x5b3a7a);
    k.add(new THREE.IcosahedronGeometry(0.2, 0), P.glow || 0x7dff9a, { y: y + 1.05, sh: 0 });
  }
}
function banner(k, P, und) {
  k.hull(jit([...ring(0, 0, 0, 0.5, 6), ...ring(0, 0.25, 0, 0.4, 6)], 0.02), und ? DSTONE[1] : STONE[1]);
  if (!und) {
    k.hull(box(0, 1.8, 0, 0.1, 3.2, 0.1), DWOOD);
    k.hull([[0.05, 3.3, 0], [1.2, 3.3, 0], [0.05, 2.0, 0], [1.2, 2.0, 0], [0.62, 1.7, 0], [0.05, 3.3, 0.05], [1.2, 2.0, 0.05]], P.cloth);
    k.hull(box(0.62, 2.7, 0.04, 0.3, 0.3, 0.02), P.trim, { sh: 0 });
    k.add(new THREE.ConeGeometry(0.12, 0.3, 4), P.trim, { y: 3.55 });
  } else {
    // obelisk with runes
    k.hull(jit([...ring(0, 0.25, 0, 0.36, 4, Math.PI / 4), ...ring(0, 2.8, 0, 0.22, 4, Math.PI / 4), [0, 3.4, 0]], 0.02), DSTONE[0]);
    for (let i = 0; i < 3; i++) k.hull(box(0, 0.9 + i * 0.6, 0.27 - i * 0.02, 0.18, 0.08, 0.02), P.glow || 0x7dff9a, { sh: 0 });
  }
}
function palisade(k, P, und, w, d) {
  const along = w >= d, len = Math.max(w, d), n = Math.round(len / 0.32);
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + (i + 0.5) * len / n, h = 1.2 + R() * 0.35;
    const x = along ? t : 0, z = along ? 0 : t;
    if (!und) k.hull(jit([...ring(x, 0, z, 0.15, 5), ...ring(x, h, z, 0.14, 5), [x, h + 0.3, z]], 0.02), [WOOD, 0x7c4c2a, 0x9a6a3e][i % 3]);
    else k.hull(jit([...ring(x, 0, z, 0.12, 5), ...ring(x, h * 0.9, z, 0.1, 5), [x + 0.05, h + 0.2, z]], 0.02), BONE);
  }
  k.hull(box(0, 0.7, 0, along ? len : 0.12, 0.12, along ? 0.12 : len), und ? 0x5b3a7a : DWOOD);
}

// Kingdom farm: a little barn beside furrowed field rows and a haystack
function farm(k, P) {
  for (let i = 0; i < 4; i++) k.hull(jit(box(-0.45 + i * 0.42, 0.06, 0.25, 0.3, 0.12, 1.6), 0.02), i % 2 ? 0x6b4a2a : 0x7a5632);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) k.hull(jit([...ring(-0.45 + i * 0.42, 0.1, -0.3 + j * 0.55, 0.1, 5), [-0.45 + i * 0.42, 0.42, -0.3 + j * 0.55]], 0.02), 0x8fbf4a);
  k.hull(jit(box(-0.85, 0.5, -0.65, 0.9, 1.0, 0.8), 0.02), 0xa0452e);
  k.hull([[-1.35, 1.0, -1.1], [-0.35, 1.0, -1.1], [-1.35, 1.0, -0.2], [-0.35, 1.0, -0.2], [-1.35, 1.45, -0.65], [-0.35, 1.45, -0.65]], 0x5c3a21);
  k.hull(box(-0.85, 0.35, -0.24, 0.35, 0.6, 0.04), 0xe6dcc3, { sh: 0 });
  k.hull(jit([...ring(0.9, 0, -0.75, 0.32, 7), ...ring(0.9, 0.35, -0.75, 0.26, 7), [0.9, 0.62, -0.75]], 0.03), 0xe8c66a);
}
// Kingdom mine: a timber-framed entrance in a rocky mound, a cart of gold ore
function mine(k, P) {
  k.hull(jit([...ring(0, 0, 0, 1.05, 9), ...ring(0, 0.7, -0.2, 0.75, 8), [0, 1.2, -0.35]], 0.07), STONE[1]);
  k.hull(box(0, 0.4, 0.62, 0.62, 0.8, 0.2), 0x1a161e, { sh: 0 });
  for (const sx of [-1, 1]) k.hull(box(sx * 0.36, 0.45, 0.68, 0.12, 0.9, 0.12), WOOD);
  k.hull(box(0, 0.92, 0.68, 0.9, 0.12, 0.14), DWOOD);
  k.hull(jit(box(0.62, 0.22, 0.95, 0.5, 0.3, 0.36), 0.01), DWOOD);
  for (let i = 0; i < 4; i++) k.add(new THREE.IcosahedronGeometry(0.1, 0), 0xf5c542, { x: 0.5 + (i % 2) * 0.22, y: 0.42, z: 0.88 + Math.floor(i / 2) * 0.16, sh: 0.1 });
  for (const sx of [-1, 1]) k.hull(box(-0.2 + sx * 0.08, 0.02, 1.25, 0.05, 0.04, 0.8), 0x7d7f86);
}
// Undead soul well: a ring of bones and stones around a glowing green pit
function well(k, P) {
  k.hull(jit([...ring(0, 0, 0, 1.05, 10), ...ring(0, 0.35, 0, 0.95, 10)], 0.03), DSTONE[0]);
  k.add(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 10), P.glow || 0x7dff9a, { y: 0.36, sh: 0 });
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; k.hull(jit([...ring(Math.cos(a) * 0.85, 0.3, Math.sin(a) * 0.85, 0.06, 4), [Math.cos(a) * 0.95, 0.95 + (i % 2) * 0.3, Math.sin(a) * 0.95]], 0.02), BONE); }
  for (let i = 0; i < 3; i++) k.add(new THREE.IcosahedronGeometry(0.13, 0), BONE, { x: Math.cos(i * 2.1) * 0.95, y: 0.45, z: Math.sin(i * 2.1) * 0.95, sh: 0.1 });
}

const CACHE = new Map();
export function buildingGeo(type, faction, w, d) {
  const key = type + '|' + faction + '|' + w + '|' + d;
  if (CACHE.has(key)) return CACHE.get(key);
  R = rng(key.length * 7 + type.charCodeAt(0));
  const P = PAINT[faction], und = faction === 'undead';
  const k = new Kit(13, [0, 3, 0.7]);
  ({ hq: keep, barracks, tower, banner, wall: palisade, farm, mine, well }[type])(k, P, und, w, d);
  const g = k.build();
  CACHE.set(key, g);
  return g;
}

// scaffolding shown while a building is under construction
function scaffold(w, d, h) {
  const k = new Kit(3);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.hull(box(sx * w / 2, h / 2, sz * d / 2, 0.1, h, 0.1), 0xc9a26a);
  for (const y of [h * 0.35, h * 0.75]) { k.hull(box(0, y, d / 2, w, 0.08, 0.08), 0xc9a26a); k.hull(box(0, y, -d / 2, w, 0.08, 0.08), 0xc9a26a); k.hull(box(w / 2, y, 0, 0.08, 0.08, d), 0xc9a26a); k.hull(box(-w / 2, y, 0, 0.08, 0.08, d), 0xc9a26a); }
  return k.build();
}

export class BuildingView {
  constructor(b, faction, layer) {
    this.id = b.id; this.type = b.type; this.layer = layer;
    const def = BUILDINGS[b.type];
    this.mat = paintMat('terrain');
    this.group = new THREE.Group();
    this.mesh = new THREE.Mesh(buildingGeo(b.type, faction, b.w || 0, b.d || 0), this.mat);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    const sw = def.shape === 'circle' ? def.r * 2.2 : (b.w || 2) + 0.3, sd = def.shape === 'circle' ? def.r * 2.2 : (b.d || 2) + 0.3;
    this.scaf = new THREE.Mesh(scaffold(sw, sd, def.type === 'hq' ? 3 : 2.2), paintMat('terrain'));
    this.scaf.castShadow = true; this.group.add(this.scaf);
    const rc = def.shape === 'circle' ? def.r + 0.25 : Math.max(b.w, b.d) / 2 + 0.3;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(rc - 0.05, rc + 0.05, 32), new THREE.MeshBasicMaterial({ color: faction === 'undead' ? 0x9b59d0 : 0x3a78d8, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.09;
    this.group.add(this.ring);
    this.group.position.set(b.x, 0, b.z);
    this.height = { hq: 5, tower: 5, banner: 3.6, wall: 1.6, farm: 1.6, mine: 1.4, well: 1.4 }[b.type] || 2.6;
    if (b.type === 'well') { this.glow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9dffb4, transparent: true, opacity: 0.85 })); this.glow.position.y = 0.4; this.group.add(this.glow); }
    layer.add(this.group);
  }
  // d: { build (work left), work (0..1 done), ghost, visible, dying }
  update(d) {
    this.group.visible = d.visible !== false;
    const site = d.build > 0;
    this.scaf.visible = site && !d.ghost;
    const op = d.ghost ? 0.5 : site ? 0.62 : 1;
    if (this.op !== op) { const t = op < 1; if (this.mat.transparent !== t) this.mat.needsUpdate = true; this.op = op; this.mat.transparent = t; this.mat.opacity = op; this.mat.depthWrite = !t; this.mesh.castShadow = !d.ghost; }
    // a site rises as the builders work on it
    this.mesh.scale.y = site ? 0.25 + 0.6 * (d.work || 0) : 1;
    if (this.glow) this.glow.visible = !site && !d.ghost;
    if (d.dying !== undefined) { const k = Math.min(1, d.dying); this.mesh.scale.y = Math.max(0.15, 1 - k); if (!this.mat.transparent) { this.mat.transparent = true; this.mat.needsUpdate = true; } this.op = -1; this.mat.opacity = 1 - k * 0.8; }
  }
  top() { return { x: this.group.position.x, y: this.height + 0.4, z: this.group.position.z }; }
  destroy() { this.layer.remove(this.group); this.mat.dispose(); this.scaf.material.dispose(); this.ring.geometry.dispose(); this.ring.material.dispose(); if (this.glow) { this.glow.geometry.dispose(); this.glow.material.dispose(); } }
}

// shrine node: a ring of standing stones with a floating crystal in the owner's colour
const OWN = [0x3a78d8, 0x9b59d0], FREE = 0xd8d2c0;
export class ShrineView {
  constructor(sh, layer, radius) {
    this.layer = layer;
    R = rng(Math.round(sh.x * 31 + sh.z));
    const k = new Kit(17, [0, 1.2, 0.7]);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, x = Math.cos(a) * 0.95, z = Math.sin(a) * 0.95, h = 0.6 + R() * 0.5; k.hull(jit([...box(x, h / 2, z, 0.32, h, 0.28)], 0.05), STONE[i % 3]); }
    k.hull(jit([...ring(0, 0, 0, 0.55, 6), ...ring(0, 0.25, 0, 0.45, 6)], 0.03), STONE[1]);
    this.group = new THREE.Group();
    const base = this.base = new THREE.Mesh(k.build(), paintMat('terrain')); base.castShadow = true; base.receiveShadow = true;
    this.crystalMat = new THREE.MeshStandardMaterial({ color: FREE, emissive: FREE, emissiveIntensity: 0.35, flatShading: true, roughness: 0.3 });
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), this.crystalMat);
    this.crystal.scale.y = 1.6; this.crystal.position.y = 1.15;
    this.ringMat = new THREE.MeshBasicMaterial({ color: FREE, transparent: true, opacity: 0.35, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.06, radius + 0.06, 48), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.1;
    this.group.add(base, this.crystal, this.ring);
    this.group.position.set(sh.x, 0, sh.z);
    layer.add(this.group);
  }
  // occupied: a mine / soul well stands on the site (hide the stones and crystal)
  update(owner, time, occupied = false) {
    const c = owner >= 0 ? OWN[owner] : FREE;
    if (this.c !== c) { this.c = c; this.crystalMat.color.setHex(c); this.crystalMat.emissive.setHex(c); this.ringMat.color.setHex(c); }
    this.crystal.visible = this.base.visible = !occupied;
    this.crystal.rotation.y = time * 0.8; this.crystal.position.y = 1.15 + Math.sin(time * 2) * 0.08;
  }
}
