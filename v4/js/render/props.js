// The games table and the room around the board: low-poly wooden planks with painted grain,
// dice, rulers, a rulebook and other gamer clutter, plus a cosy, dim room.
// The board top is y = 0, its underside (the table top) is y = -1.
import * as THREE from 'three';
import { RULES } from '../data/units.js';
import { rng } from '../sim/rng.js';
import { Kit, paintMat } from './kit.js';
import { makeMini } from './minis.js';

const TOP = -1;                 // table top surface
const FLOOR = -30;              // floor level
const W = RULES.board.w, H = RULES.board.h;
const TX0 = -7.5, TX1 = W + 7.5, TZ0 = -7.5, TZ1 = H + 7.5;   // table top extents (board + 7.5" a side)

let R = Math.random;
const j = (v, a) => v + (R() - 0.5) * 2 * a;
// a chunky plank segment as a hull: chamfered top edges, slightly uneven
function plank(k, x0, x1, z0, z1, y0, y1, col, cham = 0.12) {
  const pts = [];
  for (const x of [x0, x1]) {
    pts.push([x, y0, z0], [x, y0, z1]);
    pts.push([j(x, 0.02), j(y1 - cham, 0.02), z0], [j(x, 0.02), j(y1 - cham, 0.02), z1]);
    pts.push([x, j(y1, 0.015), z0 + cham], [x, j(y1, 0.015), z1 - cham]);
  }
  k.hull(pts, col, { sh: 0.05 });
}
const box = (cx, cy, cz, w, h, d) => {
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push([cx + sx * w / 2, cy + sy * h / 2, cz + sz * d / 2]);
  return out;
};

// ---------------------------------------------------------------- the table
const WOODS = [0x8f5c34, 0x7c4c2a, 0x9a6a3e, 0x70452a, 0x87562f];
function table(k) {
  // dark under-board shows through the gaps between planks
  k.box(TX1 - TX0 - 0.4, 0.8, TZ1 - TZ0 - 0.4, 0x2e1d12, { x: (TX0 + TX1) / 2, y: TOP - 0.75, z: (TZ0 + TZ1) / 2, sh: 0 });
  const pw = 9.4, n = Math.round((TZ1 - TZ0) / pw);
  for (let i = 0; i < n; i++) {
    const z0 = TZ0 + i * (TZ1 - TZ0) / n + 0.06, z1 = TZ0 + (i + 1) * (TZ1 - TZ0) / n - 0.06;
    const col = WOODS[Math.floor(R() * WOODS.length)];
    // each plank is two or three lengths butted together
    const cuts = [TX0];
    if (R() < 0.6) cuts.push(TX0 + 22 + R() * 18);
    cuts.push(TX1);
    for (let c = 0; c < cuts.length - 1; c++) {
      const tone = c % 2 ? WOODS[(WOODS.indexOf(col) + 2) % WOODS.length] : col;
      plank(k, cuts[c] + 0.05, cuts[c + 1] - 0.05, z0, z1, TOP - 0.6, TOP, tone);
      // painted grain: a few thin darker streaks just proud of the surface
      for (let g = 0; g < 2; g++) {
        const gz = z0 + 1 + R() * (z1 - z0 - 2), gx0 = cuts[c] + 2 + R() * 6, gx1 = Math.min(cuts[c + 1] - 2, gx0 + 14 + R() * 16);
        const dz = (R() - 0.5) * 1.2;
        k.hull([[gx0, TOP + 0.005, gz], [gx1, TOP + 0.005, gz + dz], [gx0, TOP + 0.02, gz + 0.3], [gx1, TOP + 0.02, gz + dz + 0.25], [gx0 + 2, TOP + 0.005, gz + 0.4], [gx1 - 2, TOP + 0.005, gz + dz + 0.38]], 0x5a3920, { sh: 0.05 });
      }
      if (R() < 0.45) { // a knot
        const kx = cuts[c] + 3 + R() * (cuts[c + 1] - cuts[c] - 6), kz = (z0 + z1) / 2 + (R() - 0.5) * 1.6;
        const pts = [];
        for (let a = 0; a < 6; a++) { const t = a / 6 * Math.PI * 2; pts.push([kx + Math.cos(t) * 0.9, TOP + 0.01, kz + Math.sin(t) * 0.5], [kx + Math.cos(t) * 0.6, TOP + 0.03, kz + Math.sin(t) * 0.3]); }
        k.hull(pts, 0x4a2e19, { sh: 0.05 });
      }
    }
  }
  // apron / frame and legs
  const ay0 = TOP - 0.6, ay1 = TOP - 4.2, frame = 0x5c3a21;
  k.hull(box((TX0 + TX1) / 2, (ay0 + ay1) / 2, TZ0 + 1.5, TX1 - TX0 - 4, ay0 - ay1, 1.2), frame);
  k.hull(box((TX0 + TX1) / 2, (ay0 + ay1) / 2, TZ1 - 1.5, TX1 - TX0 - 4, ay0 - ay1, 1.2), frame);
  k.hull(box(TX0 + 1.5, (ay0 + ay1) / 2, (TZ0 + TZ1) / 2, 1.2, ay0 - ay1, TZ1 - TZ0 - 4), frame);
  k.hull(box(TX1 - 1.5, (ay0 + ay1) / 2, (TZ0 + TZ1) / 2, 1.2, ay0 - ay1, TZ1 - TZ0 - 4), frame);
  for (const [x, z] of [[TX0 + 2.5, TZ0 + 2.5], [TX1 - 2.5, TZ0 + 2.5], [TX0 + 2.5, TZ1 - 2.5], [TX1 - 2.5, TZ1 - 2.5]]) {
    const pts = [];
    for (const [y, s] of [[TOP - 0.6, 2.6], [TOP - 6, 2.4], [FLOOR + 3, 1.8], [FLOOR, 2.0]]) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push([x + a * s / 2, y, z + b * s / 2]);
    k.hull(pts, 0x5c3a21, { sh: 0.06 });
  }
}

// ---------------------------------------------------------------- props on the table
function die(k, x, z, size, col, pip, rot, lift = 0) {
  const d = new Kit(1);
  const s = size / 2;
  d.hull([...box(0, 0, 0, size, size * 0.86, size * 0.86), ...box(0, 0, 0, size * 0.86, size, size * 0.86), ...box(0, 0, 0, size * 0.86, size * 0.86, size)], col, { sh: 0.08 });
  // pips: face n gets n pips (1 top, 6 bottom; 2/5 and 3/4 opposite)
  const P = [[], [[0, 0]], [[-.5, -.5], [.5, .5]], [[-.5, -.5], [0, 0], [.5, .5]], [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]], [[-.5, -.5], [.5, -.5], [0, 0], [-.5, .5], [.5, .5]], [[-.5, -.6], [.5, -.6], [-.5, 0], [.5, 0], [-.5, .6], [.5, .6]]];
  const faces = [[1, [0, 1, 0]], [6, [0, -1, 0]], [2, [1, 0, 0]], [5, [-1, 0, 0]], [3, [0, 0, 1]], [4, [0, 0, -1]]];
  const ps = size * 0.11, off = size * 0.28;
  for (const [n, nrm] of faces) for (const [u, v] of P[n]) {
    let cx, cy, cz;
    if (nrm[1]) { cx = u * off * 2 * 0.6; cy = nrm[1] * (s + 0.002); cz = v * off * 2 * 0.6; }
    else if (nrm[0]) { cx = nrm[0] * (s + 0.002); cy = u * off * 2 * 0.6; cz = v * off * 2 * 0.6; }
    else { cx = u * off * 2 * 0.6; cy = v * off * 2 * 0.6; cz = nrm[2] * (s + 0.002); }
    d.hull(box(cx, cy, cz, nrm[0] ? 0.02 : ps, nrm[1] ? 0.02 : ps, nrm[2] ? 0.02 : ps), pip, { sh: 0 });
  }
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, TOP + s + lift, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])), new THREE.Vector3(1, 1, 1));
  k.merge(d, m);
}
function d20(k, x, z, r, col) {
  const g = new THREE.IcosahedronGeometry(r, 0);
  k.add(g, col, { x, y: TOP + r * 0.8, z, rx: R() * 3, ry: R() * 3, sh: 0.12 });
}
function ruler(k, x, z, len, rotY) {
  const r = new Kit(2);
  r.hull(box(0, 0.06, 0, len, 0.12, 1.25), 0xe8c24a, { sh: 0.04 });
  for (let i = 0; i <= len; i++) {
    const L = i % 6 === 0 ? 0.55 : i % 3 === 0 ? 0.38 : 0.22;
    r.hull(box(-len / 2 + i, 0.125, -0.62 + L / 2, 0.05, 0.01, L), 0x2a2018, { sh: 0 });
  }
  r.hull(box(0, 0.125, 0.25, 3, 0.01, 0.3), 0xb2312a, { sh: 0 });
  k.merge(r, new THREE.Matrix4().compose(new THREE.Vector3(x, TOP, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3(1, 1, 1)));
}
function cylHull(k, x, y0, z, r0, r1, h, col, n = 8, o = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push([x + Math.cos(a) * r0, y0, z + Math.sin(a) * r0], [x + Math.cos(a) * r1, y0 + h, z + Math.sin(a) * r1]); }
  k.hull(pts, col, { sh: 0.06, ...o });
}
function props(k, extras) {
  // near edge: dice tray with dice, a long ruler, loose dice and a d20
  const tx = 36, tz = H + 4;
  k.hull(box(tx, TOP + 0.35, tz, 9, 0.7, 5.6), 0x3b2a1e);
  k.hull(box(tx, TOP + 0.62, tz, 8, 0.1, 4.6), 0x7a1f26);
  die(k, tx - 2, tz - 1, 1.0, 0xc8302c, 0xf4efe4, [0, 0.4, 0], 0.67);
  die(k, tx + 0.4, tz + 1.2, 1.0, 0xf2ebdc, 0x1c1a20, [0, -0.3, 0], 0.67);
  die(k, tx + 2.4, tz - 0.6, 1.0, 0x2f5fb6, 0xf4efe4, [0, 1.1, 0], 0.67);
  ruler(k, 14, H + 3.4, 24, -0.02);
  const dice = [[-3, H + 2.5, 0xc8302c, 0xf4efe4], [27, H + 5.6, 0x5e3a88, 0xe6dcc3], [W + 3, -3, 0x2f5fb6, 0xf4efe4], [W + 5, -4.8, 0xc8302c, 0xf4efe4]];
  for (const [x, z, c, p] of dice) die(k, x, z, 1.0, c, p, [Math.floor(R() * 4) * Math.PI / 2, R() * 6, 0]);
  d20(k, -4.5, H + 5.2, 0.85, 0x6fb4e6);
  d20(k, W + 5, -2, 0.85, 0xe0b84f);
  // tape measure in the near-right corner with its tape pulled out
  cylHull(k, W + 4, TOP, H + 4, 1.3, 1.3, 1.0, 0xe0b84f, 10);
  cylHull(k, W + 4, TOP + 0.98, H + 4, 0.6, 0.45, 0.08, 0x2a2018, 8);
  k.hull(box(W + 0.4, TOP + 0.03, H + 4, 5.5, 0.05, 0.75), 0xf2d27a, { sh: 0 });
  for (let i = 0; i < 5; i++) k.hull(box(W - 1.8 + i, TOP + 0.06, H + 4.1, 0.05, 0.01, 0.4), 0x2a2018, { sh: 0 });
  // left margin: rulebook, a second ruler, a spare lord
  k.hull(box(-3.9, TOP + 0.55, 5, 5.6, 1.1, 7.6), 0x7a1f26);
  k.hull(box(-3.8, TOP + 0.55, 5, 5.5, 0.85, 7.3), 0xf2ead6);
  k.hull(box(-3.9, TOP + 1.12, 5, 2.2, 0.02, 2.2), 0xe0b84f, { sh: 0 });
  k.hull(box(-3.9, TOP + 1.13, 5, 0.9, 0.02, 0.9), 0x7a1f26, { sh: 0 });
  ruler(k, -4, 18, 14, Math.PI / 2 + 0.03);
  // right margin: carry case with spare minis, a mug, cards
  const cx = W + 3.9, cz = 9;
  k.hull(box(cx, TOP + 0.7, cz, 5.4, 1.4, 9.6), 0x26262b);
  k.hull(box(cx, TOP + 1.42, cz, 5.0, 0.06, 9.2), 0x5d5f66, { sh: 0.03 });
  for (let i = 0; i < 4; i++) k.hull(box(cx - 1.2 + (i % 2) * 2.4, TOP + 1.46, cz - 2.2 + Math.floor(i / 2) * 4.4, 1.9, 0.02, 1.9), 0x1c1c20, { sh: 0 });
  extras.push(['sword', 'kingdom', cx - 1.2, cz - 2.2], ['crossbow', 'kingdom', cx + 1.2, cz - 2.2], ['skeleton', 'undead', cx - 1.2, cz + 2.2], ['archer', 'undead', cx + 1.2, cz + 2.2]);
  extras.top = TOP + 1.47;
  cylHull(k, W + 4, TOP, 20.5, 1.5, 1.6, 3.6, 0xe9e2d0, 10);
  cylHull(k, W + 4, TOP + 3.4, 20.5, 1.32, 1.32, 0.22, 0x5a3418, 10, { sh: 0 });
  k.add(new THREE.TorusGeometry(0.9, 0.22, 4, 8), 0xe9e2d0, { x: W + 5.6, y: TOP + 1.9, z: 20.5, ry: Math.PI / 2, sh: 0.05 });
  for (let i = 0; i < 6; i++) k.add(new THREE.BoxGeometry(3.4, 0.08, 4.8), i === 5 ? 0x2f5fb6 : 0xf2ead6, { x: W + 3.8 + (R() - 0.5) * 0.3, y: TOP + 0.04 + i * 0.08, z: 27 + (R() - 0.5) * 0.3, ry: (R() - 0.5) * 0.15, sh: 0.03 });
  // far edge: paint pots, a brush and a spare wraith
  for (const [x, z, lid] of [[30, -3.2, 0x2f5fb6], [32.2, -4.6, 0x5e3a88], [29.8, -5.6, 0xc8302c]]) {
    cylHull(k, x, TOP, z, 0.75, 0.7, 1.4, 0x2a2a2e, 8);
    cylHull(k, x, TOP + 1.4, z, 0.78, 0.78, 0.4, lid, 8);
  }
  const brush = new Kit(3);
  brush.hull([[-2.2, 0, 0], [1.4, 0, 0], ...box(-2.2, 0, 0, 0.01, 0.14, 0.14), ...box(1.4, 0, 0, 0.01, 0.2, 0.2)], 0xb2312a);
  brush.hull([...box(1.6, 0, 0, 0.4, 0.22, 0.22), [2.4, 0, 0]], 0xc4cad3);
  brush.hull([[2.4, 0, 0], ...box(2.5, 0, 0, 0.1, 0.12, 0.12), [3.0, 0, 0]], 0x2a2018);
  k.merge(brush, new THREE.Matrix4().compose(new THREE.Vector3(36, TOP + 0.14, -3.6), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.4, 0)), new THREE.Vector3(1, 1, 1)));
  extras.loose = [['lord', 'kingdom', -4, 29], ['wraith', 'undead', 42, -3.6]];
}

// ---------------------------------------------------------------- the room
function room(k) {
  // floorboards
  for (let i = 0; i < 20; i++) {
    const z0 = -140 + i * 16;
    const col = [0x5a3a24, 0x644229, 0x51341f, 0x6b462a][i % 4];
    let x = -150;
    while (x < 200) { const L = 80 + R() * 60; k.box(Math.min(L, 200 - x) - 0.5, 1, 15.5, col, { x: x + Math.min(L, 200 - x) / 2, y: FLOOR - 0.5, z: z0 + 8, sh: 0.04 }); x += L; }
  }
  // rug under the table
  const rug = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; rug.push([W / 2 + Math.cos(a) * 62, FLOOR + 0.01, H / 2 + Math.sin(a) * 46], [W / 2 + Math.cos(a) * 62, FLOOR + 0.25, H / 2 + Math.sin(a) * 46]); }
  k.hull(rug, 0x6b2a2a, { sh: 0.03 });
  const rug2 = rug.map(p => [W / 2 + (p[0] - W / 2) * 0.86, p[1] + 0.02, H / 2 + (p[2] - H / 2) * 0.86]);
  k.hull(rug2, 0x8a3a30, { sh: 0.03 });
  // walls with skirting, a window and a picture
  const WZ = -100, WX = -110;
  k.box(320, 140, 2, 0x4c544a, { x: 40, y: FLOOR + 70, z: WZ, sh: 0.02 });
  k.box(2, 140, 260, 0x495046, { x: WX, y: FLOOR + 70, z: 30, sh: 0.02 });
  k.box(320, 6, 1.6, 0x3a2516, { x: 40, y: FLOOR + 3, z: WZ + 1.6 });
  k.box(1.6, 6, 260, 0x3a2516, { x: WX + 1.6, y: FLOOR + 3, z: 30 });
  // window frame (the glass is a separate glowing pane)
  const wx = 60, wy = FLOOR + 75;
  k.box(54, 3, 3, 0xe9e2d0, { x: wx, y: wy + 25, z: WZ + 1.5 }); k.box(58, 3, 6, 0xe9e2d0, { x: wx, y: wy - 25, z: WZ + 3 });
  k.box(3, 50, 3, 0xe9e2d0, { x: wx - 26, y: wy, z: WZ + 1.5 }); k.box(3, 50, 3, 0xe9e2d0, { x: wx + 26, y: wy, z: WZ + 1.5 });
  k.box(2, 50, 2, 0xe9e2d0, { x: wx, y: wy, z: WZ + 1.5 }); k.box(50, 2, 2, 0xe9e2d0, { x: wx, y: wy, z: WZ + 1.5 });
  k.box(30, 22, 1.5, 0x3a2516, { x: WX + 1.5, y: FLOOR + 85, z: 70, ry: Math.PI / 2 });
  k.box(26, 18, 1.6, 0x6f9150, { x: WX + 1.7, y: FLOOR + 85, z: 70, ry: Math.PI / 2, sh: 0.1 });
  // bookshelf with books and boxed armies
  const bx = -40, bz = WZ + 9;
  k.box(56, 96, 14, 0x4a2e1a, { x: bx, y: FLOOR + 48, z: bz });
  for (let s = 0; s < 4; s++) {
    const sy = FLOOR + 6 + s * 23;
    k.box(52, 1.5, 12, 0x5c3a21, { x: bx, y: sy, z: bz + 1 });
    let x = bx - 24;
    while (x < bx + 22) {
      const big = R() < 0.25, w = big ? 9 + R() * 4 : 2 + R() * 2.2, h = big ? 12 + R() * 4 : 13 + R() * 6;
      if (x + w > bx + 24) break;
      const col = big ? [0x2f5fb6, 0x5e3a88, 0xb2312a, 0x2e6b4a][Math.floor(R() * 4)] : [0x7a1f26, 0x2a3f6b, 0x3b5a35, 0x8a6a2a, 0x3a2b4a, 0xd8cfb8][Math.floor(R() * 6)];
      k.box(w - 0.3, h, big ? 11 : 9, col, { x: x + w / 2, y: sy + 0.75 + h / 2, z: bz + 1.5, sh: 0.06 });
      x += w;
    }
  }
  // a chair by the table
  const chx = W + 22, chz = H / 2 - 4;
  k.box(18, 2, 18, 0x6b462a, { x: chx, y: FLOOR + 18, z: chz });
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(2, 18, 2, 0x5c3a21, { x: chx + a * 8, y: FLOOR + 9, z: chz + b * 8 });
  k.box(2, 22, 18, 0x6b462a, { x: chx + 8, y: FLOOR + 30, z: chz });
}

export function buildRoom(view) {
  const L = view.layers.table;
  R = rng(41);
  const kt = new Kit(31);
  table(kt);
  const tableMesh = kt.mesh(paintMat('board')); tableMesh.castShadow = false;
  L.add(tableMesh);
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
  // window glass glow and a warm lamp over the table
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(50, 48), new THREE.MeshBasicMaterial({ color: 0x9cc4e8 }));
  glass.position.set(60, FLOOR + 75, -99); L.add(glass);
  const lamp = new THREE.PointLight(0xffc98a, 900, 140, 1.6);
  lamp.position.set(W / 2, 40, H / 2); L.add(lamp);
}
