// The diorama: a wooden table, a painted battle mat and terrain pieces.
import * as THREE from 'three';
import { RULES } from '../data/units.js';
import { rng } from '../sim/rng.js';

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

function tree(R, x, z, s) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.14 * s, 0.6 * s, 5), flat(0x6b4a2b));
  trunk.position.y = 0.3 * s; g.add(trunk);
  const greens = [0x3d6b35, 0x4a7a3b, 0x2f5a2c, 0x58864a];
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry((0.75 - i * 0.18) * s, (0.9 - i * 0.12) * s, 6 + (i % 2)), flat(greens[Math.floor(R() * greens.length)]));
    cone.position.y = (0.75 + i * 0.45) * s; cone.rotation.y = R() * 3;
    g.add(cone);
  }
  g.position.set(x, 0, z);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
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
  for (const t of terrain) {
    if (t.kind === 'forest') {
      const felt = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r + 0.15, 0.14, 9), flat(0x4a5e33));
      felt.position.set(t.x, 0.07, t.z); felt.receiveShadow = true; L.add(felt);
      const n = Math.round(t.r * 2.2);
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * (t.r - 0.6);
        L.add(tree(R, t.x + Math.cos(a) * rr, t.z + Math.sin(a) * rr, 1.1 + R() * 0.6));
      }
    } else if (t.kind === 'ruin') {
      // broken stone wall: a run of blocks with a jagged top
      const along = t.w > t.d, len = along ? t.w : t.d, n = Math.max(2, Math.round(len / 0.7));
      for (let i = 0; i < n; i++) {
        const h = 0.8 + R() * 1.8;
        const blk = new THREE.Mesh(new THREE.BoxGeometry(along ? len / n - 0.03 : t.w, h, along ? t.d : len / n - 0.03), flat([0x9a958c, 0x8a857c, 0xa8a398][i % 3]));
        const off = -len / 2 + (i + 0.5) * len / n;
        blk.position.set(t.x + (along ? off : 0), h / 2, t.z + (along ? 0 : off));
        blk.rotation.y = (R() - 0.5) * 0.06;
        blk.castShadow = true; blk.receiveShadow = true; L.add(blk);
      }
      for (let i = 0; i < 4; i++) { // rubble
        const rb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 + R() * 0.15), flat(0x8f8a80));
        rb.position.set(t.x + (R() - 0.5) * (t.w + 1), 0.12, t.z + (R() - 0.5) * (t.d + 1)); rb.castShadow = true; L.add(rb);
      }
    } else if (t.kind === 'rock') {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(t.r, 0), flat(0x7d776d));
      rock.scale.set(1, 0.75, 1); rock.position.set(t.x, t.r * 0.45, t.z); rock.rotation.set(R(), R(), R());
      rock.castShadow = true; rock.receiveShadow = true; L.add(rock);
    } else if (t.kind === 'river') {
      const water = new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.06, t.d), new THREE.MeshStandardMaterial({ color: 0x3f7fa8, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.82 }));
      water.position.set(t.x, 0.02, t.z); water.receiveShadow = true; L.add(water);
      for (const f of t.fords || []) {
        for (let i = 0; i < 7; i++) {
          const st = new THREE.Mesh(new THREE.CylinderGeometry(0.22 + R() * 0.12, 0.28, 0.12, 6), flat(0xb4ab98));
          st.position.set(t.x + (R() - 0.5) * t.w, 0.07, f.z + (R() - 0.5) * f.d); st.receiveShadow = true; L.add(st);
        }
      }
      for (let i = 0; i < 18; i++) { // reeds along the banks
        const side = R() < 0.5 ? -1 : 1, zz = R() * t.d;
        const reed = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 4), flat(0x6f8a3a));
        reed.position.set(t.x + side * (t.w / 2 + 0.15), 0.3, zz); L.add(reed);
      }
    }
  }
}
