// The games table and the room around the board, in a chunky low-poly cartoon style:
// a compact table of thick honey-coloured planks with broken ends, square legs with iron
// bands and stretchers, a red runner, dice, a ruler, tankards and other gamer clutter,
// in a dim, warm purple room.  The board top is y = 0, the table top is y = -1.
import * as THREE from 'three';
import { RULES } from '../data/units.js';
import { rng } from '../sim/rng.js';
import { Kit, paintMat } from './kit.js';
import { makeMini } from './minis.js';

const TOP = -1;                 // table top surface
const FLOOR = -22;              // floor level
const W = RULES.board.w, H = RULES.board.h;
const TX0 = -7.5, TX1 = W + 7.5, TZ0 = -7.5, TZ1 = H + 7.5;   // table top extents (board + ~7" a side)

let R = Math.random;
const box = (cx, cy, cz, w, h, d) => {
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push([cx + sx * w / 2, cy + sy * h / 2, cz + sz * d / 2]);
  return out;
};
const lerpHex = (a, b, t) => {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const c = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(c);
};

// ---------------------------------------------------------------- the table
const HONEY = [0xd9b06a, 0xcfa35c, 0xe2bd78, 0xd4a862, 0xdcb470];
const LEG = 0xc29152, LEG_DARK = 0xa87a42, IRON = 0x8d909c;

// one thick plank: angled, broken-looking ends, a slight warp along its length
function plank(k, z0, z1, col) {
  const pts = [];
  const th = 1.05, cham = 0.35;
  // ends: angled cut plus a protruding "splinter" point
  const e0a = TX0 - 0.6 + R() * 1.4, e0b = TX0 - 0.6 + R() * 1.4, e1a = TX1 - 0.8 + R() * 1.4, e1b = TX1 - 0.8 + R() * 1.4;
  const xs = [[e0a, e0b], [W * 0.3, W * 0.3], [W * 0.7, W * 0.7], [e1a, e1b]];
  const lift = [0, 0.06 + R() * 0.08, 0.04 + R() * 0.08, 0].map((v, i) => v + (i === 0 || i === 3 ? (R() - 0.5) * 0.12 : 0));
  xs.forEach(([xa, xb], i) => {
    const y1 = TOP + lift[i];
    pts.push([xa, TOP - th, z0], [xb, TOP - th, z1]);
    pts.push([xa, y1 - cham, z0], [xb, y1 - cham, z1]);
    pts.push([xa + (i === 0 ? cham : i === 3 ? -cham : 0), y1, z0 + cham], [xb + (i === 0 ? cham : i === 3 ? -cham : 0), y1, z1 - cham]);
  });
  // splinters at each end
  pts.push([Math.min(e0a, e0b) - 0.7 - R() * 0.6, TOP - 0.45, (z0 + z1) / 2 + (R() - 0.5) * 2]);
  pts.push([Math.max(e1a, e1b) + 0.7 + R() * 0.6, TOP - 0.5, (z0 + z1) / 2 + (R() - 0.5) * 2]);
  k.hull(pts, col, { sh: 0.06 });
  // one or two subtle painted grain bands
  for (let g = 0; g < 1 + (R() < 0.6 ? 1 : 0); g++) {
    const gz = z0 + 1.2 + R() * (z1 - z0 - 2.4), x0 = TX0 + 4 + R() * 12, x1 = Math.min(TX1 - 4, x0 + 18 + R() * 22), w = 0.35 + R() * 0.4;
    const shade = lerpHex(col, R() < 0.5 ? 0xb9874a : 0xf0d090, 0.5);
    k.hull([[x0, TOP + 0.04, gz], [x1, TOP + 0.04, gz + (R() - 0.5)], [x0 + 2, TOP + 0.06, gz + w], [x1 - 2, TOP + 0.06, gz + w + (R() - 0.5) * 0.5], [x0 + 3, TOP + 0.04, gz + w * 1.6], [x1 - 3, TOP + 0.04, gz + w * 1.4]], shade, { sh: 0.03 });
  }
}
function table(k) {
  // dark underside visible through the gaps between planks
  k.box(TX1 - TX0 - 2, 0.9, TZ1 - TZ0 - 2, 0x3a2414, { x: (TX0 + TX1) / 2, y: TOP - 0.7, z: (TZ0 + TZ1) / 2, sh: 0 });
  const n = 5, gap = 0.28;
  for (let i = 0; i < n; i++) {
    const z0 = TZ0 + i * (TZ1 - TZ0) / n + gap / 2, z1 = TZ0 + (i + 1) * (TZ1 - TZ0) / n - gap / 2;
    plank(k, z0 + (R() - 0.5) * 0.3, z1 + (R() - 0.5) * 0.3, HONEY[i % HONEY.length]);
  }
  // apron: one chunky band per side under the top
  const ax0 = TX0 + 3, ax1 = TX1 - 3, az0 = TZ0 + 3, az1 = TZ1 - 3, ay0 = TOP - 1.0, ay1 = TOP - 3.4;
  k.hull(box((ax0 + ax1) / 2, (ay0 + ay1) / 2, az0, ax1 - ax0, ay0 - ay1, 1.4), LEG);
  k.hull(box((ax0 + ax1) / 2, (ay0 + ay1) / 2, az1, ax1 - ax0, ay0 - ay1, 1.4), LEG);
  k.hull(box(ax0, (ay0 + ay1) / 2, (az0 + az1) / 2, 1.4, ay0 - ay1, az1 - az0), LEG);
  k.hull(box(ax1, (ay0 + ay1) / 2, (az0 + az1) / 2, 1.4, ay0 - ay1, az1 - az0), LEG);
  // thick square legs, a little splayed, with an iron band and a tapered foot block
  const legs = [[ax0, az0, -1, -1], [ax1, az0, 1, -1], [ax0, az1, -1, 1], [ax1, az1, 1, 1]];
  for (const [x, z, sx, sz] of legs) {
    const sp = 0.9, fx = x + sx * sp, fz = z + sz * sp, s = 3.0;
    const at = (t) => [x + (fx - x) * t, z + (fz - z) * t];
    const yTop = TOP - 1.0, yBand = FLOOR + 6.5, yFoot = FLOOR + 3.4;
    const [bx, bz] = at((yTop - yBand) / (yTop - FLOOR)), [fx2, fz2] = at((yTop - yFoot) / (yTop - FLOOR)), [gx, gz] = at(1);
    k.hull([...box(x, yTop - 0.01, z, s, 0.02, s), ...box(bx, yBand + 1.6, bz, s * 0.9, 0.02, s * 0.9)], LEG, { sh: 0.07 });
    k.hull([...box(bx, yBand + 1.65, bz, s * 1.08, 0.02, s * 1.08), ...box(bx, yBand, bz, s * 1.08, 0.02, s * 1.08)], IRON, { sh: 0.08 });
    k.hull([...box(bx, yBand, bz, s * 0.9, 0.02, s * 0.9), ...box(fx2, yFoot, fz2, s * 0.82, 0.02, s * 0.82)], LEG, { sh: 0.07 });
    k.hull([...box(fx2, yFoot, fz2, s * 0.95, 0.02, s * 0.95), ...box(gx, FLOOR, gz, s * 0.72, 0.02, s * 0.72)], LEG_DARK, { sh: 0.07 });
  }
  // stretchers: side rails between the legs and a long middle rail
  const ry = FLOOR + 9.5;
  for (const x of [ax0 - 0.5, ax1 + 0.5]) k.hull(box(x, ry, (az0 + az1) / 2, 1.1, 1.1, az1 - az0), LEG_DARK);
  k.hull(box((ax0 + ax1) / 2, ry + 0.2, (az0 + az1) / 2, ax1 - ax0, 1.1, 1.1), LEG_DARK);
  // red runner with a gold border across the table, hanging over both long edges
  const rx = W / 2, rw = 7;
  k.hull(box(rx, TOP + 0.13, (TZ0 + TZ1) / 2, rw + 0.8, 0.06, TZ1 - TZ0 + 0.6), 0xe8a040, { sh: 0.02 });
  k.hull(box(rx, TOP + 0.17, (TZ0 + TZ1) / 2, rw, 0.06, TZ1 - TZ0 + 0.2), 0xc0242c, { sh: 0.02 });
  for (const [ez, dir] of [[TZ0 - 0.3, -1], [TZ1 + 0.3, 1]]) {
    const drop = 6.5, tip = 3.2;
    const hang = (w, col, out, top) => k.hull([[rx - w / 2, top, ez + dir * out], [rx + w / 2, top, ez + dir * out], [rx - w / 2, TOP - drop, ez + dir * out], [rx + w / 2, TOP - drop, ez + dir * out], [rx, TOP - drop - tip, ez + dir * out],
      [rx - w / 2, top, ez + dir * (out + 0.06)], [rx + w / 2, top, ez + dir * (out + 0.06)], [rx - w / 2, TOP - drop, ez + dir * (out + 0.06)], [rx + w / 2, TOP - drop, ez + dir * (out + 0.06)], [rx, TOP - drop - tip, ez + dir * (out + 0.06)]], col, { sh: 0.02 });
    hang(rw + 0.8, 0xe8a040, 0.0, TOP + 0.16);
    hang(rw, 0xc0242c, 0.07, TOP + 0.2);
  }
}

// ---------------------------------------------------------------- props on the table
function die(k, x, z, size, col, pip, rot, lift = 0) {
  const d = new Kit(1);
  const s = size / 2;
  d.hull([...box(0, 0, 0, size, size * 0.82, size * 0.82), ...box(0, 0, 0, size * 0.82, size, size * 0.82), ...box(0, 0, 0, size * 0.82, size * 0.82, size)], col, { sh: 0.08 });
  const P = [[], [[0, 0]], [[-.5, -.5], [.5, .5]], [[-.5, -.5], [0, 0], [.5, .5]], [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]], [[-.5, -.5], [.5, -.5], [0, 0], [-.5, .5], [.5, .5]], [[-.5, -.6], [.5, -.6], [-.5, 0], [.5, 0], [-.5, .6], [.5, .6]]];
  const faces = [[1, [0, 1, 0]], [6, [0, -1, 0]], [2, [1, 0, 0]], [5, [-1, 0, 0]], [3, [0, 0, 1]], [4, [0, 0, -1]]];
  const ps = size * 0.15, off = size * 0.34;
  for (const [n, nrm] of faces) for (const [u, v] of P[n]) {
    let cx, cy, cz;
    if (nrm[1]) { cx = u * off; cy = nrm[1] * (s + 0.002); cz = v * off; }
    else if (nrm[0]) { cx = nrm[0] * (s + 0.002); cy = u * off; cz = v * off; }
    else { cx = u * off; cy = v * off; cz = nrm[2] * (s + 0.002); }
    d.hull(box(cx, cy, cz, nrm[0] ? 0.02 : ps, nrm[1] ? 0.02 : ps, nrm[2] ? 0.02 : ps), pip, { sh: 0 });
  }
  k.merge(d, new THREE.Matrix4().compose(new THREE.Vector3(x, TOP + s + lift, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])), new THREE.Vector3(1, 1, 1)));
}
function d20(k, x, z, r, col) { k.add(new THREE.IcosahedronGeometry(r, 0), col, { x, y: TOP + r * 0.8, z, rx: R() * 3, ry: R() * 3, sh: 0.12 }); }
function ruler(k, x, z, len, rotY) {
  const r = new Kit(2);
  r.hull(box(0, 0.08, 0, len, 0.16, 1.4), 0xf0c84a, { sh: 0.04 });
  for (let i = 0; i <= len; i++) {
    const L = i % 6 === 0 ? 0.6 : i % 3 === 0 ? 0.42 : 0.25;
    r.hull(box(-len / 2 + i, 0.165, -0.7 + L / 2, 0.07, 0.01, L), 0x2a2018, { sh: 0 });
  }
  r.hull(box(0, 0.165, 0.3, 3, 0.01, 0.34), 0xc0242c, { sh: 0 });
  k.merge(r, new THREE.Matrix4().compose(new THREE.Vector3(x, TOP, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3(1, 1, 1)));
}
function cylHull(k, x, y0, z, r0, r1, h, col, n = 8, o = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push([x + Math.cos(a) * r0, y0, z + Math.sin(a) * r0], [x + Math.cos(a) * r1, y0 + h, z + Math.sin(a) * r1]); }
  k.hull(pts, col, { sh: 0.07, ...o });
}
// wooden tankard: staves, an iron band, a handle and a foamy top
function tankard(k, x, z, s = 1, rot = 0) {
  const r = 1.25 * s, h = 3.2 * s;
  cylHull(k, x, TOP, z, r * 1.05, r * 0.95, h, 0xb8874c, 8);
  cylHull(k, x, TOP + h * 0.42, z, r * 1.12, r * 1.08, h * 0.2, IRON, 8);
  cylHull(k, x, TOP + h - 0.05, z, r * 0.92, r * 0.98, 0.3 * s, 0xf5ecd2, 8, { sh: 0.12 });
  for (let i = 0; i < 4; i++) { const a = i * 1.6 + rot; k.add(new THREE.IcosahedronGeometry(0.42 * s, 0), 0xfaf3df, { x: x + Math.cos(a) * r * 0.45, y: TOP + h + 0.18 * s, z: z + Math.sin(a) * r * 0.45, sy: 0.6, sh: 0.1 }); }
  const hx = Math.cos(rot), hz = Math.sin(rot);
  k.hull([...box(x + hx * r * 1.05, TOP + h * 0.8, z + hz * r * 1.05, 0.5, 0.45, 0.5), ...box(x + hx * r * 1.75, TOP + h * 0.72, z + hz * r * 1.75, 0.45, 0.45, 0.45)], 0xa87a42);
  k.hull([...box(x + hx * r * 1.75, TOP + h * 0.72, z + hz * r * 1.75, 0.45, 0.45, 0.45), ...box(x + hx * r * 1.6, TOP + h * 0.25, z + hz * r * 1.6, 0.45, 0.45, 0.45)], 0xa87a42);
  k.hull([...box(x + hx * r * 1.6, TOP + h * 0.25, z + hz * r * 1.6, 0.45, 0.45, 0.45), ...box(x + hx * r * 1.0, TOP + h * 0.2, z + hz * r * 1.0, 0.5, 0.45, 0.5)], 0xa87a42);
}
function props(k, extras) {
  // near edge: ruler, dice tray, loose dice
  ruler(k, 13, H + 3.2, 20, -0.03);
  const tx = 37, tz = H + 3.9;
  k.hull(box(tx, TOP + 0.4, tz, 8, 0.8, 4.6), 0x6b3f22);
  k.hull(box(tx, TOP + 0.72, tz, 7.2, 0.1, 3.8), 0x2f6b4a);
  die(k, tx - 2, tz - 0.4, 1.3, 0xc8302c, 0xf4efe4, [0, 0.4, 0], 0.77);
  die(k, tx + 0.3, tz + 0.7, 1.3, 0xf2ebdc, 0x1c1a20, [0, -0.3, 0], 0.77);
  die(k, tx + 2.3, tz - 0.5, 1.3, 0x2f5fb6, 0xf4efe4, [0, 1.1, 0], 0.77);
  die(k, 28, H + 5.5, 1.3, 0x5e3a88, 0xe6dcc3, [0, 0.7, 0]);
  die(k, -3.5, H + 4, 1.3, 0xc8302c, 0xf4efe4, [0, 2.1, 0]);
  // left margin: rulebook, d20, tape measure, a spare lord
  k.hull(box(-3.8, TOP + 0.6, 5, 5.2, 1.2, 7.2), 0x7a1f26);
  k.hull(box(-3.7, TOP + 0.6, 5, 5.1, 0.9, 6.9), 0xf2ead6);
  k.hull(box(-3.8, TOP + 1.22, 5, 2.2, 0.03, 2.2), 0xe0b84f, { sh: 0 });
  k.hull(box(-3.8, TOP + 1.24, 5, 0.9, 0.03, 0.9), 0x7a1f26, { sh: 0 });
  d20(k, -3.6, 13.5, 1.1, 0x6fb4e6);
  cylHull(k, -3.8, TOP, 21, 1.5, 1.5, 1.2, 0xe0b84f, 8);
  cylHull(k, -3.8, TOP + 1.18, 21, 0.7, 0.55, 0.1, 0x2a2018, 8);
  k.hull(box(-3.8, TOP + 0.03, 24.4, 0.85, 0.05, 5.2), 0xf2d27a, { sh: 0 });
  // right margin: carry case with spare minis, tankards, paint pots
  const cx = W + 3.9, cz = 9;
  k.hull(box(cx, TOP + 0.8, cz, 5.4, 1.6, 9.6), 0x2a2a30);
  k.hull(box(cx, TOP + 1.62, cz, 5.0, 0.06, 9.2), 0x5d5f66, { sh: 0.03 });
  for (let i = 0; i < 4; i++) k.hull(box(cx - 1.2 + (i % 2) * 2.4, TOP + 1.66, cz - 2.2 + Math.floor(i / 2) * 4.4, 1.9, 0.02, 1.9), 0x1c1c20, { sh: 0 });
  extras.push(['sword', 'kingdom', cx - 1.2, cz - 2.2], ['crossbow', 'kingdom', cx + 1.2, cz - 2.2], ['skeleton', 'undead', cx - 1.2, cz + 2.2], ['archer', 'undead', cx + 1.2, cz + 2.2]);
  extras.top = TOP + 1.67;
  tankard(k, W + 3.4, 21, 1, 0.3);
  tankard(k, W + 4.6, 26.5, 0.95, 2.4);
  for (const [x, z, lid] of [[W + 2.6, 32, 0x2f5fb6], [W + 4.6, 33.5, 0x5e3a88]]) { cylHull(k, x, TOP, z, 0.9, 0.85, 1.6, 0x2a2a2e, 8); cylHull(k, x, TOP + 1.6, z, 0.95, 0.95, 0.45, lid, 8); }
  // far edge: a few cards, dice and a wraith
  for (let i = 0; i < 5; i++) k.add(new THREE.BoxGeometry(3.6, 0.1, 5), i === 4 ? 0xc0242c : 0xf2ead6, { x: 12 + (R() - 0.5) * 0.3, y: TOP + 0.05 + i * 0.1, z: -3.8 + (R() - 0.5) * 0.3, ry: 1.57 + (R() - 0.5) * 0.15, sh: 0.03 });
  die(k, 33, -3.2, 1.3, 0x2f5fb6, 0xf4efe4, [0, 0.6, 0]);
  die(k, 35.5, -4.6, 1.3, 0xf2ebdc, 0x1c1a20, [0, 1.9, 0]);
  d20(k, 30.5, -4.8, 1.1, 0xe0b84f);
  extras.loose = [['lord', 'kingdom', -3.8, 28.5], ['wraith', 'undead', 42, -3.6]];
}

// ---------------------------------------------------------------- the room
function room(k) {
  // wide chunky floorboards
  for (let i = 0; i < 22; i++) {
    const z0 = -110 + i * 12;
    const col = [0x5a3428, 0x63392c, 0x4f2e24, 0x6a3f30][i % 4];
    let x = -120;
    while (x < 170) { const L = 50 + R() * 50, w = Math.min(L, 170 - x); k.box(w - 0.6, 1.2, 11.4, col, { x: x + w / 2, y: FLOOR - 0.6, z: z0 + 6, sh: 0.05 }); x += L; }
  }
  // round-cornered rug under the table
  const rug = (rx, rz, y, col) => { const p = []; for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; p.push([W / 2 + Math.cos(a) * rx, y, H / 2 + Math.sin(a) * rz], [W / 2 + Math.cos(a) * rx, y + 0.3, H / 2 + Math.sin(a) * rz]); } k.hull(p, col, { sh: 0.03 }); };
  rug(58, 42, FLOOR, 0x6b2a3a);
  rug(50, 35, FLOOR + 0.04, 0x8a3a46);
  // walls (warm plum), skirting, a window and a picture
  const WZ = -70, WX = -75;
  k.box(260, 110, 2, 0x5a3442, { x: 40, y: FLOOR + 55, z: WZ, sh: 0.02 });
  k.box(2, 110, 220, 0x52303d, { x: WX, y: FLOOR + 55, z: 30, sh: 0.02 });
  k.box(260, 5, 1.8, 0x3a2016, { x: 40, y: FLOOR + 2.5, z: WZ + 1.6 });
  k.box(1.8, 5, 220, 0x3a2016, { x: WX + 1.6, y: FLOOR + 2.5, z: 30 });
  const wx = 60, wy = FLOOR + 60;
  k.box(46, 3, 3, 0xe9d6b8, { x: wx, y: wy + 21, z: WZ + 1.5 }); k.box(50, 3, 6, 0xe9d6b8, { x: wx, y: wy - 21, z: WZ + 3 });
  k.box(3, 42, 3, 0xe9d6b8, { x: wx - 22, y: wy, z: WZ + 1.5 }); k.box(3, 42, 3, 0xe9d6b8, { x: wx + 22, y: wy, z: WZ + 1.5 });
  k.box(2, 42, 2, 0xe9d6b8, { x: wx, y: wy, z: WZ + 1.5 }); k.box(42, 2, 2, 0xe9d6b8, { x: wx, y: wy, z: WZ + 1.5 });
  k.box(26, 20, 1.5, 0x3a2016, { x: WX + 1.5, y: FLOOR + 62, z: 55, ry: Math.PI / 2 });
  k.box(22, 16, 1.6, 0x6f9150, { x: WX + 1.7, y: FLOOR + 62, z: 55, ry: Math.PI / 2, sh: 0.1 });
  // bookshelf with books and boxed armies
  const bx = -30, bz = WZ + 8;
  k.box(46, 78, 12, 0x4a2a1a, { x: bx, y: FLOOR + 39, z: bz });
  for (let s = 0; s < 3; s++) {
    const sy = FLOOR + 6 + s * 24;
    k.box(42, 1.5, 10, 0x5c3a21, { x: bx, y: sy, z: bz + 1 });
    let x = bx - 19;
    while (x < bx + 17) {
      const big = R() < 0.25, w = big ? 8 + R() * 3 : 2.2 + R() * 2, h = big ? 11 + R() * 4 : 12 + R() * 6;
      if (x + w > bx + 19) break;
      const col = big ? [0x2f5fb6, 0x5e3a88, 0xb2312a, 0x2e6b4a][Math.floor(R() * 4)] : [0x7a1f26, 0x2a3f6b, 0x3b5a35, 0x8a6a2a, 0x3a2b4a, 0xd8cfb8][Math.floor(R() * 6)];
      k.box(w - 0.3, h, big ? 9 : 8, col, { x: x + w / 2, y: sy + 0.75 + h / 2, z: bz + 1.5, sh: 0.06 });
      x += w;
    }
  }
  // a stool by the table
  const sx = W + 22, sz = H / 2 + 2;
  cylHull(k, sx, FLOOR + 13, sz, 7, 7, 2.2, 0xc29152, 8);
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; k.hull([...box(sx + Math.cos(a) * 3.5, FLOOR + 13, sz + Math.sin(a) * 3.5, 1.6, 0.02, 1.6), ...box(sx + Math.cos(a) * 5.5, FLOOR, sz + Math.sin(a) * 5.5, 1.4, 0.02, 1.4)], LEG_DARK); }
}

export function buildRoom(view) {
  const L = view.layers.table;
  R = rng(41);
  const kt = new Kit(31);
  table(kt);
  const tableMesh = kt.mesh(paintMat('terrain')); L.add(tableMesh);
  const kp = new Kit(33);
  const extras = [];
  props(kp, extras);
  L.add(kp.mesh(paintMat('terrain')));
  for (const [look, fac, x, z] of extras) { const m = makeMini(look, fac, 7); m.position.set(x, extras.top, z); m.rotation.y = R() * 6; L.add(m); }
  for (const [look, fac, x, z] of extras.loose) { const m = makeMini(look, fac, 9); m.position.set(x, TOP, z); m.rotation.y = R() * 6; L.add(m); }
  const kr = new Kit(35);
  room(kr);
  const roomMesh = kr.mesh(paintMat('board')); roomMesh.castShadow = false;
  L.add(roomMesh);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(42, 40), new THREE.MeshBasicMaterial({ color: 0x9cb8e0 }));
  glass.position.set(60, FLOOR + 60, -69); L.add(glass);
  const lamp = new THREE.PointLight(0xffc98a, 700, 120, 1.6);
  lamp.position.set(W / 2, 34, H / 2); L.add(lamp);
}
