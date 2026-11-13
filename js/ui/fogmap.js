// What my side has explored and sees right now, on a grid of 1" cells over the board.
// Display only: the sim keeps its own intel of enemy buildings (sim/vision.js).
import { RULES } from '../data/units.js';
import { canSee } from '../sim/vision.js';

export const FW = RULES.board.w, FH = RULES.board.h;

export class FogMap {
  constructor(me) {
    this.me = me;
    this.explored = new Uint8Array(FW * FH);
    this.visible = new Uint8Array(FW * FH);
    // your own third of the table starts explored
    for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
      const x = i + 0.5;
      if (me === 0 ? x < RULES.buildZone : x > FW - RULES.buildZone) this.explored[j * FW + i] = 1;
    }
  }
  // obs: [{x, z, range}] -> visible cells (and they become explored)
  compute(terrain, obs) {
    this.visible.fill(0);
    for (const o of obs) {
      const r = o.range + 0.5;
      const i0 = Math.max(0, Math.floor(o.x - r)), i1 = Math.min(FW - 1, Math.floor(o.x + r));
      const j0 = Math.max(0, Math.floor(o.z - r)), j1 = Math.min(FH - 1, Math.floor(o.z + r));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * FW + i;
        if (this.visible[k]) continue;
        if (canSee(terrain, o.x, o.z, o.range + 0.5, i + 0.5, j + 0.5)) { this.visible[k] = 1; this.explored[k] = 1; }
      }
    }
    this.version = (this.version || 0) + 1;
  }
  cell(x, z) { const i = Math.floor(x), j = Math.floor(z); return i < 0 || j < 0 || i >= FW || j >= FH ? -1 : j * FW + i; }
  isVisible(x, z) { const k = this.cell(x, z); return k < 0 || !!this.visible[k]; }
  isExplored(x, z) { const k = this.cell(x, z); return k < 0 || !!this.explored[k]; }
  snapshot() { return this.explored.slice(); }
  restore(ex) { this.explored.set(ex); }
}
