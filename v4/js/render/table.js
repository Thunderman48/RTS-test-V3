// The diorama: a wooden table, a painted battle mat and terrain pieces.
import * as THREE from 'three';
import { RULES } from '../data/units.js';
import { DEPLOY } from '../data/map.js';
import { rng } from '../sim/rng.js';
import { Kit, paintMat } from './kit.js';
import { buildRoom } from './props.js';

const flat = c => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9, metalness: 0 });

// ---------------------------------------------------------------- low-poly ground
// smooth value noise in [0,1)
function vnoise(seed) {
  const h = (i, j) => { const v = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return v - Math.floor(v); };
  return (x, z) => {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
}
const N1 = vnoise(1), N2 = vnoise(2), N3 = vnoise(3);
// the worn dirt road: a cubic bezier across the board, sampled as a polyline
const ROAD = (() => {
  const P = [[0, 16], [14, 12], [34, 20], [48, 16]], pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48, u = 1 - t;
    pts.push([u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0], u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1]]);
  }
  return pts;
})();
function roadDist(x, z) {
  let best = 1e9;
  for (let i = 0; i < ROAD.length - 1; i++) {
    const [ax, az] = ROAD[i], [bx, bz] = ROAD[i + 1];
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const ex = ax + dx * t - x, ez = az + dz * t - z;
    best = Math.min(best, ex * ex + ez * ez);
  }
  return Math.sqrt(best);
}
const lerpHex = (a, b, t) => {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const c = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(c);
};
function makeGround(terrain) {
  const river = terrain.find(t => t.kind === 'river');
  const ruins = terrain.filter(t => t.kind === 'ruin');
  const W = RULES.board.w, H = RULES.board.h;
  const inRiver = (x, z) => river && Math.abs(x - river.x) < river.w / 2 + 0.05 && !(river.fords || []).some(f => Math.abs(z - f.z) < f.d / 2 - 0.2);
  const height = (x, z) => {
    if (x <= 0.01 || z <= 0.01 || x >= W - 0.01 || z >= H - 0.01) return 0;
    let y = (N1(x / 4, z / 4) - 0.5) * 0.07 + (N2(x * 0.9, z * 0.9) - 0.5) * 0.03;
    if (river) {
      const dx = Math.abs(x - river.x) - river.w / 2;
      const ford = (river.fords || []).some(f => Math.abs(z - f.z) < f.d / 2);
      if (dx < 0.5) y = Math.min(y, ford ? -0.05 : -0.05 + Math.max(-0.14, dx * 0.2));
    }
    return y;
  };
  const color = (x, y, z) => {
    let c = lerpHex(0x6d9150, 0x86a65c, N1(x / 5 + 10, z / 5));
    c = lerpHex(c, 0x58783f, Math.max(0, N2(x / 3, z / 3 + 7) - 0.45) * 1.4);
    if (N3(x / 3.5, z / 3.5) > 0.74) c = lerpHex(c, 0x9a8458, 0.6);
    const rd = roadDist(x, z);
    if (rd < 1.6) c = lerpHex(c, 0x9c8258, rd < 1.0 ? 0.85 : (1.6 - rd) / 0.6 * 0.6);
    for (const t of ruins) if (Math.abs(x - t.x) < t.w / 2 + 1.1 && Math.abs(z - t.z) < t.d / 2 + 1.1) c = lerpHex(c, 0x9a9566, 0.35);
    if (x < 11) c = lerpHex(c, 0x5d86c8, 0.07); else if (x > W - 11) c = lerpHex(c, 0x9b6fc4, 0.07);
    if (river) {
      const dx = Math.abs(x - river.x) - river.w / 2;
      if (dx < 0.7) c = lerpHex(c, y < -0.03 ? 0x5c513d : 0x6e5a3e, dx < 0.1 ? 0.95 : 0.6);
    }
    return c;
  };
  // jittered triangle grid, alternating diagonals
  const cell = 0.9, nx = Math.round(W / cell), nz = Math.round(H / cell);
  const R = rng(5);
  const vx = [], vz = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    let x = i * W / nx, z = j * H / nz;
    if (i > 0 && i < nx) x += (R() - 0.5) * cell * 0.55;
    if (j > 0 && j < nz) z += (R() - 0.5) * cell * 0.55;
    vx.push(x); vz.push(z);
  }
  const pos = [];
  const V = (i, j) => { const k = j * (nx + 1) + i; const x = vx[k], z = vz[k]; return [x, height(x, z), z]; };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = V(i, j), b = V(i + 1, j), c = V(i, j + 1), d = V(i + 1, j + 1);
    if ((i + j) % 2) pos.push(...a, ...c, ...b, ...b, ...c, ...d);
    else pos.push(...a, ...c, ...d, ...a, ...d, ...b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return { g, color, height, inRiver };
}

// layered earth/rock sides of the diorama board (top at y = 0, bottom at y = -1)
function boardSides(k, R) {
  const W = RULES.board.w, H = RULES.board.h;
  const bands = [[0, -0.22, 0x5b4630], [-0.22, -0.55, 0x8a8174], [-0.55, -0.68, 0xc9bfa8], [-0.68, -1.0, 0x6b5238]];
  const edge = (len, place) => {
    const n = Math.round(len / 1.1);
    for (let i = 0; i < n; i++) for (const [y0, y1, col] of bands) {
      const out = (R() - 0.3) * 0.08;
      place(i * len / n + len / n / 2, len / n + 0.04, y0, y1, col, out);
    }
  };
  edge(W, (u, w, y0, y1, col, o) => { k.box(w, y0 - y1, 0.3, col, { x: u, y: (y0 + y1) / 2, z: -0.15 - o, j: 0.035, sh: 0.08 }); k.box(w, y0 - y1, 0.3, col, { x: u, y: (y0 + y1) / 2, z: H + 0.15 + o, j: 0.035, sh: 0.08 }); });
  edge(H, (u, w, y0, y1, col, o) => { k.box(0.3, y0 - y1, w, col, { x: -0.15 - o, y: (y0 + y1) / 2, z: u, j: 0.035, sh: 0.08 }); k.box(0.3, y0 - y1, w, col, { x: W + 0.15 + o, y: (y0 + y1) / 2, z: u, j: 0.035, sh: 0.08 }); });
  // inch ruler ticks along the top edges, like a measured gaming board
  for (let x = 1; x < W; x++) { const L = x % 6 === 0 ? 0.45 : 0.2; k.box(0.06, 0.03, L, 0xefe6cf, { x, y: 0.02, z: L / 2 + 0.02, sh: 0 }); k.box(0.06, 0.03, L, 0xefe6cf, { x, y: 0.02, z: H - L / 2 - 0.02, sh: 0 }); }
  for (let z = 1; z < H; z++) { const L = z % 6 === 0 ? 0.45 : 0.2; k.box(L, 0.03, 0.06, 0xefe6cf, { x: L / 2 + 0.02, y: 0.02, z, sh: 0 }); k.box(L, 0.03, 0.06, 0xefe6cf, { x: W - L / 2 - 0.02, y: 0.02, z, sh: 0 }); }
}

// grass tufts, pebbles and flowers, kept away from where squads deploy
function scatter(k, R, terrain, ground) {
  const W = RULES.board.w, H = RULES.board.h;
  const deploy = [];
  for (const d of DEPLOY) { deploy.push(d); deploy.push({ x: W - d.x, z: H - d.z }); }
  const busy = (x, z) => deploy.some(d => (d.x - x) ** 2 + (d.z - z) ** 2 < 9) || ground.inRiver(x, z) || roadDist(x, z) < 1.2
    || terrain.some(t => t.kind !== 'river' && (t.r ? (t.x - x) ** 2 + (t.z - z) ** 2 < (t.r + 0.4) ** 2 : Math.abs(t.x - x) < t.w / 2 + 0.6 && Math.abs(t.z - z) < t.d / 2 + 0.6));
  const greens = [0x5f8a43, 0x739e4c, 0x4f7a39];
  let tufts = 0;
  for (let n = 0; n < 900 && tufts < 260; n++) {
    const x = 0.6 + R() * (W - 1.2), z = 0.6 + R() * (H - 1.2);
    if (busy(x, z)) continue;
    tufts++;
    const y = ground.height(x, z), col = greens[n % 3];
    for (let b = 0; b < 3; b++) {
      const a = b * 2.1 + R(), h = 0.18 + R() * 0.16;
      k.cone(0.04, h, col, { x: x + Math.cos(a) * 0.06, y: y + h / 2, z: z + Math.sin(a) * 0.06, rx: Math.sin(a) * 0.35, rz: Math.cos(a) * 0.35, sh: 0.1 }, 3);
    }
    if (R() < 0.12) k.ball(0.045, [0xf5f0e0, 0xf2cf4a, 0xe98bb0][n % 3], { x: x + 0.08, y: y + 0.2, z, sh: 0 });
  }
  for (let n = 0; n < 160; n++) {
    const x = 0.5 + R() * (W - 1), z = 0.5 + R() * (H - 1);
    if (busy(x, z) && !(roadDist(x, z) < 1.2 && !ground.inRiver(x, z))) continue;
    k.ball(0.05 + R() * 0.07, [0x9c9282, 0xb4ab98, 0x857c70][n % 3], { x, y: ground.height(x, z) + 0.02, z, sy: 0.6, j: 0.02 });
  }
}

function tree(k, R, x, z, s) {
  const greens = [0x3f6e36, 0x4c7d3c, 0x335f2e, 0x5a8a48, 0x6a9a52];
  k.chunk(0.16 * s, 0.24 * s, 0.7 * s, 0.22 * s, 0x6b4a2b, { x, y: 0.35 * s, z, j: 0.02 }, 5);
  const n = 2 + (R() < 0.6 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const r = (0.8 - i * 0.2) * s, h = (1.0 - i * 0.12) * s;
    k.cone(r, h, greens[Math.floor(R() * greens.length)], { x: x + (R() - 0.5) * 0.08, y: (0.85 + i * 0.5) * s, z: z + (R() - 0.5) * 0.08, ry: R() * 3, j: r * 0.12, sh: 0.09 }, 6 + (i % 2));
  }
}
function bush(k, R, x, z, s) {
  const greens = [0x4c7d3c, 0x5a8a48, 0x3f6e36];
  for (let i = 0; i < 3; i++) k.ball((0.28 + R() * 0.15) * s, greens[i], { x: x + (R() - 0.5) * 0.5 * s, y: 0.18 * s, z: z + (R() - 0.5) * 0.5 * s, sy: 0.75, sh: 0.1 });
}
function rockPile(k, R, x, z, r, cols = [0x8a8072, 0x9c9282, 0x7a7266]) {
  // stacked faceted layers with pale strata bands
  const layers = 3;
  let y = 0;
  for (let i = 0; i < layers; i++) {
    const h = r * (0.42 - i * 0.07), rb = r * (1 - i * 0.24), rt = rb * 0.82;
    const ox = (R() - 0.5) * r * 0.2, oz = (R() - 0.5) * r * 0.2;
    k.cyl(rt, rb, h, cols[i % cols.length], { x: x + ox, y: y + h / 2, z: z + oz, ry: R() * 3, j: r * 0.09, sh: 0.1 }, 7);
    if (i < layers - 1) k.cyl(rt * 1.04, rt * 1.08, 0.05, 0xd8d0bc, { x: x + ox, y: y + h + 0.02, z: z + oz, ry: R() * 3, j: r * 0.05, sh: 0.06 }, 7);
    y += h + 0.04;
  }
  k.ball(r * 0.35, cols[1], { x: x + r * 0.7, y: r * 0.15, z: z - r * 0.5, j: r * 0.08, sy: 0.6 });
  k.ball(r * 0.25, cols[2], { x: x - r * 0.8, y: r * 0.1, z: z + r * 0.4, j: r * 0.06, sy: 0.6 });
}

export function buildTable(view, terrain) {
  const W = RULES.board.w, H = RULES.board.h;
  const L = view.layers.table;
  // the games table, props and the room around it
  buildRoom(view);
  // the board: faceted ground on top, layered sides
  const ground = makeGround(terrain);
  const kg = new Kit(17);
  kg.geo(ground.g, 0x6d9150, { cf: ground.color, sh: 0.06 });
  const gm = kg.mesh(paintMat('board')); gm.castShadow = false; L.add(gm);
  const ks = new Kit(19);
  boardSides(ks, rng(23));
  ks.box(W - 0.2, 0.96, H - 0.2, 0x4a3828, { x: W / 2, y: -0.52, z: H / 2, sh: 0 });   // board core
  scatter(ks, rng(29), terrain, ground);
  L.add(ks.mesh(paintMat('board')));
  const R = rng(11);
  const k = new Kit(3);
  const waters = [];
  for (const t of terrain) {
    if (t.kind === 'forest') {
      k.cyl(t.r, t.r + 0.3, 0.22, 0x55703a, { x: t.x, y: 0.1, z: t.z, j: 0.09, sh: 0.08 }, 11);
      k.cyl(t.r * 0.7, t.r * 0.95, 0.16, 0x4d6834, { x: t.x, y: 0.26, z: t.z, j: 0.08, sh: 0.08 }, 9);
      const n = Math.round(t.r * 2.4);
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * (t.r - 0.7);
        tree(k, R, t.x + Math.cos(a) * rr, t.z + Math.sin(a) * rr, 1.05 + R() * 0.6);
      }
      for (let i = 0; i < 3; i++) { const a = R() * Math.PI * 2; bush(k, R, t.x + Math.cos(a) * (t.r - 0.2), t.z + Math.sin(a) * (t.r - 0.2), 1); }
      for (let i = 0; i < 3; i++) { const a = R() * Math.PI * 2; k.ball(0.18, 0x8a8072, { x: t.x + Math.cos(a) * t.r * 0.8, y: 0.3, z: t.z + Math.sin(a) * t.r * 0.8, sy: 0.6 }); }
    } else if (t.kind === 'ruin') {
      // broken stone wall: chunky blocks with mossy tops and rubble
      const along = t.w > t.d, len = along ? t.w : t.d, n = Math.max(2, Math.round(len / 0.7));
      const stones = [0xa39d90, 0x948e82, 0xb3ad9f, 0x8a847a];
      for (let i = 0; i < n; i++) {
        const h = 0.8 + R() * 1.8;
        const off = -len / 2 + (i + 0.5) * len / n;
        const bw = along ? len / n - 0.04 : t.w, bd = along ? t.d : len / n - 0.04;
        const cx = t.x + (along ? off : 0), cz = t.z + (along ? 0 : off);
        // two courses per block for a hand-built look
        k.box(bw, h * 0.55, bd, stones[i % 4], { x: cx, y: h * 0.275, z: cz, ry: (R() - 0.5) * 0.06, j: 0.035, sh: 0.07 });
        k.box(bw * 0.94, h * 0.45, bd * 0.92, stones[(i + 1) % 4], { x: cx + (R() - 0.5) * 0.05, y: h * 0.55 + h * 0.225, z: cz + (R() - 0.5) * 0.05, ry: (R() - 0.5) * 0.1, j: 0.04, sh: 0.07 });
        if (R() < 0.55) k.box(bw * 0.8, 0.07, bd * 0.85, 0x6f8a45, { x: cx, y: h + 0.03, z: cz, j: 0.03, sh: 0.1 });
      }
      for (let i = 0; i < 7; i++) k.ball(0.14 + R() * 0.16, stones[i % 4], { x: t.x + (R() - 0.5) * (t.w + 1.2), y: 0.08, z: t.z + (R() - 0.5) * (t.d + 1.2), sy: 0.7, j: 0.03 });
    } else if (t.kind === 'rock') {
      rockPile(k, R, t.x, t.z, t.r * 1.05);
    } else if (t.kind === 'river') {
      waters.push(t);
      for (const f of t.fords || []) {
        for (let i = 0; i < 8; i++) k.ball(0.26 + R() * 0.12, [0xc2b8a3, 0xb4ab98, 0xa89f8c][i % 3], { x: t.x + (R() - 0.5) * (t.w - 0.2), y: -0.02, z: f.z + (R() - 0.5) * f.d, sy: 0.4, j: 0.05 });
      }
      // bank stones, reeds with cattails, lily pads
      for (let i = 0; i < 26; i++) {
        const side = R() < 0.5 ? -1 : 1, zz = R() * t.d;
        k.ball(0.16 + R() * 0.16, [0x9c9282, 0xb4ab98][i % 2], { x: t.x + side * (t.w / 2 + 0.05), y: 0.05, z: zz, sy: 0.55, j: 0.04 });
      }
      for (let i = 0; i < 16; i++) {
        const side = R() < 0.5 ? -1 : 1, zz = R() * t.d, bx = t.x + side * (t.w / 2 + 0.25);
        for (let j = 0; j < 4; j++) {
          const h = 0.5 + R() * 0.45, ox = (R() - 0.5) * 0.35, oz = (R() - 0.5) * 0.35, lean = (R() - 0.5) * 0.3;
          k.cone(0.045, h, 0x6f8a3a, { x: bx + ox, y: h / 2, z: zz + oz, rz: lean }, 3);
          if (j < 2) k.chunk(0.06, 0.06, 0.16, 0.06, 0x7a4e2c, { x: bx + ox - lean * h * 0.5, y: h * 0.88, z: zz + oz }, 5);
        }
      }
      for (let i = 0; i < 10; i++) k.cyl(0.16, 0.16, 0.02, 0x5f9a4a, { x: t.x + (R() - 0.5) * (t.w - 0.4), y: -0.01, z: R() * t.d, sh: 0.1 }, 7);
    }
  }
  const terrainMesh = k.mesh(paintMat('terrain'));
  L.add(terrainMesh);
  for (const t of waters) {
    const kw = new Kit(21);
    const g = new THREE.PlaneGeometry(t.w + 0.7, t.d - 0.02, 5, Math.round(t.d * 1.5));
    g.rotateX(-Math.PI / 2);
    kw.geo(g, 0x4fa3c4, { x: t.x, y: 0.012, z: t.z, j: 0.025, sh: 0.14 });
    const water = kw.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.8, roughness: 0.12, metalness: 0.2 }));
    water.castShadow = false;
    L.add(water);
  }
}
