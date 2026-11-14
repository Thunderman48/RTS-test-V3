// What my side has explored and sees right now, on a grid of 1" cells over the board.
// Display only: the sim keeps its own intel of enemy buildings (sim/vision.js).
import { RULES } from '../data/units.js';
import { canSee } from '../sim/vision.js';

export class FogMap {
  // w x h board (1" cells); your own third (zone) starts explored
  constructor(me, w = RULES.board.w, h = RULES.board.h, zone = RULES.buildZone) {
    this.me = me; this.w = w; this.h = h;
    const FW = w, FH = h;
    this.explored = new Uint8Array(FW * FH);
    this.visible = new Uint8Array(FW * FH);
    for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
      const x = i + 0.5;
      if (me === 0 ? x < zone : x > FW - zone) this.explored[j * FW + i] = 1;
    }
  }
  // obs: [{x, z, range}] -> visible cells (and they become explored)
  compute(terrain, obs) {
    const FW = this.w, FH = this.h;
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
  cell(x, z) { const i = Math.floor(x), j = Math.floor(z); return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i; }
  isVisible(x, z) { const k = this.cell(x, z); return k < 0 || !!this.visible[k]; }
  isExplored(x, z) { const k = this.cell(x, z); return k < 0 || !!this.explored[k]; }
  snapshot() { return this.explored.slice(); }
  restore(ex) { this.explored.set(ex); }
}
