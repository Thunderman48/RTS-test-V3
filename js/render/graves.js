// Undead graveyards on the table: dark grave soil with low-poly tombstones, crosses and bones,
// spreading around undead buildings (and left behind where they fell). One merged mesh, rebuilt only
// when the grave ground changes. Uses the terrain paint, so the fog covers unexplored graves.
import * as THREE from 'three';
import { FACTIONS } from '../data/units.js';
import { graveCircles } from '../sim/base.js';
import { Kit, paintMat } from './kit.js';
import { rng } from '../sim/rng.js';

const SOIL = [0x3b3330, 0x463b36, 0x352d2b];
const STONE = [0x8d8a86, 0x7a7774, 0x9a968f];
const BONE = 0xe0d8c2, MOSS = 0x5f6b44;

export class GraveLayer {
  constructor(layer) { this.layer = layer; this.mesh = null; this.sig = ''; }
  // state: the game state to draw (planning), or the replay's starting state
  update(state) {
    const circles = [];
    for (const p of [0, 1]) if (state.players && FACTIONS[state.players[p].faction].graves) circles.push(...graveCircles(state, p));
    const sig = circles.map(c => `${c.x},${c.z},${c.r.toFixed(2)}`).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    if (this.mesh) { this.layer.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (!circles.length) return;
    const k = new Kit(41);
    for (const c of circles) {
      const R = rng(Math.round(c.x * 73 + c.z * 131) + 7);
      // grave soil: a few overlapping flat, faceted discs (never perfectly round)
      k.cyl(c.r, c.r + 0.15, 0.03, SOIL[0], { x: c.x, y: 0.035, z: c.z, j: Math.min(0.2, c.r * 0.04), sh: 0.06 }, Math.max(9, Math.round(c.r * 4)));
      for (let i = 0; i < Math.round(c.r * 1.2); i++) {
        const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * c.r * 0.75, s = 0.5 + R() * Math.min(1.6, c.r * 0.25);
        k.cyl(s, s + 0.1, 0.03, SOIL[1 + (i % 2)], { x: c.x + Math.cos(a) * rr, y: 0.045, z: c.z + Math.sin(a) * rr, j: 0.06, sh: 0.05 }, 7);
      }
      // headstones, crosses and bones, more on bigger graveyards
      const n = Math.min(70, Math.round(c.r * c.r * 0.5) + 2);
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * (c.r - 0.25);
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr, ry = (R() - 0.5) * 0.6, lean = (R() - 0.5) * 0.25;
        const kind = R();
        if (kind < 0.5) {
          const h = 0.32 + R() * 0.22;
          k.box(0.26, h, 0.08, STONE[i % 3], { x, y: h / 2 + 0.04, z, ry, rz: lean, j: 0.02, sh: 0.08 });
          k.cyl(0.04, 0.04, 0.02, 0x2a2420, { x: x + 0.12, y: 0.05, z: z + 0.2, sh: 0.05 }, 5);   // dirt mound in front
          k.box(0.24, 0.05, 0.42, SOIL[2], { x: x + Math.sin(ry) * 0.25, y: 0.06, z: z + Math.cos(ry) * 0.25, ry, j: 0.02, sh: 0.05 });
        } else if (kind < 0.78) {
          const h = 0.42 + R() * 0.15;
          k.box(0.06, h, 0.06, 0x6d5a45, { x, y: h / 2 + 0.04, z, ry, rz: lean, sh: 0.06 });
          k.box(0.24, 0.06, 0.06, 0x6d5a45, { x, y: h * 0.72 + 0.04, z, ry, rz: lean, sh: 0.06 });
        } else if (kind < 0.92) {
          k.box(0.3, 0.025, 0.06, BONE, { x, y: 0.06, z, ry: R() * 3, sh: 0.05 });
          k.ball(0.06, BONE, { x: x + 0.15, y: 0.07, z, sy: 0.8 });
        } else {
          k.ball(0.12, MOSS, { x, y: 0.07, z, sy: 0.5, j: 0.03 });
        }
      }
    }
    this.mesh = k.mesh(paintMat('terrain'));
    this.mesh.receiveShadow = true;
    this.layer.add(this.mesh);
  }
  destroy() { if (this.mesh) { this.layer.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; } this.sig = ''; }
}
