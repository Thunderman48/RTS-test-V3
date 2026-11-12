// Procedural low-poly miniatures: chunky faceted figures with a few flat paint colours,
// each on a thick bevelled base in the team colour.
// A mini is a small rig so it can animate:
//   root ─ base (static)
//        └ fig (lean / twist / step / rear / float)
//            ├ body (static mesh)
//            ├ arm (weapon arm, pivot at the shoulder) ─ weapon (pivot at the hand)
//            └ off (shield / bow arm, pivot at the shoulder)
import * as THREE from 'three';
import { PAINT } from '../data/units.js';
import { Kit, paintMat } from './kit.js';

export const Y0 = 0.16;        // top of the base
export const BASE_R = 0.5;     // base radius (infantry)
const DARK = 0x18161a;

// ---------------------------------------------------------------- shared parts
function baseKit(k, P, r = BASE_R, oval = 1) {
  k.cyl(r, r + 0.03, 0.12, P.base, { y: 0.06, sz: oval, sh: 0.025 }, 22);
  k.cyl(r - 0.06, r, 0.04, P.bevel, { y: 0.14, sz: oval, sh: 0.025 }, 22);
  k.cyl(r - 0.1, r - 0.07, 0.016, P.flock, { y: 0.166, sz: oval, sh: 0.1 }, 11);
}

// human legs + hips; armour = greaves
function legs(k, P, { armour = false, cloth = P.cloth2, boot = P.leather } = {}) {
  for (const sx of [-1, 1]) {
    k.chunk(0.12, 0.1, 0.3, 0.13, armour ? P.metal : cloth, { x: sx * 0.095, y: Y0 + 0.3 });
    k.chunk(0.13, 0.15, 0.13, 0.22, boot, { x: sx * 0.095, y: Y0 + 0.07, z: 0.03 });
  }
  k.chunk(0.34, 0.3, 0.12, 0.24, P.leather, { y: Y0 + 0.48 });          // hips / belt
  k.box(0.06, 0.06, 0.03, P.trim, { y: Y0 + 0.48, z: 0.125 });          // buckle
}
function boneLegs(k, P) {
  for (const sx of [-1, 1]) {
    k.chunk(0.06, 0.05, 0.36, 0.06, P.skin, { x: sx * 0.09, y: Y0 + 0.27 });
    k.ball(0.045, P.skin, { x: sx * 0.09, y: Y0 + 0.3 });
    k.chunk(0.09, 0.1, 0.06, 0.18, P.skin, { x: sx * 0.09, y: Y0 + 0.04, z: 0.03 });
  }
  k.chunk(0.26, 0.2, 0.1, 0.16, P.skin, { y: Y0 + 0.48 });               // pelvis
}
// heroic torso: broad chest, narrow waist
function torso(k, color, { w = 0.44, y = 0.7, d = 0.27 } = {}) {
  k.chunk(w, w * 0.7, 0.42, d, color, { y: Y0 + y });
}
function head(k, P, { y = 1.0, r = 0.15, skin = P.skin } = {}) {
  k.chunk(0.1, 0.12, 0.1, 0.1, skin, { y: Y0 + y - 0.14 });            // neck
  k.ball(r, skin, { y: Y0 + y, sy: 1.08 });
}
function face(k, y, z = 0.13) {
  k.box(0.035, 0.035, 0.02, DARK, { x: -0.05, y: Y0 + y, z });
  k.box(0.035, 0.035, 0.02, DARK, { x: 0.05, y: Y0 + y, z });
}
function pauldrons(k, color, y = 0.86, r = 0.12) {
  for (const sx of [-1, 1]) k.ball(r, color, { x: sx * 0.25, y: Y0 + y, sy: 0.75, sx: 1.1 });
}
function helm(k, P, kind, y = 1.0) {
  const Y = Y0 + y;
  if (kind === 'kettle') {
    k.cyl(0.12, 0.17, 0.13, P.metal, { y: Y + 0.09 }, 7);
    k.cyl(0.21, 0.22, 0.035, P.metal, { y: Y + 0.05 }, 8);
  } else if (kind === 'great') {
    k.chunk(0.33, 0.31, 0.34, 0.32, P.metal, { y: Y + 0.02, j: 0.01 });
    k.box(0.24, 0.035, 0.02, DARK, { y: Y + 0.04, z: 0.165 });
    k.box(0.035, 0.12, 0.02, P.trim, { y: Y - 0.06, z: 0.165 });
  } else if (kind === 'plume') {
    k.chunk(0.3, 0.32, 0.3, 0.32, P.metal, { y: Y + 0.03, j: 0.01 }, 6);
    k.box(0.2, 0.03, 0.02, DARK, { y: Y + 0.03, z: 0.165 });
    k.box(0.06, 0.22, 0.36, P.cloth, { y: Y + 0.28, z: -0.04, j: 0.02 });
    k.box(0.07, 0.04, 0.3, P.trim, { y: Y + 0.17 });
  } else if (kind === 'horned') {
    k.chunk(0.3, 0.33, 0.24, 0.32, P.metal, { y: Y + 0.07 }, 6);
    for (const sx of [-1, 1]) k.cone(0.06, 0.32, P.cloth2 === 0x2b2533 ? 0xd9cfb4 : P.trim, { x: sx * 0.2, y: Y + 0.2, rz: -sx * 0.9 }, 5);
    k.box(0.26, 0.04, 0.02, P.glow || DARK, { y: Y, z: 0.16 });
  } else if (kind === 'hood') {
    k.cone(0.22, 0.42, P.cloth, { y: Y + 0.12, j: 0.015 }, 6);
    k.ball(0.18, P.cloth, { y: Y - 0.02, z: -0.04, sy: 1.05 });
  }
}
function cape(k, color, { w = 0.46, len = 0.82, y = 0.5 } = {}) {
  k.chunk(w * 0.85, w * 1.2, len, 0.05, color, { y: Y0 + y, z: -0.17, rx: 0.12, j: 0.012 });
}
function ribs(k, P) {
  k.chunk(0.07, 0.07, 0.4, 0.06, P.skin, { y: Y0 + 0.7, z: -0.04 });       // spine
  for (let i = 0; i < 4; i++) k.chunk(0.3 - i * 0.04, 0.28 - i * 0.04, 0.045, 0.2 - i * 0.02, P.skin, { y: Y0 + 0.86 - i * 0.085 });
}
function skull(k, P, y = 1.0, eyes = DARK) {
  k.chunk(0.06, 0.07, 0.12, 0.06, P.skin, { y: Y0 + y - 0.15 });
  k.ball(0.15, P.skin, { y: Y0 + y + 0.02, sy: 1.05 });
  k.chunk(0.17, 0.13, 0.08, 0.14, P.skin, { y: Y0 + y - 0.1, z: 0.04 });   // jaw
  face(k, y, 0.135);
  if (eyes !== DARK) { k.box(0.03, 0.03, 0.01, eyes, { x: -0.05, y: Y0 + y, z: 0.146 }); k.box(0.03, 0.03, 0.01, eyes, { x: 0.05, y: Y0 + y, z: 0.146 }); }
}

// arms are built in shoulder space (origin = shoulder, hanging down -y)
function armKit(sleeve, hand, { bone = false, pad = null } = {}) {
  const k = new Kit(5);
  if (bone) {
    k.chunk(0.055, 0.05, 0.34, 0.055, hand, { y: -0.18 });
  } else {
    k.chunk(0.12, 0.1, 0.22, 0.12, sleeve, { y: -0.1 });
    k.chunk(0.1, 0.11, 0.17, 0.11, sleeve, { y: -0.27 });
  }
  if (pad) k.ball(0.12, pad, { y: 0.02, sy: 0.75, sx: 1.1 });
  k.ball(0.065, hand, { y: -0.37 });
  return k;
}
const HAND = new THREE.Vector3(0, -0.37, 0.02);

// weapons are built in hand space; the blade/shaft points along +z
function swordKit(P, { len = 0.62, w = 0.075, metal = P.metal, guard = P.trim } = {}) {
  const k = new Kit(9);
  k.box(0.05, 0.05, 0.16, P.leather, { z: -0.02 });
  k.box(0.24, 0.05, 0.05, guard, { z: 0.07 });
  k.chunk(w, w * 0.8, len, 0.025, metal, { z: 0.1 + len / 2, rx: Math.PI / 2, sh: 0.08 });
  k.cone(w * 0.55, 0.12, metal, { z: 0.16 + len, rx: Math.PI / 2 }, 4);
  return k;
}
function spearKit(P, len = 1.5) {
  const k = new Kit(9);
  k.cyl(0.024, 0.024, len, P.wood, { z: len / 2 - 0.45, rx: Math.PI / 2 }, 5);
  k.cone(0.065, 0.22, P.metal, { z: len - 0.34, rx: Math.PI / 2 }, 4);
  k.box(0.08, 0.04, 0.04, P.trim, { z: len - 0.47 });
  return k;
}
function crossbowKit(P) {
  const k = new Kit(9);
  k.box(0.07, 0.08, 0.6, P.wood, { z: 0.12 });
  k.box(0.56, 0.05, 0.06, P.metal, { z: 0.38, ry: 0 });
  k.box(0.5, 0.012, 0.012, 0xeeeeee, { z: 0.3 });
  k.box(0.03, 0.03, 0.3, P.metal, { z: 0.3, y: 0.05 });
  return k;
}
function staffKit(P, glow) {
  const k = new Kit(9);
  k.cyl(0.03, 0.035, 1.75, P.wood, { z: 0.35, rx: Math.PI / 2, j: 0.006 }, 5);
  k.ball(0.12, 0xe6dcc3, { z: 1.27 });                     // skull
  k.cone(0.05, 0.22, P.wood, { x: 0.1, z: 1.25, rz: -0.9, rx: Math.PI / 2 }, 4);
  k.cone(0.05, 0.22, P.wood, { x: -0.1, z: 1.25, rz: 0.9, rx: Math.PI / 2 }, 4);
  void glow;
  return k;
}
function lanceKit(P) {
  const k = new Kit(9);
  k.cyl(0.03, 0.045, 2.1, P.wood, { z: 0.6, rx: Math.PI / 2 }, 6);
  k.cone(0.07, 0.3, P.metal, { z: 1.8, rx: Math.PI / 2 }, 4);
  k.box(0.02, 0.18, 0.3, P.cloth2, { z: 1.48, y: 0.1 });
  k.cone(0.09, 0.12, P.metal, { z: -0.12, rx: -Math.PI / 2 }, 6);
  return k;
}
function scytheKit(P) {
  const k = new Kit(9);
  k.cyl(0.026, 0.026, 1.6, P.wood, { z: 0.4, rx: Math.PI / 2, j: 0.008 }, 5);
  k.chunk(0.05, 0.02, 0.62, 0.11, P.metal, { y: -0.3, z: 1.16, rx: 0.15, sh: 0.1 });
  k.chunk(0.03, 0.04, 0.2, 0.08, P.metal, { y: -0.66, z: 1.06, rx: 0.9 });
  return k;
}
// shields are in hand space, facing forward when the off arm is raised about 0.6 rad
function roundShieldKit(P, face, rim, r = 0.25) {
  const k = new Kit(13);
  const o = { x: -0.03, y: 0.1, z: 0.1, rx: Math.PI / 2 + 0.6 };
  k.cyl(r, r, 0.05, face, o, 10);
  k.cyl(r + 0.03, r + 0.03, 0.03, rim, { ...o, y: o.y + 0.02 * Math.sin(0.6), z: o.z - 0.02 * Math.cos(0.6) }, 10);
  k.ball(0.07, rim, { x: -0.03, y: 0.1 - 0.03 * Math.sin(0.6), z: 0.1 + 0.04 * Math.cos(0.6) });
  return k;
}
function towerShieldKit(P) {
  const k = new Kit(13);
  const o = { x: -0.03, y: 0.12, z: 0.12, rx: 0.6 };
  k.box(0.5, 0.76, 0.07, P.cloth, { ...o, sh: 0.03 });
  k.box(0.08, 0.6, 0.02, P.trim, { ...o, z: o.z + 0.04 * Math.cos(0.6), y: o.y - 0.04 * Math.sin(0.6) });
  k.box(0.38, 0.08, 0.02, P.trim, { ...o, z: o.z + 0.04 * Math.cos(0.6), y: o.y + 0.08 - 0.04 * Math.sin(0.6) });
  k.box(0.54, 0.8, 0.04, P.metal, { ...o, z: o.z - 0.04 * Math.cos(0.6), y: o.y + 0.04 * Math.sin(0.6) });
  return k;
}
function bowKit(P) {
  const k = new Kit(13);
  // vertical bow when the off arm points forward: limbs along local z, bulging along local -y
  const g = new THREE.TorusGeometry(0.42, 0.028, 4, 12, Math.PI);
  g.rotateY(Math.PI / 2); g.rotateX(Math.PI);
  k.geo(g, P.wood, { y: 0.02 });
  k.box(0.01, 0.01, 0.84, 0xd8d0c0, { y: 0.02 });
  return k;
}

// ---------------------------------------------------------------- figures
const STYLE = {
  sword: 'slash', lord: 'cleave', skeleton: 'slash', graveguard: 'slash',
  shield: 'thrust', crossbow: 'shoot', archer: 'bow', rider: 'lance', wraith: 'scythe', necro: 'cast',
};

export function makeMini(look, faction, seed = 1) {
  const P = PAINT[faction];
  const style = STYLE[look] || 'slash';
  const kb = new Kit(seed), kbase = new Kit(seed + 1);
  let arm = null, weapon = null, off = null, glow = null;
  let shoulder = new THREE.Vector3(0.27, Y0 + 0.84, 0), offShoulder = new THREE.Vector3(-0.27, Y0 + 0.84, 0);
  const fig = new THREE.Vector3(0, Y0, 0);   // fig pivot
  let scale = 1, h = 1.35;

  switch (look) {
    case 'sword': { // Men-at-arms
      baseKit(kbase, P);
      legs(kb, P); torso(kb, P.cloth);
      kb.chunk(0.2, 0.18, 0.4, 0.29, P.cloth2, { y: Y0 + 0.68 });       // tabard stripe
      head(kb, P); face(kb, 1.0); helm(kb, P, 'kettle');
      pauldrons(kb, P.metal);
      arm = armKit(P.metal, P.leather); weapon = swordKit(P);
      off = armKit(P.metal, P.leather); mergeInto(off, roundShieldKit(P, P.cloth, P.trim), HAND);
      break;
    }
    case 'shield': { // Shieldwall
      baseKit(kbase, P);
      legs(kb, P, { armour: true }); torso(kb, P.metal, { w: 0.48 });
      kb.chunk(0.3, 0.26, 0.36, 0.3, P.cloth, { y: Y0 + 0.62 });
      head(kb, P); helm(kb, P, 'great');
      pauldrons(kb, P.metal, 0.88, 0.14);
      arm = armKit(P.metal, P.metal); weapon = spearKit(P, 1.55);
      off = armKit(P.metal, P.metal); mergeInto(off, towerShieldKit(P), HAND);
      break;
    }
    case 'crossbow': {
      baseKit(kbase, P);
      legs(kb, P); torso(kb, P.cloth2, { w: 0.42 });
      kb.chunk(0.36, 0.28, 0.12, 0.29, P.cloth, { y: Y0 + 0.86 });       // collar
      kb.chunk(0.1, 0.09, 0.4, 0.29, P.cloth, { y: Y0 + 0.68 });
      head(kb, P); face(kb, 1.0); helm(kb, P, 'kettle');
      kb.chunk(0.12, 0.1, 0.36, 0.12, P.leather, { x: 0.12, y: Y0 + 0.7, z: -0.17, rz: 0.3 }); // quiver
      arm = armKit(P.cloth, P.skin); weapon = crossbowKit(P);
      off = armKit(P.cloth, P.skin);
      break;
    }
    case 'lord': {
      baseKit(kbase, P, 0.56);
      scale = 1.12;
      legs(kb, P, { armour: true }); torso(kb, P.metal, { w: 0.5 });
      kb.chunk(0.5, 0.36, 0.06, 0.3, P.trim, { y: Y0 + 0.9 });
      kb.chunk(0.34, 0.3, 0.36, 0.31, P.cloth, { y: Y0 + 0.64 });       // surcoat
      kb.box(0.06, 0.26, 0.02, P.trim, { y: Y0 + 0.66, z: 0.16 });
      head(kb, P); helm(kb, P, 'plume');
      pauldrons(kb, P.metal, 0.9, 0.16);
      cape(kb, P.cloth, { w: 0.5, len: 0.9, y: 0.48 });
      arm = armKit(P.metal, P.metal); weapon = swordKit(P, { len: 0.95, w: 0.1 });
      off = armKit(P.metal, P.metal);
      h = 1.6;
      break;
    }
    case 'skeleton': {
      baseKit(kbase, P);
      boneLegs(kb, P); ribs(kb, P);
      kb.chunk(0.32, 0.36, 0.16, 0.24, P.cloth, { y: Y0 + 0.44, j: 0.02 });  // ragged loincloth
      skull(kb, P);
      arm = armKit(null, P.skin, { bone: true }); weapon = swordKit({ ...P }, { metal: P.rust, guard: P.wood, len: 0.55 });
      off = armKit(null, P.skin, { bone: true }); mergeInto(off, roundShieldKit(P, P.cloth2, P.rust, 0.2), HAND);
      break;
    }
    case 'graveguard': {
      baseKit(kbase, P);
      boneLegs(kb, P);
      for (const sx of [-1, 1]) kb.chunk(0.12, 0.1, 0.24, 0.13, P.metal, { x: sx * 0.09, y: Y0 + 0.3 });
      torso(kb, P.metal, { w: 0.5 });
      kb.chunk(0.36, 0.42, 0.26, 0.3, P.cloth, { y: Y0 + 0.42, j: 0.02 });
      skull(kb, P, 1.0, P.glow); helm(kb, P, 'horned');
      pauldrons(kb, P.metal, 0.88, 0.15);
      arm = armKit(P.metal, P.metal); weapon = swordKit(P, { len: 0.8, w: 0.13, guard: P.metal });
      off = armKit(P.metal, P.metal); mergeInto(off, roundShieldKit(P, P.cloth, P.metal, 0.27), HAND);
      break;
    }
    case 'archer': {
      baseKit(kbase, P);
      boneLegs(kb, P); ribs(kb, P);
      kb.chunk(0.32, 0.36, 0.16, 0.24, P.cloth2, { y: Y0 + 0.44, j: 0.02 });
      skull(kb, P); helm(kb, P, 'hood');
      kb.chunk(0.5, 0.3, 0.12, 0.26, P.cloth, { y: Y0 + 0.9, j: 0.015 });    // mantle
      kb.chunk(0.12, 0.1, 0.4, 0.12, P.leather, { x: 0.1, y: Y0 + 0.74, z: -0.16, rz: 0.35 }); // quiver
      arm = armKit(null, P.skin, { bone: true });
      off = armKit(null, P.skin, { bone: true }); mergeInto(off, bowKit(P), HAND);
      break;
    }
    case 'rider': { // Outriders
      baseKit(kbase, P, 0.46, 1.7);
      fig.set(0, Y0, -0.38);
      // horse
      kb.chunk(0.38, 0.34, 0.95, 0.42, P.horse, { y: Y0 + 0.66, rx: Math.PI / 2 });
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        kb.chunk(0.11, 0.08, 0.5, 0.12, P.horse, { x: sx * 0.13, y: Y0 + 0.26, z: sz * 0.32 });
        kb.box(0.1, 0.06, 0.12, DARK, { x: sx * 0.13, y: Y0 + 0.03, z: sz * 0.32 + 0.01 });
      }
      kb.chunk(0.16, 0.26, 0.44, 0.24, P.horse, { y: Y0 + 0.98, z: 0.48, rx: 0.55 });
      kb.chunk(0.12, 0.18, 0.38, 0.2, P.horse, { y: Y0 + 1.17, z: 0.7, rx: 1.85 });
      kb.box(0.06, 0.34, 0.12, P.mane, { y: Y0 + 1.06, z: 0.4, rx: 0.55 });
      for (const sx of [-1, 1]) kb.cone(0.035, 0.12, P.horse, { x: sx * 0.05, y: Y0 + 1.27, z: 0.6 }, 4);
      kb.chunk(0.08, 0.04, 0.44, 0.08, P.mane, { y: Y0 + 0.55, z: -0.55, rx: -0.5 });
      kb.chunk(0.48, 0.5, 0.3, 0.56, P.cloth, { y: Y0 + 0.72, j: 0.01 });  // barding
      kb.chunk(0.5, 0.52, 0.05, 0.58, P.trim, { y: Y0 + 0.58 });
      // rider
      for (const sx of [-1, 1]) kb.chunk(0.11, 0.1, 0.36, 0.13, P.cloth2, { x: sx * 0.22, y: Y0 + 0.8, z: 0.04, rx: -0.4 });
      kb.chunk(0.36, 0.26, 0.38, 0.24, P.cloth, { y: Y0 + 1.1 });
      kb.chunk(0.12, 0.1, 0.38, 0.25, P.cloth2, { y: Y0 + 1.1 });
      head(kb, P, { y: 1.42 }); face(kb, 1.42); helm(kb, P, 'kettle', 1.42);
      shoulder = new THREE.Vector3(0.23, Y0 + 1.25, 0); offShoulder = new THREE.Vector3(-0.23, Y0 + 1.25, 0);
      arm = armKit(P.cloth, P.leather); weapon = lanceKit(P);
      off = armKit(P.cloth, P.leather); mergeInto(off, roundShieldKit(P, P.cloth2, P.trim, 0.2), HAND);
      h = 1.75;
      break;
    }
    case 'wraith': {
      baseKit(kbase, P, 0.48);
      fig.set(0, Y0 + 0.2, 0);
      kb.cone(0.36, 1.0, P.cloth, { y: Y0 + 0.78, rx: Math.PI, j: 0.03 }, 7);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; kb.cone(0.08, 0.3, P.cloth2, { x: Math.sin(a) * 0.26, y: Y0 + 0.3, z: Math.cos(a) * 0.26, rx: Math.PI, j: 0.02 }, 4); }
      kb.chunk(0.46, 0.3, 0.3, 0.3, P.cloth2, { y: Y0 + 1.1, j: 0.02 });
      kb.ball(0.17, DARK, { y: Y0 + 1.33 });
      kb.box(0.05, 0.04, 0.02, P.glow, { x: -0.055, y: Y0 + 1.36, z: 0.155, sh: 0 });
      kb.box(0.05, 0.04, 0.02, P.glow, { x: 0.055, y: Y0 + 1.36, z: 0.155, sh: 0 });
      helm(kb, P, 'hood', 1.36);
      shoulder = new THREE.Vector3(0.26, Y0 + 1.16, 0); offShoulder = new THREE.Vector3(-0.26, Y0 + 1.16, 0);
      arm = armKit(P.cloth2, P.skin); weapon = scytheKit(P);
      off = armKit(P.cloth2, P.skin);
      h = 1.75;
      break;
    }
    case 'necro': {
      baseKit(kbase, P, 0.56);
      scale = 1.1;
      kb.cyl(0.2, 0.4, 0.9, P.cloth, { y: Y0 + 0.45, j: 0.02 }, 7);          // robe
      kb.cyl(0.21, 0.24, 0.08, P.trim, { y: Y0 + 0.62 }, 7);
      torso(kb, P.cloth, { w: 0.44, y: 0.8 });
      kb.chunk(0.5, 0.36, 0.14, 0.3, P.cloth2, { y: Y0 + 0.98, j: 0.015 });   // mantle
      cape(kb, P.cloth2, { w: 0.5, len: 1.0, y: 0.55 });
      skull(kb, P, 1.18, P.glow); helm(kb, P, 'hood', 1.2);
      shoulder = new THREE.Vector3(0.27, Y0 + 1.0, 0); offShoulder = new THREE.Vector3(-0.27, Y0 + 1.0, 0);
      arm = armKit(P.cloth, P.skin, { pad: P.cloth2 }); weapon = staffKit(P);
      off = armKit(P.cloth, P.skin, { pad: P.cloth2 });
      glow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: P.glow, transparent: true, opacity: 0.9 }));
      glow.position.set(0, 0, 1.42);
      h = 1.9;
      break;
    }
    default:
      baseKit(kbase, P); legs(kb, P); torso(kb, P.cloth); head(kb, P);
      arm = armKit(P.cloth, P.skin); off = armKit(P.cloth, P.skin);
  }

  const mat = paintMat();
  const root = new THREE.Group();
  const baseMesh = kbase.mesh(mat); baseMesh.castShadow = false;
  root.add(baseMesh);
  const figG = new THREE.Group(); figG.position.copy(fig); figG.scale.setScalar(scale);
  root.add(figG);
  const body = kb.mesh(mat, fig); figG.add(body);
  const armG = new THREE.Group(); armG.rotation.order = 'YXZ';
  armG.position.copy(shoulder).sub(fig); figG.add(armG);
  armG.add(arm.mesh(mat));
  let weapG = null;
  if (weapon) {
    weapG = new THREE.Group(); weapG.position.copy(HAND); armG.add(weapG);
    weapG.add(weapon.mesh(mat));
    if (glow) weapG.add(glow);
  }
  const offG = new THREE.Group(); offG.rotation.order = 'YXZ';
  offG.position.copy(offShoulder).sub(fig); figG.add(offG);
  offG.add(off.mesh(mat));
  root.userData = { height: h * scale, mat, rig: { style, fig: figG, figBase: fig.clone(), arm: armG, weapon: weapG, off: offG, glow, look } };
  poseMini(root, POSES[style].rest, 0, 0);
  return root;
}

// merge kit b's parts into kit a (optionally offset, e.g. a bow held in the hand)
function mergeInto(a, b, at = null) {
  for (const p of b.parts) {
    if (at) p.m.premultiply(new THREE.Matrix4().makeTranslation(at.x, at.y, at.z));
    a.parts.push(p);
  }
}

// ---------------------------------------------------------------- poses & animation
// a = weapon arm pitch (negative raises forward), p = weapon pitch in the hand, r = arm roll,
// y = arm yaw, oa/or = off arm pitch/roll, step = forward offset, lean = body pitch,
// twist = body yaw, rear = mount pitch (negative lifts the front), draw = arm pulled back
export const POSES = {
  slash:  { rest: { a: -0.35, p: -0.35, r: 0.12, oa: -0.55, or: -0.12 },
            wind: { a: -2.55, p: -0.25, r: 0.5, oa: -0.95, or: -0.25, step: -0.06, lean: -0.1, twist: 0.4 },
            strike: { a: -0.8, p: 1.0, r: -0.4, oa: -0.6, or: -0.1, step: 0.32, lean: 0.22, twist: -0.35 } },
  cleave: { rest: { a: -0.3, p: -0.55, r: 0.1, oa: -0.2, or: -0.2 },
            wind: { a: -2.85, p: -0.15, r: 0.25, oa: -2.3, or: 0.25, step: -0.08, lean: -0.15, twist: 0.2 },
            strike: { a: -0.85, p: 1.1, r: -0.15, oa: -0.9, or: 0.1, step: 0.38, lean: 0.3, twist: -0.15 } },
  thrust: { rest: { a: -0.3, p: -1.15, r: 0.08, oa: -0.62, or: -0.08 },
            wind: { a: -0.55, p: 0.55, r: 0.1, oa: -0.85, or: -0.08, step: -0.12, lean: -0.08 },
            strike: { a: -1.45, p: 1.45, r: 0.05, oa: -1.15, or: -0.05, step: 0.4, lean: 0.18 } },
  shoot:  { rest: { a: -0.65, p: 0.9, r: 0.2, oa: -0.7, or: -0.35 },
            wind: { a: -1.48, p: 1.48, r: 0.12, oa: -1.42, or: -0.5 },
            strike: { a: -1.85, p: 1.48, r: 0.12, oa: -1.7, or: -0.5, step: -0.1, lean: -0.12 } },
  bow:    { rest: { a: -0.25, p: 0, r: 0.15, oa: -0.5, or: 0.1 },
            wind: { a: -1.5, p: 0, r: 0.35, y: 0.5, oa: -1.55, or: 0.05, draw: 1, twist: 0.25 },
            strike: { a: -1.2, p: 0, r: 0.6, y: 0.8, oa: -1.6, or: 0.05, draw: 1.3, twist: 0.25, lean: -0.05 } },
  lance:  { rest: { a: -0.3, p: -1.05, r: 0.1, oa: -0.55, or: -0.2 },
            wind: { a: -0.55, p: 0.55, r: 0.05, oa: -0.7, or: -0.2, rear: -0.38, step: -0.1 },
            strike: { a: -1.05, p: 1.05, r: 0.0, oa: -0.6, or: -0.2, rear: 0.12, step: 0.55, lean: 0.12 } },
  scythe: { rest: { a: -0.7, p: -0.75, r: 0.1, oa: -0.6, or: -0.15 },
            wind: { a: -1.25, p: 0.6, r: 0.1, y: 1.3, oa: -1.0, twist: 0.55, step: -0.05 },
            strike: { a: -1.25, p: 0.6, r: -0.1, y: -1.25, oa: -0.7, twist: -0.55, step: 0.35, lean: 0.12 } },
  cast:   { rest: { a: -0.22, p: -1.33, r: 0.1, oa: -0.4, or: -0.2 },
            wind: { a: -2.75, p: 1.2, r: 0.15, oa: -1.5, or: -0.4, lean: -0.1 },
            strike: { a: -1.35, p: 0.35, r: 0.0, oa: -1.2, or: -0.3, step: 0.18, lean: 0.18 } },
};
const KEYS = ['a', 'p', 'r', 'y', 'oa', 'or', 'step', 'lean', 'twist', 'rear', 'draw'];
export function lerpPose(A, B, t, out = {}) {
  for (const k of KEYS) out[k] = (A[k] || 0) + ((B[k] || 0) - (A[k] || 0)) * t;
  return out;
}
const ease = t => t * t * (3 - 2 * t);

// pose for an attack: T0 = start of wind-up, T1 = release, now = current time (AP units)
// lead = how long before T1 the strike motion starts (projectile flight time for shooters)
export function attackPose(style, T0, T1, now, lead = 1.5) {
  const P = POSES[style];
  const ts = T1 - lead;                       // strike moment
  if (now < T0 || now > T1 + 7) return P.rest;
  if (now < ts - 1.5) return lerpPose(P.rest, P.wind, ease(Math.min(1, (now - T0) / Math.max(1, ts - 1.5 - T0) * 1.4)));
  if (now < ts) return lerpPose(P.wind, P.strike, ease((now - (ts - 1.5)) / 1.5) ** 2);
  if (now < ts + 1) return P.strike;
  return lerpPose(P.strike, style === 'shoot' || style === 'bow' ? P.wind : P.rest, ease(Math.min(1, (now - ts - 1) / 5)));
}

// apply a pose; hop = walking hop (0..1 phase), extra = { struck, fall }
export function poseMini(root, q, hop = 0, time = 0) {
  const R = root.userData.rig;
  R.arm.rotation.set(q.a || 0, q.y || 0, q.r || 0);
  if (R.weapon) R.weapon.rotation.x = q.p || 0;
  R.arm.position.z = (R.arm.userData.z0 ?? (R.arm.userData.z0 = R.arm.position.z)) - (q.draw || 0) * 0.2;
  R.off.rotation.set(q.oa || 0, 0, q.or || 0);
  R.fig.position.set(R.figBase.x, R.figBase.y + hop, R.figBase.z + (q.step || 0));
  R.fig.rotation.set((q.lean || 0) + (q.rear || 0), q.twist || 0, 0);
  if (R.look === 'wraith') R.fig.position.y += 0.06 * Math.sin(time * 2.2 + root.id);
  if (R.glow) { const s = 1 + 0.25 * Math.sin(time * 4) + (q.glow || 0); R.glow.scale.setScalar(s); }
}

// Formation offsets (local space, +z = facing) for n models
export function formation(n, look) {
  if (n <= 1) return [{ x: 0, z: 0 }];
  if (look === 'rider') {
    const pts = [{ x: -0.56, z: 0.45 }, { x: 0.56, z: 0.45 }, { x: 0, z: -0.6 }, { x: -1.1, z: -0.6 }, { x: 1.1, z: -0.6 }];
    return pts.slice(0, n);
  }
  const sp = look === 'wraith' ? 1.08 : 1.06;
  if (n === 5) return [{ x: -0.74, z: 0.5 }, { x: 0.74, z: 0.5 }, { x: 0, z: 0 }, { x: -0.74, z: -0.5 }, { x: 0.74, z: -0.5 }];
  const front = n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / front);
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / front), inRow = Math.min(front, n - row * front), col = i % front;
    out.push({ x: (col - (inRow - 1) / 2) * sp, z: ((rows - 1) / 2 - row) * sp });
  }
  return out;
}
