// Coarse navigation grid + A* with path smoothing.
// Units walk around walls and buildings; other units are handled by local steering.
import { CONFIG } from '../config.js';
import { inRect, dist } from './geom.js';

export class Nav {
  constructor(state) {
    const { w, h, navCell } = CONFIG.map;
    this.cell = navCell;
    this.cols = Math.round(w / navCell);
    this.rows = Math.round(h / navCell);
    this.w = w; this.h = h;
    this.blocked = new Uint8Array(this.cols * this.rows);
    const r = CONFIG.unitRadius + 0.05;
    this.walls = state.map.walls;
    this.obstacles = state.buildings.filter(b => b.hp > 0).map(b => ({ x: b.x, z: b.z, r: CONFIG.buildings[b.type].r }));
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const x = (i + 0.5) * navCell, z = (j + 0.5) * navCell;
        let b = x < r || z < r || x > w - r || z > h - r;
        if (!b) for (const wl of this.walls) if (inRect(x, z, wl, r)) { b = true; break; }
        if (!b) for (const o of this.obstacles) if (dist(x, z, o.x, o.z) < o.r + r) { b = true; break; }
        this.blocked[j * this.cols + i] = b ? 1 : 0;
      }
    }
  }

  // Is a world point walkable for a unit (static obstacles only)?
  free(x, z) {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return false;
    const r = CONFIG.unitRadius;
    if (x < r || z < r || x > this.w - r || z > this.h - r) return false;
    for (const wl of this.walls) if (inRect(x, z, wl, r)) return false;
    for (const o of this.obstacles) if (dist(x, z, o.x, o.z) < o.r + r) return false;
    return true;
  }

  idx(x, z) {
    let i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    i = Math.max(0, Math.min(this.cols - 1, i)); j = Math.max(0, Math.min(this.rows - 1, j));
    return j * this.cols + i;
  }

  center(k) { return { x: ((k % this.cols) + 0.5) * this.cell, z: (Math.floor(k / this.cols) + 0.5) * this.cell }; }

  nearestFree(k) {
    if (!this.blocked[k]) return k;
    const ci = k % this.cols, cj = Math.floor(k / this.cols);
    for (let rad = 1; rad < 20; rad++) {
      let best = -1, bd = 1e9;
      for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue;
        const kk = j * this.cols + i;
        if (!this.blocked[kk]) { const d = di * di + dj * dj; if (d < bd) { bd = d; best = kk; } }
      }
      if (best >= 0) return best;
    }
    return k;
  }

  // straight-line walkability check sampled along the segment
  lineFree(ax, az, bx, bz) {
    const d = dist(ax, az, bx, bz);
    const n = Math.ceil(d / (this.cell * 0.5));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      if (this.blocked[this.idx(ax + (bx - ax) * t, az + (bz - az) * t)]) return false;
    }
    return true;
  }

  // Returns list of waypoints [{x,z}...] ending at (approximately) target.
  path(ax, az, bx, bz) {
    if (this.lineFree(ax, az, bx, bz) && !this.blocked[this.idx(bx, bz)]) return [{ x: bx, z: bz }];
    const start = this.nearestFree(this.idx(ax, az));
    const goalRaw = this.idx(bx, bz);
    const goal = this.nearestFree(goalRaw);
    const goalPt = goal === goalRaw ? { x: bx, z: bz } : this.center(goal);
    const N = this.cols * this.rows;
    const g = new Float32Array(N).fill(1e9);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const gc = this.center(goal);
    const hfn = k => { const c = this.center(k); const dx = Math.abs(c.x - gc.x), dz = Math.abs(c.z - gc.z); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    g[start] = 0; heap.push(start, hfn(start));
    const C = this.cols;
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false, iter = 0;
    while (heap.size && iter++ < 20000) {
      const k = heap.pop();
      if (k === goal) { found = true; break; }
      if (closed[k]) continue;
      closed[k] = 1;
      const i = k % C, j = (k - i) / C;
      for (const [di, dj, c] of nb) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= C || nj >= this.rows) continue;
        const kk = nj * C + ni;
        if (this.blocked[kk] || closed[kk]) continue;
        if (di && dj && (this.blocked[j * C + ni] || this.blocked[nj * C + i])) continue; // no corner cutting
        const ng = g[k] + c * this.cell;
        if (ng < g[kk]) { g[kk] = ng; came[kk] = k; heap.push(kk, ng + hfn(kk)); }
      }
    }
    if (!found) return [{ x: bx, z: bz }];
    const cells = [];
    for (let k = goal; k !== -1 && k !== start; k = came[k]) cells.push(this.center(k));
    cells.reverse();
    if (cells.length) cells[cells.length - 1] = goalPt; else cells.push(goalPt);
    // string pulling
    const out = [];
    let cx = ax, cz = az, idx = 0;
    while (idx < cells.length) {
      let far = idx;
      for (let k = cells.length - 1; k > idx; k--) {
        if (this.lineFree(cx, cz, cells[k].x, cells[k].z)) { far = k; break; }
      }
      out.push(cells[far]);
      cx = cells[far].x; cz = cells[far].z; idx = far + 1;
    }
    return out;
  }
}

export function pathLength(ax, az, pts) {
  let l = 0, x = ax, z = az;
  for (const p of pts) { l += dist(x, z, p.x, p.z); x = p.x; z = p.z; }
  return l;
}

// Walk `d` distance along a path from (ax,az). Returns end point.
export function walkPath(ax, az, pts, d) {
  let x = ax, z = az;
  for (const p of pts) {
    const s = dist(x, z, p.x, p.z);
    if (s >= d) { const t = s > 0 ? d / s : 0; return { x: x + (p.x - x) * t, z: z + (p.z - z) * t }; }
    d -= s; x = p.x; z = p.z;
  }
  return { x, z };
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p; K.push(k); P.push(p);
    let i = K.length - 1;
    while (i > 0) { const pa = (i - 1) >> 1; if (P[pa] <= P[i]) break; [K[pa], K[i]] = [K[i], K[pa]]; [P[pa], P[i]] = [P[i], P[pa]]; i = pa; }
  }
  pop() {
    const K = this.k, P = this.p; const top = K[0];
    const lk = K.pop(), lp = P.pop();
    if (K.length) {
      K[0] = lk; P[0] = lp; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < K.length && P[l] < P[m]) m = l;
        if (r < K.length && P[r] < P[m]) m = r;
        if (m === i) break;
        [K[m], K[i]] = [K[i], K[m]]; [P[m], P[i]] = [P[i], P[m]]; i = m;
      }
    }
    return top;
  }
}
