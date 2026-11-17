// Undead graveyards on the table. The ground itself turns into dark blight (ground.js, a texture
// change with soft noisy edges, like blight or creep in other RTS games); this layer scatters the
// graveyard props on it: big headstones, wooden and stone crosses, bone piles and dead stumps,
// thick in the middle and thinning toward the edge. Props sit on a fixed seeded grid, so a graveyard
// that grows only adds props at its rim. One merged mesh, rebuilt only when the graves or the
// buildings standing on them change. Uses the terrain paint, so the fog covers unexplored graves.
import { FACTIONS, BUILDINGS } from '../data/units.js';
import { graveCircles } from '../sim/base.js';
import { Kit, paintMat } from './kit.js';
import { rng } from '../sim/rng.js';
import { setBlight, blightAt, groundVersion } from './ground.js';

const STONE = [0x8d8a86, 0x7a7774, 0x9a968f, 0x6f6c6a];
const WOOD = [0x5d4a38, 0x6d5a45, 0x4e3d2e];
const BONE = 0xe0d8c2, DIRT = 0x3a2e33, MOSS = 0x55603d;
const CELL = 0.95;

const footR = d => d.shape === 'circle' ? d.r : Math.hypot(d.w, d.d) / 2;

function headstone(k, R, x, z, ry, lean, i) {
  const h = 0.55 + R() * 0.3, w = 0.36 + R() * 0.12, col = STONE[i % 4];
  const kind = R();
  if (kind < 0.55) {
    // rounded-top slab
    k.box(w, h - w / 2, 0.13, col, { x, y: (h - w / 2) / 2, z, ry, rz: lean, j: 0.02, sh: 0.08 });
    k.cyl(w / 2, w / 2, 0.13, col, { x: x - Math.sin(lean) * (h - w / 2), y: h - w / 2, z, rx: Math.PI / 2, ry, sh: 0.08 }, 8);
  } else {
    // square slab with a pointed cap
    k.box(w, h, 0.14, col, { x, y: h / 2, z, ry, rz: lean, j: 0.025, sh: 0.08 });
    k.box(w + 0.06, 0.07, 0.18, STONE[(i + 1) % 4], { x: x - Math.sin(lean) * h, y: h + 0.02, z, ry, rz: lean, sh: 0.06 });
  }
  if (R() < 0.35) k.ball(0.09, MOSS, { x: x + 0.1, y: 0.06, z, sy: 0.5 });
  // the sunken grave mound in front of it
  const fx = Math.sin(ry) * 0.36, fz = Math.cos(ry) * 0.36;
  k.box(0.34, 0.06, 0.55, DIRT, { x: x + fx, y: 0.03, z: z + fz, ry, j: 0.03, sh: 0.05 });
}
function cross(k, R, x, z, ry, lean, i) {
  const h = 0.8 + R() * 0.2, stone = R() < 0.35, col = stone ? STONE[i % 4] : WOOD[i % 3], t = stone ? 0.1 : 0.07;
  k.box(t, h, t, col, { x, y: h / 2, z, ry, rz: lean, sh: 0.06 });
  k.box(0.42, t, t, col, { x: x - Math.sin(lean) * h * 0.72, y: h * 0.72, z, ry, rz: lean, sh: 0.06 });
  if (stone) k.box(0.22, 0.08, 0.22, STONE[(i + 2) % 4], { x, y: 0.04, z, ry, sh: 0.06 });
  const fx = Math.sin(ry) * 0.33, fz = Math.cos(ry) * 0.33;
  k.box(0.3, 0.05, 0.5, DIRT, { x: x + fx, y: 0.03, z: z + fz, ry, j: 0.03, sh: 0.05 });
}
function bones(k, R, x, z) {
  for (let b = 0; b < 3; b++) k.box(0.32, 0.035, 0.06, BONE, { x: x + (R() - 0.5) * 0.3, y: 0.05 + b * 0.02, z: z + (R() - 0.5) * 0.3, ry: R() * 3, sh: 0.05 });
  k.ball(0.085, BONE, { x: x + 0.12, y: 0.08, z: z - 0.05, sy: 0.85 });
}
function stump(k, R, x, z) {
  const h = 0.3 + R() * 0.35;
  k.cyl(0.1, 0.16, h, 0x3a3029, { x, y: h / 2, z, rz: (R() - 0.5) * 0.15, j: 0.025, sh: 0.08 }, 6);
  if (R() < 0.6) k.box(0.04, 0.32, 0.04, 0x3a3029, { x: x + 0.08, y: h + 0.08, z, rz: -0.7, sh: 0.05 });   // a dead branch
}

export class GraveLayer {
  constructor(layer) { this.layer = layer; this.mesh = null; this.sig = ''; }
  // state: the game state to draw (planning), or the replay's starting state
  update(state) {
    const circles = [];
    for (const p of [0, 1]) if (state.players && FACTIONS[state.players[p].faction].graves) circles.push(...graveCircles(state, p));
    const blds = (state.buildings || []).filter(b => b.hp > 0);
    const sig = circles.map(c => `${c.x},${c.z},${c.r.toFixed(2)}`).join('|') + '#' + blds.map(b => b.id).join(',') + '#' + groundVersion();
    if (sig === this.sig) return;
    this.sig = sig;
    setBlight(circles);
    if (this.mesh) { this.layer.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (!circles.length) return;
    const clear = blds.map(b => ({ x: b.x, z: b.z, r: footR(BUILDINGS[b.type]) + 0.45 }))
      .concat((state.terrain || []).filter(t => t.kind === 'rock' || t.kind === 'lake').map(t => ({ x: t.x, z: t.z, r: t.r + 0.4 })));
    const blocked = (x, z) => clear.some(c => (c.x - x) ** 2 + (c.z - z) ** 2 < c.r * c.r)
      || (state.terrain || []).some(t => (t.kind === 'ruin' && Math.abs(t.x - x) < t.w / 2 + 0.5 && Math.abs(t.z - z) < t.d / 2 + 0.5) || (t.kind === 'river' && Math.abs(t.x - x) < t.w / 2 + 0.4));
    const k = new Kit(41);
    const w = state.board?.w ?? 48, h = state.board?.h ?? 32;
    let n = 0;
    for (let j = 0; j * CELL < h; j++) for (let i = 0; i * CELL < w; i++) {
      const R = rng(i * 7919 + j * 104729 + 13);
      const x = (i + 0.2 + R() * 0.6) * CELL, z = (j + 0.2 + R() * 0.6) * CELL;
      const cov = blightAt(x, z);
      if (cov < 0.08 || R() > cov * cov * 0.32 || blocked(x, z) || n > 900) continue;
      n++;
      const ry = (R() - 0.5) * 0.7, lean = (R() - 0.5) * 0.3, kind = R();
      if (kind < 0.45) headstone(k, R, x, z, ry, lean, i + j);
      else if (kind < 0.72) cross(k, R, x, z, ry, lean, i + j);
      else if (kind < 0.88) bones(k, R, x, z);
      else stump(k, R, x, z);
    }
    if (!n) return;
    this.mesh = k.mesh(paintMat('terrain'));
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.layer.add(this.mesh);
  }
  destroy() { if (this.mesh) { this.layer.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; } this.sig = ''; setBlight([]); }
}
