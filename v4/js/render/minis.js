// Procedural low-poly miniatures with a simple tabletop paint job.
// Each mini is assembled from primitives and merged into ONE mesh (vertex colours),
// so a whole army stays cheap to draw on phones.
import * as THREE from 'three';
import { PAINT } from '../data/units.js';

const BASE_BLACK = 0x1c1c1e;

class Kit {
  constructor() { this.parts = []; }
  add(geo, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
    this.parts.push({ geo, color, m });
    return this;
  }
  box(w, h, d, color, o) { return this.add(new THREE.BoxGeometry(w, h, d), color, o); }
  cyl(rt, rb, h, color, o, seg = 7) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, o); }
  cone(r, h, color, o, seg = 6) { return this.add(new THREE.ConeGeometry(r, h, seg), color, o); }
  ball(r, color, o, detail = 0) { return this.add(new THREE.IcosahedronGeometry(r, detail), color, o); }
  build() {
    const pos = [], nor = [], col = [];
    const c = new THREE.Color();
    for (const p of this.parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      g.applyMatrix4(p.m);
      g.computeVertexNormals();
      const P = g.attributes.position.array, N = g.attributes.normal.array;
      c.setHex(p.color);
      for (let i = 0; i < P.length; i += 3) { pos.push(P[i], P[i + 1], P[i + 2]); nor.push(N[i], N[i + 1], N[i + 2]); col.push(c.r, c.g, c.b); }
      g.dispose(); if (g !== p.geo) p.geo.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return geo;
  }
}

// ---- body parts ----------------------------------------------------------------------
function base(k, P, r = 0.42, oval = 1) {
  k.cyl(r, r + 0.03, 0.12, BASE_BLACK, { y: 0.06, sz: oval }, 18);
  k.cyl(r + 0.035, r + 0.045, 0.04, P.rim, { y: 0.02, sz: oval }, 18);
}
function legs(k, color, boot) {
  for (const sx of [-1, 1]) {
    k.box(0.13, 0.36, 0.15, color, { x: sx * 0.085, y: 0.31 });
    k.box(0.15, 0.08, 0.2, boot, { x: sx * 0.085, y: 0.16, z: 0.02 });
  }
}
function boneLegs(k, bone) {
  for (const sx of [-1, 1]) { k.box(0.06, 0.38, 0.06, bone, { x: sx * 0.08, y: 0.31 }); k.box(0.1, 0.06, 0.16, bone, { x: sx * 0.08, y: 0.15, z: 0.03 }); }
}
function arm(k, color, side, { lift = 0, fwd = 0 } = {}) {
  k.box(0.1, 0.34, 0.11, color, { x: side * 0.23, y: 0.66 + lift, z: fwd, rx: -fwd * 1.6 });
}
function sword(k, P, side = 1) {
  k.box(0.05, 0.62, 0.025, P.metal, { x: side * 0.25, y: 0.82, z: 0.2, rx: -0.5 });
  k.box(0.18, 0.04, 0.05, P.trim, { x: side * 0.25, y: 0.55, z: 0.07, rx: -0.5 });
}
function spear(k, P, side = 1, len = 1.5) {
  k.cyl(0.022, 0.022, len, P.wood, { x: side * 0.25, y: 0.75, z: 0.12 }, 5);
  k.cone(0.055, 0.18, P.metal, { x: side * 0.25, y: 0.75 + len / 2 + 0.09, z: 0.12 }, 4);
}
function roundShield(k, color, rim, side = -1, r = 0.22) {
  k.cyl(r, r, 0.05, color, { x: side * 0.27, y: 0.66, z: 0.12, rz: Math.PI / 2, ry: 0.25 * side }, 10);
  k.cyl(r * 0.35, r * 0.35, 0.07, rim, { x: side * 0.29, y: 0.66, z: 0.12, rz: Math.PI / 2, ry: 0.25 * side }, 8);
}
function towerShield(k, color, rim, side = -1) {
  k.box(0.06, 0.62, 0.46, color, { x: side * 0.25, y: 0.6, z: 0.12 });
  k.box(0.07, 0.62, 0.06, rim, { x: side * 0.255, y: 0.6, z: 0.12 });
  k.box(0.07, 0.06, 0.46, rim, { x: side * 0.255, y: 0.6, z: 0.12 });
}

// ---- figures ---------------------------------------------------------------------------
function human(k, P, { helm = 'kettle', armour = false } = {}) {
  legs(k, P.cloth2, P.leather);
  k.box(0.36, 0.4, 0.24, armour ? P.metal : P.cloth, { y: 0.68 });
  k.box(0.38, 0.12, 0.26, P.leather, { y: 0.5 });              // belt
  if (!armour) k.box(0.2, 0.34, 0.02, P.cloth2, { y: 0.66, z: 0.125 }); // tabard stripe
  k.ball(0.13, P.skin, { y: 1.0 });
  if (helm === 'kettle') { k.cyl(0.11, 0.15, 0.1, P.metal, { y: 1.1 }, 8); k.cyl(0.24, 0.24, 0.03, P.metal, { y: 1.06 }, 10); }
  else if (helm === 'great') k.box(0.27, 0.28, 0.27, P.metal, { y: 1.04 });
  else if (helm === 'plume') { k.cyl(0.14, 0.15, 0.2, P.metal, { y: 1.06 }, 8); k.box(0.04, 0.2, 0.22, P.cloth, { y: 1.26, z: -0.02 }); }
}
function skeleton(k, P, { helm = false, armour = false } = {}) {
  boneLegs(k, P.skin);
  k.box(0.08, 0.36, 0.06, P.skin, { y: 0.66 });                // spine
  for (let i = 0; i < 3; i++) k.box(0.3 - i * 0.04, 0.04, 0.18, P.skin, { y: 0.78 - i * 0.09 }); // ribs
  if (armour) k.box(0.36, 0.34, 0.24, P.metal, { y: 0.7 });
  k.box(0.32, 0.1, 0.2, P.cloth, { y: 0.5 });                 // loin cloth
  k.ball(0.14, P.skin, { y: 1.0, sy: 1.1 });
  k.box(0.04, 0.04, 0.03, 0x111111, { x: -0.05, y: 1.02, z: 0.12 });
  k.box(0.04, 0.04, 0.03, 0x111111, { x: 0.05, y: 1.02, z: 0.12 });
  if (helm) k.cyl(0.13, 0.16, 0.14, P.metal, { y: 1.12 }, 6);
}

export function makeMini(look, faction) {
  const P = PAINT[faction];
  const k = new Kit();
  let h = 1.3;
  switch (look) {
    case 'sword':   // Men-at-arms
      base(k, P); human(k, P, { helm: 'kettle' }); arm(k, P.cloth, 1, { fwd: 0.06 }); arm(k, P.cloth, -1);
      sword(k, P, 1); roundShield(k, P.cloth, P.trim, -1); break;
    case 'shield':  // Shieldwall
      base(k, P); human(k, P, { helm: 'great', armour: true }); arm(k, P.metal, 1); arm(k, P.metal, -1);
      spear(k, P, 1, 1.4); towerShield(k, P.cloth, P.trim, -1); break;
    case 'crossbow':
      base(k, P); human(k, P, { helm: 'kettle' }); arm(k, P.cloth, 1, { fwd: 0.18 }); arm(k, P.cloth, -1, { fwd: 0.18 });
      k.box(0.06, 0.06, 0.5, P.wood, { y: 0.78, z: 0.26 }); k.box(0.46, 0.04, 0.05, P.metal, { y: 0.8, z: 0.46 }); break;
    case 'rider': { // Outriders
      base(k, P, 0.48, 1.55);
      k.box(0.32, 0.34, 0.78, P.horse, { y: 0.62 });
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) k.box(0.09, 0.42, 0.09, P.horse, { x: sx * 0.11, y: 0.3, z: sz * 0.28 });
      k.box(0.16, 0.36, 0.18, P.horse, { y: 0.92, z: 0.38, rx: 0.5 }); k.box(0.14, 0.14, 0.3, P.horse, { y: 1.08, z: 0.52 });
      k.box(0.36, 0.06, 0.4, P.cloth, { y: 0.81 });               // saddle cloth
      k.box(0.3, 0.34, 0.2, P.cloth, { y: 1.05 }); k.ball(0.12, P.skin, { y: 1.33 });
      k.cyl(0.1, 0.13, 0.12, P.metal, { y: 1.43 }, 8);
      spear(k, P, 1, 1.6); h = 1.6; break;
    }
    case 'lord':
      base(k, P, 0.5); human(k, P, { helm: 'plume', armour: true }); arm(k, P.metal, 1, { fwd: 0.08 }); arm(k, P.metal, -1);
      k.box(0.42, 0.62, 0.04, P.cloth, { y: 0.66, z: -0.15, rx: 0.08 });  // cape
      sword(k, P, 1); roundShield(k, P.cloth, P.trim, -1, 0.25);
      k.cyl(0.02, 0.02, 1.2, P.wood, { x: -0.12, y: 1.25, z: -0.18 }, 5); k.box(0.02, 0.3, 0.36, P.cloth, { x: -0.12, y: 1.65, z: -0.02 });
      h = 1.9; break;
    case 'skeleton':
      base(k, P); skeleton(k, P); arm(k, P.skin, 1, { fwd: 0.06 }); arm(k, P.skin, -1);
      sword(k, { ...P, metal: 0x8a6d52, trim: 0x6a5240 }, 1); roundShield(k, P.cloth2, P.metal, -1, 0.18); break;
    case 'graveguard':
      base(k, P); skeleton(k, P, { helm: true, armour: true }); arm(k, P.metal, 1); arm(k, P.metal, -1);
      towerShield(k, P.cloth, P.trim, -1);
      k.cyl(0.022, 0.022, 1.5, P.wood, { x: 0.25, y: 0.8, z: 0.12 }, 5); k.box(0.04, 0.24, 0.2, P.metal, { x: 0.25, y: 1.45, z: 0.18 }); break;
    case 'archer':
      base(k, P); skeleton(k, P); arm(k, P.skin, 1, { fwd: 0.1 }); arm(k, P.skin, -1, { fwd: 0.2 });
      k.add(new THREE.TorusGeometry(0.34, 0.025, 4, 10, Math.PI), P.wood, { x: -0.18, y: 0.82, z: 0.3, ry: Math.PI / 2, rz: Math.PI / 2 }); break;
    case 'wraith':
      base(k, P, 0.46);
      k.cone(0.32, 1.0, P.cloth, { y: 0.78, rx: Math.PI }, 7);
      k.cone(0.2, 0.42, P.cloth2, { y: 1.28 }, 6);
      k.box(0.05, 0.05, 0.03, P.glow, { x: -0.05, y: 1.18, z: 0.15 }); k.box(0.05, 0.05, 0.03, P.glow, { x: 0.05, y: 1.18, z: 0.15 });
      k.cyl(0.02, 0.02, 1.4, P.wood, { x: 0.3, y: 0.9, z: 0.1 }, 5);
      k.add(new THREE.TorusGeometry(0.28, 0.03, 3, 8, Math.PI * 0.8), P.metal, { x: 0.3, y: 1.55, z: 0.28, ry: Math.PI / 2 });
      h = 1.6; break;
    case 'necro':
      base(k, P, 0.5);
      k.cone(0.4, 1.2, P.cloth, { y: 0.66 }, 8);
      k.box(0.36, 0.1, 0.3, P.trim, { y: 0.62 });
      k.ball(0.14, P.skin, { y: 1.32 }); k.cone(0.2, 0.42, P.cloth2, { y: 1.52 }, 6);
      k.box(0.05, 0.05, 0.03, P.glow, { x: -0.05, y: 1.33, z: 0.13 }); k.box(0.05, 0.05, 0.03, P.glow, { x: 0.05, y: 1.33, z: 0.13 });
      arm(k, P.cloth, 1, { fwd: 0.06, lift: 0.25 });
      k.cyl(0.03, 0.03, 1.8, P.wood, { x: 0.3, y: 1.0, z: 0.12 }, 5); k.ball(0.11, P.glow, { x: 0.3, y: 1.95, z: 0.12 });
      h = 2.0; break;
    default:
      base(k, P); human(k, P);
  }
  const geo = k.build();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.78, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.height = h;
  return mesh;
}

// Formation offsets (local space, +z = facing) for n models
export function formation(n, look) {
  const sp = look === 'rider' ? 1.15 : look === 'wraith' ? 1.0 : 0.92;
  const depth = look === 'rider' ? 1.5 : sp;
  if (n <= 1) return [{ x: 0, z: 0 }];
  const front = n <= 3 ? Math.min(n, 2) : n === 4 ? 2 : 3;
  const rows = Math.ceil(n / front);
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / front), inRow = Math.min(front, n - row * front), col = i % front;
    out.push({ x: (col - (inRow - 1) / 2) * sp, z: ((rows - 1) / 2 - row) * depth });
  }
  return out;
}
