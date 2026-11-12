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
import { rng } from '../sim/rng.js';

export const Y0 = 0.16;        // top of the base
export const BASE_R = 0.5;     // base radius (infantry)
const DARK = 0x18161a;

// soft contact shadow under each base
let shadowTex = null;
const SHADOW_GEO = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
function shadowMat() {
  if (!shadowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.38)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

// ---------------------------------------------------------------- point-cloud helpers
// Everything is sculpted from convex hulls of small point clouds: big flat facet planes,
// chunky fused masses, like a hand-cut low-poly casting.
let R = Math.random;
const jit = (pts, a = 0.012) => pts.map(p => [p[0] + (R() - 0.5) * 2 * a, p[1] + (R() - 0.5) * 2 * a, p[2] + (R() - 0.5) * 2 * a]);
// octagonal ring (rectangle with chamfered corners) at height y
function ring(cx, y, cz, w, d, bev = 0.32) {
  const hw = w / 2, hd = d / 2, bx = hw * bev, bz = hd * bev;
  return [[cx - hw + bx, y, cz - hd], [cx + hw - bx, y, cz - hd], [cx + hw, y, cz - hd + bz], [cx + hw, y, cz + hd - bz],
    [cx + hw - bx, y, cz + hd], [cx - hw + bx, y, cz + hd], [cx - hw, y, cz + hd - bz], [cx - hw, y, cz - hd + bz]];
}
// ring in the xy plane at depth z (for rods along +z)
function ringZ(cx, cy, z, r, n = 6) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + Math.PI / n; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]); }
  return out;
}
const box = (cx, cy, cz, w, h, d) => {
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push([cx + sx * w / 2, cy + sy * h / 2, cz + sz * d / 2]);
  return out;
};
const rings = (...rs) => rs.flat();
const DARK2 = 0x2a2226;

// soft-edged base: thick bevelled disc in the team colour, flock on top
function baseKit(k, P, r = BASE_R, oval = 1) {
  k.cyl(r, r + 0.03, 0.12, P.base, { y: 0.06, sz: oval, sh: 0.025 }, 16);
  k.cyl(r - 0.06, r, 0.04, P.bevel, { y: 0.14, sz: oval, sh: 0.025 }, 16);
  k.cyl(r - 0.1, r - 0.07, 0.016, P.flock, { y: 0.166, sz: oval, sh: 0.1 }, 9);
}

// ---------------------------------------------------------------- body parts (mini space, +z forward)
// low-poly head after the reference: brow plane, cheekbones, tapered jaw; face = brows,
// closed-eye lines and a wedge nose
const HEAD = [[-.09, .13, .1], [.09, .13, .1], [-.125, .045, .12], [.125, .045, .12], [-.13, -.03, .085], [.13, -.03, .085],
  [-.09, -.12, .07], [.09, -.12, .07], [-.035, -.17, .085], [.035, -.17, .085], [-.135, .07, -.07], [.135, .07, -.07],
  [-.12, -.07, -.1], [.12, -.07, -.1], [0, .165, -.01], [-.08, .165, .03], [.08, .165, .03], [0, -.11, -.12], [0, .1, -.13]];
const at = (pts, x, y, z, s = 1) => pts.map(p => [x + p[0] * s, y + p[1] * s, z + p[2] * s]);
function head(k, P, x, y, z, { s = 1, skin = P.skin, face = true, hair = null } = {}) {
  k.hull(at(HEAD, x, y, z, s), skin);
  for (const sx of [-1, 1]) k.hull(at([[sx * .125, .05, .0], [sx * .125, -.05, -.02], [sx * .16, .03, -.04], [sx * .15, -.04, -.05]], x, y, z, s), skin);
  if (face) {
    for (const sx of [-1, 1]) {
      k.hull(at(box(sx * .056, .058, .117, .075, .026, .034).map(p => [p[0], p[1] + (p[0] * sx > .06 ? -.008 : 0), p[2]]), x, y, z, s), hair || P.hair, { sh: 0 });
      k.hull(at(box(sx * .056, .02, .112, .056, .011, .03), x, y, z, s), DARK2, { sh: 0 });
    }
    k.hull(at([[0, .04, .112], [-.026, -.045, .112], [.026, -.045, .112], [0, -.05, .155], [0, .02, .132]], x, y, z, s), skin);
  }
  if (hair) k.hull(at(HEAD.filter(p => p[2] < .05 || p[1] > .12).map(p => [p[0] * 1.1, p[1] * 1.08 + .01, p[2] * 1.1 - .01]), x, y, z, s), hair);
}
// skull: bone head with dark sockets, nose notch and a jaw
function skull(k, P, x, y, z, { s = 1, eyes = null } = {}) {
  k.hull(at(HEAD.map(p => [p[0] * 0.95, p[1] < -.1 ? p[1] * 0.8 : p[1], p[2]]), x, y, z, s), P.skin);
  for (const sx of [-1, 1]) {
    k.hull(at([[sx * .025, .055, .118], [sx * .095, .055, .118], [sx * .085, -.005, .112], [sx * .03, -.01, .12], [sx * .06, .025, .135]], x, y, z, s), eyes || DARK2, { sh: 0 });
  }
  k.hull(at([[0, -.02, .12], [-.022, -.065, .11], [.022, -.065, .11], [0, -.05, .135]], x, y, z, s), DARK2, { sh: 0 });
  k.hull(at(rings(ring(0, -.1, .02, .2, .16), ring(0, -.17, .04, .14, .1)), x, y, z, s), P.skin);
}
function helm(k, P, kind, x, y, z, s = 1) {
  const H = (pts, col, o) => k.hull(at(pts, x, y, z, s), col, o);
  if (kind === 'kettle') {
    H(rings(ring(0, .075, 0, .42, .42, .35), ring(0, .105, 0, .38, .38, .35)), P.metal);
    H(rings(ring(0, .07, -.005, .3, .3, .45), ring(0, .17, 0, .24, .24, .45), [[0, .235, 0]]), P.metal);
  } else if (kind === 'great') {
    H(rings(ring(0, -.17, 0, .31, .32, .3), ring(0, .14, 0, .32, .32, .3), ring(0, .22, 0, .22, .22, .4)), P.metal);
    H(box(0, .035, .16, .24, .034, .02), DARK2, { sh: 0 });
    H(box(0, -.07, .162, .04, .16, .02), P.trim, { sh: 0 });
  } else if (kind === 'plume') {
    H(rings(ring(0, -.15, 0, .3, .32, .45), ring(0, .12, 0, .32, .33, .45), ring(0, .21, 0, .2, .22, .5)), P.metal);
    H(box(0, .03, .165, .22, .03, .02), DARK2, { sh: 0 });
    H(rings(ring(0, .2, .12, .06, .06), ring(0, .38, .02, .07, .08), ring(0, .3, -.24, .05, .06), ring(0, .14, -.2, .05, .05)), P.cloth);
  } else if (kind === 'horned') {
    H(rings(ring(0, -.06, 0, .32, .32, .4), ring(0, .14, 0, .32, .32, .4), ring(0, .22, 0, .2, .2, .5)), P.metal);
    for (const sx of [-1, 1]) {
      H(rings(ringZ(sx * .16, .1, 0, .045).map(p => [p[0], p[1], p[2]]), [[sx * .3, .2, .02], [sx * .29, .17, -.01]]), 0xd9cfb4);
      H([[sx * .3, .2, .02], [sx * .29, .17, -.01], [sx * .31, .16, .02], [sx * .34, .38, .06]], 0xd9cfb4);
    }
    H(box(0, .02, .162, .22, .035, .02), P.glow || DARK2, { sh: 0 });
  } else if (kind === 'hood') {
    // open at the front: the face stays visible inside the cowl
    H(rings(ring(0, -.22, -.08, .42, .36, .35), ring(0, .05, -.08, .44, .38, .35), ring(0, .2, -.08, .34, .3, .4), [[0, .34, -.14], [-.17, .16, .1], [.17, .16, .1], [0, .24, .08]]), P.cloth);
  }
}
// heroic human body: thick legs, big boots, barrel torso, fused shoulders
function human(k, P, { torsoCol = P.cloth, legCol = P.cloth2, boot = P.leather, armour = false } = {}) {
  for (const sx of [-1, 1]) {
    k.hull(jit(rings(ring(sx * .1, Y0 + .52, 0, .17, .19), ring(sx * .11, Y0 + .3, .015, .15, .16), ring(sx * .11, Y0 + .1, 0, .135, .14))), armour ? P.metal : legCol);
    k.hull(jit(rings(ring(sx * .11, Y0 + .0, .04, .16, .27, .25), ring(sx * .11, Y0 + .14, .02, .15, .2, .35))), boot);
  }
  k.hull(jit(rings(ring(0, Y0 + .46, 0, .34, .25), ring(0, Y0 + .62, 0, .36, .26), ring(0, Y0 + .82, 0, .48, .3), ring(0, Y0 + .94, -.01, .4, .25), ring(0, Y0 + 1.0, 0, .15, .15))), torsoCol);
  k.hull(rings(ring(0, Y0 + .45, 0, .36, .27), ring(0, Y0 + .52, 0, .36, .27)), P.leather);
  k.hull(box(0, Y0 + .485, .14, .07, .06, .02), P.trim, { sh: 0 });
}
function tabard(k, col, { w = .26, top = .88, bot = .3, z = .135 } = {}) {
  const pts = [];
  for (const sx of [-1, 1]) pts.push([sx * w / 2, Y0 + top, z], [sx * (w / 2 + .01), Y0 + bot, z - .01], [sx * w / 2, Y0 + top, z - .07], [sx * (w / 2 + .01), Y0 + bot, z - .06]);
  k.hull(pts, col);
}
function pauldrons(k, col, size = 1) {
  for (const sx of [-1, 1]) k.hull(jit(rings(ring(sx * .26, Y0 + .8, 0, .2 * size, .22 * size, .45), ring(sx * .27, Y0 + .92, 0, .22 * size, .24 * size, .45), [[sx * .25, Y0 + 1.0, 0]])), col);
}
function cape(k, col, { w = .5, top = .95, z = -.17 } = {}) {
  k.hull(jit([[-w * .4, Y0 + top, z + .02], [w * .4, Y0 + top, z + .02], [-w * .55, Y0 + .1, z - .1], [w * .55, Y0 + .1, z - .1],
    [-w * .4, Y0 + top, z - .04], [w * .4, Y0 + top, z - .04], [-w * .55, Y0 + .1, z - .17], [w * .55, Y0 + .1, z - .17], [0, Y0 + .5, z - .16]], .015), col);
}
// skeleton: chunky bones, ribcage barrel with dark gaps
function skeleton(k, P) {
  for (const sx of [-1, 1]) {
    k.hull(jit(rings(ring(sx * .1, Y0 + .46, 0, .09, .09), ring(sx * .11, Y0 + .1, .01, .08, .08))), P.skin);
    k.hull(jit(rings(ring(sx * .11, Y0 + .3, .02, .12, .12, .5), ring(sx * .11, Y0 + .25, .02, .12, .12, .5))), P.skin);
    k.hull(jit(rings(ring(sx * .11, Y0, .05, .13, .24, .3), ring(sx * .11, Y0 + .08, .03, .1, .16, .4))), P.skin);
  }
  k.hull(jit(rings(ring(0, Y0 + .44, 0, .3, .2), ring(0, Y0 + .54, 0, .24, .16))), P.skin);
  k.hull(jit(rings(ring(0, Y0 + .54, 0, .1, .1), ring(0, Y0 + .64, -.02, .1, .1))), P.skin);
  k.hull(jit(rings(ring(0, Y0 + .64, 0, .28, .2), ring(0, Y0 + .8, 0, .36, .24), ring(0, Y0 + .93, 0, .3, .2), ring(0, Y0 + .99, 0, .12, .12))), P.skin);
  for (const y of [.7, .77, .84]) k.hull(box(0, Y0 + y, .1, .24, .022, .06), DARK2, { sh: 0 });
  k.hull(box(0, Y0 + .92, 0, .5, .05, .1), P.skin);
}

// arms are built in shoulder space (origin = shoulder, hanging down -y): one chunky piece + big fist
function armKit(sleeve, hand, { bone = false } = {}) {
  const k = new Kit(5);
  const w = bone ? .09 : .15, c = bone ? hand : sleeve;
  k.hull(rings(ring(0, .04, 0, w, w, .4), ring(0, -.2, .01, w * .92, w * .92, .4)), c);
  k.hull(rings(ring(0, -.17, .01, w * .9, w * .9, .4), ring(0, -.33, .035, w * .82, w * .82, .4)), c);
  k.hull(rings(ring(0, -.31, .035, .13, .14, .35), ring(0, -.45, .045, .12, .13, .35)), hand);
  return k;
}
const HAND = new THREE.Vector3(0, -0.4, 0.045);

// weapons in hand space; blade / shaft along +z
function rod(k, z0, z1, r0, r1, col, n = 6) { k.hull(rings(ringZ(0, 0, z0, r0, n), ringZ(0, 0, z1, r1, n)), col); }
function swordKit(P, { len = .62, w = .11, metal = P.metal, guard = P.trim } = {}) {
  const k = new Kit(9);
  k.hull(box(0, 0, -.03, .065, .065, .2), P.leather);
  k.hull(box(0, 0, -.15, .09, .09, .07), guard);
  k.hull(box(0, 0, .08, .3, .07, .07), guard);
  k.hull([[-w / 2, 0, .11], [w / 2, 0, .11], [0, .026, .11], [0, -.026, .11], [-w * .45, 0, .11 + len], [w * .45, 0, .11 + len], [0, .022, .11 + len], [0, -.022, .11 + len], [0, 0, .25 + len]], metal, { sh: .1 });
  return k;
}
function spearKit(P, len = 1.55) {
  const k = new Kit(9);
  rod(k, -.45, len - .45, .035, .03, P.wood);
  k.hull([[-.07, 0, len - .5], [.07, 0, len - .5], [0, .03, len - .5], [0, -.03, len - .5], [0, 0, len - .2], [-.05, 0, len - .62], [.05, 0, len - .62]], P.metal, { sh: .1 });
  k.hull(box(0, 0, len - .52, .1, .06, .06), P.trim);
  return k;
}
function crossbowKit(P) {
  const k = new Kit(9);
  k.hull(box(0, -.01, .12, .09, .1, .64), P.wood);
  k.hull([[-.33, .02, .36], [.33, .02, .36], [0, .02, .46], [-.33, .07, .36], [.33, .07, .36], [0, .07, .46], [-.3, .02, .32], [.3, .07, .32]], P.metal);
  k.hull(box(0, .045, .3, .6, .014, .014), 0xeeeeee, { sh: 0 });
  return k;
}
function staffKit(P) {
  const k = new Kit(9);
  rod(k, -.5, 1.2, .04, .035, P.wood, 5);
  skull(k, P, 0, 0, 1.3, { s: 0.75 });
  k.hull([[.08, 0, 1.15], [.18, .02, 1.42], [.12, 0, 1.18]], P.wood);
  k.hull([[-.08, 0, 1.15], [-.18, .02, 1.42], [-.12, 0, 1.18]], P.wood);
  return k;
}
function lanceKit(P) {
  const k = new Kit(9);
  rod(k, -.25, 1.75, .055, .035, P.wood);
  k.hull([[0, 0, 2.05], ...ringZ(0, 0, 1.72, .07, 4)], P.metal, { sh: .1 });
  k.hull(rings(ringZ(0, 0, -.05, .04, 6), ringZ(0, 0, .12, .13, 6)), P.metal);
  k.hull(box(0, .14, 1.45, .02, .2, .32), P.cloth2);
  return k;
}
function scytheKit(P) {
  const k = new Kit(9);
  rod(k, -.4, 1.25, .035, .03, P.wood, 5);
  k.hull([[-.022, -.02, 1.24], [.022, -.02, 1.24], [-.022, -.05, 1.12], [.022, -.05, 1.12], [0, -.68, 1.08], [0, -.35, 1.26]], P.metal, { sh: .1 });
  return k;
}
function bowKit(P) {
  const k = new Kit(13);
  const g = new THREE.TorusGeometry(0.44, 0.035, 4, 8, Math.PI);
  g.rotateY(Math.PI / 2); g.rotateX(Math.PI);
  k.geo(g, P.wood, { y: 0.02, sh: .08 });
  k.box(0.012, 0.012, 0.88, 0xd8d0c0, { y: 0.02, sh: 0 });
  return k;
}
// shields are in hand space, facing forward when the off arm is raised about 0.6 rad
function roundShieldKit(P, face, rim, r = .27, emblem = null) {
  const k = new Kit(13);
  const o = { x: -.03, y: .1, z: .1, rx: .6 };
  const pts = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; pts.push([Math.cos(a) * r, Math.sin(a) * r, -.03], [Math.cos(a) * r * .92, Math.sin(a) * r * .92, .03]); }
  pts.push([0, 0, .07]);
  k.hull(pts, face, o);
  const rimPts = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; rimPts.push([Math.cos(a) * (r + .03), Math.sin(a) * (r + .03), -.05], [Math.cos(a) * (r + .03), Math.sin(a) * (r + .03), -.01]); }
  k.hull(rimPts, rim, o);
  k.hull(rings(ringZ(0, 0, .06, .07, 6), ringZ(0, 0, .11, .035, 6)), rim, o);
  if (emblem) { k.hull(box(0, 0, .055, .05, r * 1.4, .02), emblem, { ...o, sh: 0 }); k.hull(box(0, .03, .055, r * 1.1, .05, .02), emblem, { ...o, sh: 0 }); }
  return k;
}
function towerShieldKit(P) {
  const k = new Kit(13);
  const o = { x: -.03, y: .12, z: .12, rx: .6 };
  k.hull([[-.27, -.42, -.03], [.27, -.42, -.03], [-.27, .4, -.03], [.27, .4, -.03], [-.25, -.4, .05], [.25, -.4, .05], [-.25, .38, .05], [.25, .38, .05], [0, -.4, .08], [0, .38, .08]], P.cloth, o);
  k.hull(box(0, 0, .065, .07, .62, .03), P.trim, { ...o, sh: 0 });
  k.hull(box(0, .1, .065, .4, .07, .03), P.trim, { ...o, sh: 0 });
  k.hull([[-.29, -.44, -.06], [.29, -.44, -.06], [-.29, .42, -.06], [.29, .42, -.06], [-.29, -.44, -.02], [.29, -.44, -.02], [-.29, .42, -.02], [.29, .42, -.02]], P.metal, o);
  return k;
}

// ---------------------------------------------------------------- figures
const STYLE = {
  sword: 'slash', lord: 'cleave', skeleton: 'slash', graveguard: 'slash',
  shield: 'thrust', crossbow: 'shoot', archer: 'bow', rider: 'lance', wraith: 'scythe', necro: 'cast',
};

// animation mode: 'posable' (weapon arm swings) or 'statue' (one solid casting)
export let MINI_MODE = 'posable';
export function setMiniMode(m) { MINI_MODE = m === 'statue' ? 'statue' : 'posable'; }

const CACHE = new Map();
function sculpt(look, faction, mode) {
  const key = look + '|' + faction + '|' + mode;
  if (CACHE.has(key)) return CACHE.get(key);
  const P = PAINT[faction];
  let hseed = 7; for (const ch of key) hseed = (hseed * 31 + ch.charCodeAt(0)) % 100003;
  R = rng(hseed);
  const style = STYLE[look] || 'slash';
  const kb = new Kit(hseed, [Y0, Y0 + 0.95, 0.62]), kbase = new Kit(hseed + 1);
  let arm = null, weapon = null, off = null, glow = null;
  let shoulder = new THREE.Vector3(0.27, Y0 + 0.88, 0), offShoulder = new THREE.Vector3(-0.27, Y0 + 0.88, 0);
  const fig = new THREE.Vector3(0, Y0, 0);
  let scale = 1, h = 1.4, baseR = BASE_R;

  switch (look) {
    case 'sword': { // Men-at-arms
      baseKit(kbase, P);
      human(kb, P); tabard(kb, P.cloth2, { w: .14 });
      head(kb, P, 0, Y0 + 1.12, .01, { hair: P.hair }); helm(kb, P, 'kettle', 0, Y0 + 1.12, .01);
      pauldrons(kb, P.metal, .9);
      arm = armKit(P.metal, P.leather); weapon = swordKit(P);
      off = armKit(P.metal, P.leather); off.merge(roundShieldKit(P, P.cloth, P.trim, .27, P.cloth2), new THREE.Matrix4().makeTranslation(HAND.x, HAND.y, HAND.z));
      break;
    }
    case 'shield': { // Shieldwall
      baseKit(kbase, P);
      human(kb, P, { torsoCol: P.metal, armour: true }); tabard(kb, P.cloth, { w: .3, top: .82 });
      head(kb, P, 0, Y0 + 1.12, .01, { face: false }); helm(kb, P, 'great', 0, Y0 + 1.12, .01);
      pauldrons(kb, P.metal, 1.15);
      arm = armKit(P.metal, P.metal); weapon = spearKit(P, 1.6);
      off = armKit(P.metal, P.metal); off.merge(towerShieldKit(P), new THREE.Matrix4().makeTranslation(HAND.x, HAND.y, HAND.z));
      break;
    }
    case 'crossbow': {
      baseKit(kbase, P);
      human(kb, P, { torsoCol: P.cloth2 }); tabard(kb, P.cloth, { w: .1 });
      kb.hull(jit(rings(ring(0, Y0 + .86, 0, .44, .3), ring(0, Y0 + .96, 0, .3, .24))), P.cloth);
      head(kb, P, 0, Y0 + 1.12, .01, { hair: P.hair }); helm(kb, P, 'kettle', 0, Y0 + 1.12, .01);
      kb.hull(jit([[.04, Y0 + .9, -.16], [.12, Y0 + .92, -.16], [.04, Y0 + .9, -.26], [.12, Y0 + .92, -.26], [.16, Y0 + .52, -.16], [.24, Y0 + .54, -.16], [.16, Y0 + .52, -.26], [.24, Y0 + .54, -.26]]), P.leather);
      arm = armKit(P.cloth, P.skin); weapon = crossbowKit(P);
      off = armKit(P.cloth, P.skin);
      break;
    }
    case 'lord': {
      baseKit(kbase, P, .56); baseR = .56;
      scale = 1.12;
      human(kb, P, { torsoCol: P.metal, armour: true });
      tabard(kb, P.cloth, { w: .3, top: .7, bot: .22 });
      kb.hull(rings(ring(0, Y0 + .9, 0, .5, .32), ring(0, Y0 + .95, 0, .44, .28)), P.trim);
      head(kb, P, 0, Y0 + 1.12, .01, { face: false }); helm(kb, P, 'plume', 0, Y0 + 1.12, .01);
      pauldrons(kb, P.metal, 1.25);
      cape(kb, P.cloth, { w: .58 });
      arm = armKit(P.metal, P.metal); weapon = swordKit(P, { len: .95, w: .14 });
      off = armKit(P.metal, P.metal);
      h = 1.6;
      break;
    }
    case 'skeleton': {
      baseKit(kbase, P);
      skeleton(kb, P);
      kb.hull(jit([[-.18, Y0 + .5, .13], [.18, Y0 + .5, .13], [-.16, Y0 + .3, .12], [.16, Y0 + .3, .12], [-.18, Y0 + .5, -.1], [.18, Y0 + .5, -.1], [-.15, Y0 + .32, -.08], [.15, Y0 + .32, -.08]], .02), P.cloth);
      skull(kb, P, 0, Y0 + 1.12, .01);
      arm = armKit(null, P.skin, { bone: true }); weapon = swordKit(P, { metal: P.rust, guard: P.wood, len: .58 });
      off = armKit(null, P.skin, { bone: true }); off.merge(roundShieldKit(P, P.cloth2, P.rust, .23), new THREE.Matrix4().makeTranslation(HAND.x, HAND.y, HAND.z));
      break;
    }
    case 'graveguard': {
      baseKit(kbase, P);
      skeleton(kb, P);
      for (const sx of [-1, 1]) kb.hull(jit(rings(ring(sx * .11, Y0 + .4, .02, .15, .16), ring(sx * .11, Y0 + .14, .03, .14, .16))), P.metal);
      kb.hull(jit(rings(ring(0, Y0 + .46, 0, .38, .28), ring(0, Y0 + .62, 0, .38, .28), ring(0, Y0 + .84, 0, .5, .32), ring(0, Y0 + .96, -.01, .42, .26))), P.metal);
      kb.hull(jit([[-.17, Y0 + .48, .15], [.17, Y0 + .48, .15], [-.15, Y0 + .18, .14], [.15, Y0 + .18, .14], [-.17, Y0 + .48, .08], [.17, Y0 + .48, .08], [-.15, Y0 + .18, .08], [.15, Y0 + .18, .08]], .02), P.cloth);
      skull(kb, P, 0, Y0 + 1.12, .01, { eyes: P.glow }); helm(kb, P, 'horned', 0, Y0 + 1.12, .01);
      pauldrons(kb, P.metal, 1.2);
      arm = armKit(P.metal, P.metal); weapon = swordKit(P, { len: .82, w: .15, guard: P.metal });
      off = armKit(P.metal, P.metal); off.merge(roundShieldKit(P, P.cloth, P.metal, .29), new THREE.Matrix4().makeTranslation(HAND.x, HAND.y, HAND.z));
      break;
    }
    case 'archer': {
      baseKit(kbase, P);
      skeleton(kb, P);
      kb.hull(jit([[-.18, Y0 + .5, .13], [.18, Y0 + .5, .13], [-.16, Y0 + .3, .12], [.16, Y0 + .3, .12], [-.18, Y0 + .5, -.1], [.18, Y0 + .5, -.1], [-.15, Y0 + .32, -.08], [.15, Y0 + .32, -.08]], .02), P.cloth2);
      skull(kb, P, 0, Y0 + 1.12, .01); helm(kb, P, 'hood', 0, Y0 + 1.12, .01);
      kb.hull(jit(rings(ring(0, Y0 + .82, 0, .52, .32), ring(0, Y0 + .98, 0, .32, .24))), P.cloth);
      kb.hull(jit([[.02, Y0 + .94, -.15], [.1, Y0 + .96, -.15], [.02, Y0 + .94, -.25], [.1, Y0 + .96, -.25], [.16, Y0 + .54, -.15], [.24, Y0 + .56, -.15], [.16, Y0 + .54, -.25], [.24, Y0 + .56, -.25]]), P.leather);
      arm = armKit(null, P.skin, { bone: true });
      off = armKit(null, P.skin, { bone: true }); off.merge(bowKit(P), new THREE.Matrix4().makeTranslation(HAND.x, HAND.y, HAND.z));
      break;
    }
    case 'rider': { // Outriders
      baseKit(kbase, P, .46, 1.7); baseR = .46;
      fig.set(0, Y0, -0.38);
      const hy = Y0 + .66;
      kb.hull(jit(rings(ring(0, hy - .2, -.48, .34, .1), ring(0, hy + .2, -.46, .36, .1), ring(0, hy - .22, .4, .32, .1), ring(0, hy + .22, .42, .36, .1), [[0, hy + .26, 0], [0, hy - .26, 0], [-.21, hy, 0], [.21, hy, 0]]), .015), P.horse);
      kb.hull(jit(rings(ring(0, hy + .1, .4, .24, .3), ring(0, hy + .5, .58, .16, .22))), P.horse);
      kb.hull(jit([[-.08, hy + .58, .52], [.08, hy + .58, .52], [-.09, hy + .46, .6], [.09, hy + .46, .6], [-.06, hy + .36, .9], [.06, hy + .36, .9], [-.07, hy + .48, .88], [.07, hy + .48, .88]]), P.horse);
      kb.hull([[-.02, hy + .62, .45], [.02, hy + .62, .45], [-.03, hy + .22, .36], [.03, hy + .22, .36], [0, hy + .5, .34]], P.mane);
      for (const sx of [-1, 1]) kb.hull([[sx * .05, hy + .6, .55], [sx * .07, hy + .74, .52], [sx * .06, hy + .6, .5]], P.horse);
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        kb.hull(jit(rings(ring(sx * .12, hy - .02, sz * .32, .13, .16), ring(sx * .13, Y0 + .1, sz * .32 + .02, .09, .1))), P.horse);
        kb.hull(box(sx * .13, Y0 + .04, sz * .32 + .03, .11, .08, .13), DARK2);
      }
      kb.hull([[-.04, hy + .14, -.5], [.04, hy + .14, -.5], [-.07, hy - .4, -.62], [.07, hy - .4, -.62], [0, hy - .1, -.62]], P.mane);
      kb.hull(jit(rings(ring(0, hy - .06, 0, .46, .58), ring(0, hy + .22, 0, .44, .52))), P.cloth);
      kb.hull(rings(ring(0, hy - .1, 0, .48, .6), ring(0, hy - .05, 0, .48, .6)), P.trim);
      for (const sx of [-1, 1]) kb.hull(jit(rings(ring(sx * .2, Y0 + .9, .02, .14, .2), ring(sx * .24, Y0 + .6, .1, .12, .14))), P.cloth2);
      kb.hull(jit(rings(ring(0, Y0 + .95, 0, .32, .24), ring(0, Y0 + 1.2, 0, .42, .28), ring(0, Y0 + 1.32, 0, .34, .22), ring(0, Y0 + 1.38, 0, .14, .14))), P.cloth);
      head(kb, P, 0, Y0 + 1.52, .01, { hair: P.hair }); helm(kb, P, 'kettle', 0, Y0 + 1.52, .01);
      shoulder = new THREE.Vector3(.25, Y0 + 1.28, 0); offShoulder = new THREE.Vector3(-.25, Y0 + 1.28, 0);
      arm = armKit(P.cloth, P.leather); weapon = lanceKit(P);
      off = armKit(P.cloth, P.leather); off.merge(roundShieldKit(P, P.cloth2, P.trim, .22, P.cloth), new THREE.Matrix4().makeTranslation(HAND.x, HAND.y, HAND.z));
      h = 1.85;
      break;
    }
    case 'wraith': {
      baseKit(kbase, P, .48); baseR = .48;
      fig.set(0, Y0 + .2, 0);
      kb.hull(jit(rings(ring(0, Y0 + .18, 0, .62, .6, .45), ring(0, Y0 + .7, 0, .5, .44, .45), ring(0, Y0 + 1.12, 0, .44, .32, .4)), .025), P.cloth);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; kb.hull([[Math.sin(a) * .3, Y0 + .3, Math.cos(a) * .28], [Math.sin(a + .35) * .26, Y0 + .3, Math.cos(a + .35) * .24], [Math.sin(a + .17) * .32, Y0 - .02 - (i % 2) * .06, Math.cos(a + .17) * .3], [Math.sin(a + .17) * .24, Y0 + .32, Math.cos(a + .17) * .2]], P.cloth2); }
      kb.hull(jit(rings(ring(0, Y0 + .98, 0, .58, .36), ring(0, Y0 + 1.16, 0, .36, .26))), P.cloth2);
      kb.hull(box(0, Y0 + 1.33, .06, .22, .26, .12), DARK2, { sh: 0 });
      helm(kb, P, 'hood', 0, Y0 + 1.36, .02, 1.1);
      for (const sx of [-1, 1]) kb.hull(box(sx * .055, Y0 + 1.37, .125, .055, .03, .02), P.glow, { sh: 0 });
      shoulder = new THREE.Vector3(.27, Y0 + 1.1, 0); offShoulder = new THREE.Vector3(-.27, Y0 + 1.1, 0);
      arm = armKit(P.cloth2, P.skin); weapon = scytheKit(P);
      off = armKit(P.cloth2, P.skin);
      h = 1.85;
      break;
    }
    case 'necro': {
      baseKit(kbase, P, .56); baseR = .56;
      scale = 1.1;
      kb.hull(jit(rings(ring(0, Y0 + .0, 0, .72, .66, .45), ring(0, Y0 + .45, 0, .5, .44, .45), ring(0, Y0 + .82, 0, .46, .32, .4), ring(0, Y0 + 1.0, 0, .3, .24, .4)), .02), P.cloth);
      kb.hull(rings(ring(0, Y0 + .56, 0, .5, .42), ring(0, Y0 + .63, 0, .48, .4)), P.trim);
      kb.hull(jit(rings(ring(0, Y0 + .84, 0, .58, .36), ring(0, Y0 + 1.02, 0, .36, .26))), P.cloth2);
      cape(kb, P.cloth2, { w: .62, top: 1.0, z: -.18 });
      skull(kb, P, 0, Y0 + 1.2, .02, { eyes: P.glow }); helm(kb, P, 'hood', 0, Y0 + 1.2, .02, 1.05);
      shoulder = new THREE.Vector3(.28, Y0 + 1.0, 0); offShoulder = new THREE.Vector3(-.28, Y0 + 1.0, 0);
      arm = armKit(P.cloth, P.skin); weapon = staffKit(P);
      off = armKit(P.cloth, P.skin);
      glow = true;
      h = 1.95;
      break;
    }
    default:
      baseKit(kbase, P); human(kb, P); head(kb, P, 0, Y0 + 1.12, .01);
      arm = armKit(P.cloth, P.skin); off = armKit(P.cloth, P.skin);
  }

  // statue mode: bake both arms (and the weapon) into the body in their rest pose
  const rest = POSES[style].rest;
  const armM = q => new THREE.Matrix4().makeTranslation(shoulder.x, shoulder.y, shoulder.z).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(q.a || 0, q.y || 0, q.r || 0, 'YXZ')));
  const offM = q => new THREE.Matrix4().makeTranslation(offShoulder.x, offShoulder.y, offShoulder.z).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(q.oa || 0, 0, q.or || 0, 'YXZ')));
  if (mode === 'statue') {
    const sq = STATUE_POSE[style] || rest;
    kb.merge(arm, armM(sq));
    if (weapon) kb.merge(weapon, armM(sq).multiply(new THREE.Matrix4().makeTranslation(HAND.x, HAND.y, HAND.z)).multiply(new THREE.Matrix4().makeRotationX(sq.p || 0)));
    kb.merge(off, offM(sq));
    arm = weapon = off = null;
  }
  const out = {
    style, fig, scale, h, baseR, shoulder, offShoulder, glow,
    base: kbase.build(), body: kb.build(fig),
    arm: arm ? arm.build() : null, weapon: weapon ? weapon.build() : null, off: off ? off.build() : null,
  };
  CACHE.set(key, out);
  return out;
}

// statue mode poses: a dynamic "cast" pose per style (weapon raised, ready)
const STATUE_POSE = {
  slash: { a: -1.2, p: -0.6, r: 0.25, oa: -0.7, or: -0.15 },
  cleave: { a: -1.0, p: -0.9, r: 0.15, oa: -0.5, or: -0.25 },
  thrust: { a: -0.6, p: 0.6, r: 0.08, oa: -0.62, or: -0.08 },
  shoot: { a: -1.2, p: 1.2, r: 0.15, oa: -1.15, or: -0.45 },
  bow: { a: -1.35, p: 0, r: 0.35, y: 0.5, oa: -1.5, or: 0.05 },
  lance: { a: -0.5, p: 0.5, r: 0.05, oa: -0.6, or: -0.2 },
  scythe: { a: -1.0, p: 0.2, r: 0.1, oa: -0.7, or: -0.15 },
  cast: { a: -1.8, p: 0.25, r: 0.15, oa: -0.6, or: -0.3 },
};

export function makeMini(look, faction, seed = 1, mode = MINI_MODE) {
  const S = sculpt(look, faction, mode);
  const P = PAINT[faction];
  const mat = paintMat();
  const mk = g => { const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const root = new THREE.Group();
  const baseMesh = mk(S.base); baseMesh.castShadow = false;
  root.add(baseMesh);
  const shadow = new THREE.Mesh(SHADOW_GEO, shadowMat());
  shadow.scale.set(S.baseR * 1.55, 1, S.baseR * (look === 'rider' ? 2.5 : 1.55));
  shadow.position.y = 0.075; shadow.renderOrder = 1;
  root.add(shadow);
  const figG = new THREE.Group(); figG.position.copy(S.fig); figG.scale.setScalar(S.scale * (1 + ((seed * 37) % 7 - 3) * 0.008));
  root.add(figG);
  figG.add(mk(S.body));
  let armG = null, weapG = null, offG = null, glow = null;
  if (S.arm) {
    armG = new THREE.Group(); armG.rotation.order = 'YXZ';
    armG.position.copy(S.shoulder).sub(S.fig); figG.add(armG);
    armG.add(mk(S.arm));
    if (S.weapon) { weapG = new THREE.Group(); weapG.position.copy(HAND); armG.add(weapG); weapG.add(mk(S.weapon)); }
    offG = new THREE.Group(); offG.rotation.order = 'YXZ';
    offG.position.copy(S.offShoulder).sub(S.fig); figG.add(offG);
    offG.add(mk(S.off));
  }
  if (S.glow) {
    glow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: P.glow, transparent: true, opacity: 0.9 }));
    if (weapG) { glow.position.set(0, 0, 1.45); weapG.add(glow); }
    else {
      // statue: place the glow at the staff head in the baked pose
      const q = STATUE_POSE.cast;
      const m = new THREE.Matrix4().makeTranslation(S.shoulder.x, S.shoulder.y, S.shoulder.z).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(q.a, 0, q.r, 'YXZ'))).multiply(new THREE.Matrix4().makeTranslation(HAND.x, HAND.y, HAND.z)).multiply(new THREE.Matrix4().makeRotationX(q.p));
      glow.position.set(0, 0, 1.45).applyMatrix4(m).sub(S.fig);
      figG.add(glow);
    }
  }
  root.userData = { height: S.h * S.scale, mat, shadow, rig: { style: S.style, fig: figG, figBase: S.fig.clone(), arm: armG, weapon: weapG, off: offG, glow, look, statue: !S.arm } };
  poseMini(root, POSES[S.style].rest, 0, 0);
  return root;
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
  if (R.arm) {
    R.arm.rotation.set(q.a || 0, q.y || 0, q.r || 0);
    if (R.weapon) R.weapon.rotation.x = q.p || 0;
    R.arm.position.z = (R.arm.userData.z0 ?? (R.arm.userData.z0 = R.arm.position.z)) - (q.draw || 0) * 0.2;
    R.off.rotation.set(q.oa || 0, 0, q.or || 0);
    R.fig.position.set(R.figBase.x, R.figBase.y + hop, R.figBase.z + (q.step || 0));
    R.fig.rotation.set((q.lean || 0) + (q.rear || 0), q.twist || 0, 0);
  } else {
    // solid statue: the whole mini leans, twists and lunges, with a hop as it strikes
    const st = q.step || 0;
    R.fig.position.set(R.figBase.x, R.figBase.y + hop + Math.max(0, st) * 0.3, R.figBase.z + st * 1.35);
    R.fig.rotation.set(Math.max(-0.25, Math.min(0.3, (q.lean || 0) * 1.2)) + (q.rear || 0), (q.twist || 0) * 1.3, 0);
  }
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
