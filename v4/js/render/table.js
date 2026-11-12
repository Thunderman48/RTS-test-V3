// The diorama: a wooden table, a painted battle mat and terrain pieces.
import * as THREE from 'three';
import { RULES } from '../data/units.js';
import { rng } from '../sim/rng.js';
import { Kit, paintMat } from './kit.js';

const flat = c => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9, metalness: 0 });

function matTexture(terrain) {
  const W = RULES.board.w, H = RULES.board.h, S = 40; // px per inch
  const c = document.createElement('canvas'); c.width = W * S; c.height = H * S;
  const g = c.getContext('2d');
  const R = rng(7);
  g.fillStyle = '#6f9150'; g.fillRect(0, 0, c.width, c.height);
  // soft patches of lighter/darker grass and dirt
  const blob = (x, y, r, col, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col.replace('A', a)); gr.addColorStop(1, col.replace('A', 0)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  for (let i = 0; i < 70; i++) blob(R() * c.width, R() * c.height, (2 + R() * 6) * S, R() < 0.5 ? 'rgba(124,158,86,A)' : 'rgba(92,124,66,A)', 0.55);
  for (let i = 0; i < 22; i++) blob(R() * c.width, R() * c.height, (1 + R() * 3) * S, 'rgba(140,116,78,A)', 0.45);
  // a worn dirt road across the board
  g.strokeStyle = 'rgba(146,120,82,0.55)'; g.lineWidth = 2.2 * S; g.lineCap = 'round';
  g.beginPath(); g.moveTo(0, 16 * S); g.bezierCurveTo(14 * S, 12 * S, 34 * S, 20 * S, 48 * S, 16 * S); g.stroke();
  // grass tufts
  for (let i = 0; i < 2600; i++) { g.fillStyle = R() < 0.5 ? 'rgba(60,88,44,0.5)' : 'rgba(150,180,100,0.35)'; g.fillRect(R() * c.width, R() * c.height, 3, 6); }
  // deployment edges (subtle)
  g.fillStyle = 'rgba(58,120,216,0.10)'; g.fillRect(0, 0, 11 * S, c.height);
  g.fillStyle = 'rgba(155,89,208,0.10)'; g.fillRect(c.width - 11 * S, 0, 11 * S, c.height);
  // inch ticks along the edges, like a mat with a ruler
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (let x = 0; x <= W; x++) { const L = x % 6 === 0 ? 14 : 6; g.fillRect(x * S - 1, 0, 2, L); g.fillRect(x * S - 1, c.height - L, 2, L); }
  for (let z = 0; z <= H; z++) { const L = z % 6 === 0 ? 14 : 6; g.fillRect(0, z * S - 1, L, 2); g.fillRect(c.width - L, z * S - 1, L, 2); }
  // river bed painted under the water mesh
  for (const t of terrain) if (t.kind === 'river') { g.fillStyle = '#5e5440'; g.fillRect((t.x - t.w / 2 - 0.35) * S, 0, (t.w + 0.7) * S, c.height); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
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
  // table top and legs-ish skirt
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.7, metalness: 0.05 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(W + 10, 1.4, H + 10), wood);
  top.position.set(W / 2, -0.75, H / 2); top.receiveShadow = true; L.add(top);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(W + 10.6, 0.5, H + 10.6), new THREE.MeshStandardMaterial({ color: 0x4e301b, roughness: 0.6 }));
  edge.position.set(W / 2, -1.2, H / 2); L.add(edge);
  // the mat
  const mat = new THREE.Mesh(new THREE.BoxGeometry(W, 0.08, H), [flat(0x55703f), flat(0x55703f), new THREE.MeshStandardMaterial({ map: matTexture(terrain), roughness: 0.95 }), flat(0x55703f), flat(0x55703f), flat(0x55703f)]);
  mat.position.set(W / 2, -0.04, H / 2); mat.receiveShadow = true; L.add(mat);
  // a few props on the table edge: dice tray-ish box, tape measure (decor)
  const tape = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.7, 16), flat(0xe0b84f));
  tape.position.set(-2.6, 0.35, H - 3); tape.castShadow = true; L.add(tape);
  const tape2 = new THREE.Mesh(new THREE.BoxGeometry(5, 0.04, 0.5), flat(0xf2d27a)); tape2.position.set(0.2, 0.02, H - 3); L.add(tape2);

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
        for (let i = 0; i < 8; i++) k.ball(0.26 + R() * 0.12, [0xc2b8a3, 0xb4ab98, 0xa89f8c][i % 3], { x: t.x + (R() - 0.5) * (t.w - 0.2), y: 0.04, z: f.z + (R() - 0.5) * f.d, sy: 0.4, j: 0.05 });
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
      for (let i = 0; i < 10; i++) k.cyl(0.16, 0.16, 0.02, 0x5f9a4a, { x: t.x + (R() - 0.5) * (t.w - 0.4), y: 0.07, z: R() * t.d, sh: 0.1 }, 7);
    }
  }
  const terrainMesh = k.mesh(paintMat());
  L.add(terrainMesh);
  for (const t of waters) {
    const kw = new Kit(21);
    const g = new THREE.PlaneGeometry(t.w + 0.2, t.d, 4, Math.round(t.d * 1.5));
    g.rotateX(-Math.PI / 2);
    kw.geo(g, 0x4fa3c4, { x: t.x, y: 0.05, z: t.z, j: 0.05, sh: 0.14 });
    const water = kw.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.8, roughness: 0.12, metalness: 0.2 }));
    water.castShadow = false;
    L.add(water);
  }
}
