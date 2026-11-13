// Navigation grid + weighted A* (slow terrain costs more) + path smoothing.
// One grid per squad size (blocking terrain is inflated by the squad's radius).
import { RULES } from '../data/units.js';
import { inRect, dist } from './geom.js';

const CELL = 0.5;
const cache = new Map();

// Movement factor at a point (1 = normal, <1 slower)
export function terrainFactor(terrain, x, z) {
  let f = 1;
  for (const t of terrain) {
    if (t.kind === 'forest' && dist(x, z, t.x, t.z) <= t.r) f = Math.min(f, 0.6);
    else if (t.kind === 'river' && inRect(x, z, t)) {
      const ford = (t.fords || []).some(fd => Math.abs(z - fd.z) <= fd.d / 2);
      if (!ford) f = Math.min(f, 0.5);
    }
  }
  return f;
}

export function blocks(t) { return t.kind === 'ruin' || t.kind === 'rock' || t.kind === 'building'; }

export function pointBlocked(terrain, x, z, r) {
  const W = RULES.board.w, H = RULES.board.h;
  if (x < r || z < r || x > W - r || z > H - r) return true;
  for (const t of terrain) {
    if (!blocks(t)) continue;
    if (t.r !== undefined ? dist(x, z, t.x, t.z) < t.r + r : inRect(x, z, t, r)) return true;
  }
  return false;
}

export class Nav {
  // terrain: array of terrain pieces (+ buildings as {kind:'building', x, z, r})
  static for(terrain, radius, key = '') {
    const k = key + ':' + radius.toFixed(2);
    if (!cache.has(k)) { if (cache.size > 80) cache.clear(); cache.set(k, new Nav(terrain, radius)); }
    return cache.get(k);
  }
  static clear() { cache.clear(); }

  constructor(terrain, radius) {
    const W = RULES.board.w, H = RULES.board.h;
    this.terrain = terrain; this.r = radius;
    this.cols = Math.round(W / CELL); this.rows = Math.round(H / CELL);
    const N = this.cols * this.rows;
    this.blocked = new Uint8Array(N);
    this.cost = new Float32Array(N);
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++) {
      const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL, k = j * this.cols + i;
      this.blocked[k] = pointBlocked(terrain, x, z, radius) ? 1 : 0;
      this.cost[k] = 1 / terrainFactor(terrain, x, z);
    }
  }
  free(x, z) { return !pointBlocked(this.terrain, x, z, this.r); }
  idx(x, z) {
    const i = Math.max(0, Math.min(this.cols - 1, Math.floor(x / CELL)));
    const j = Math.max(0, Math.min(this.rows - 1, Math.floor(z / CELL)));
    return j * this.cols + i;
  }
  center(k) { return { x: ((k % this.cols) + 0.5) * CELL, z: (Math.floor(k / this.cols) + 0.5) * CELL }; }
  nearestFree(k) {
    if (!this.blocked[k]) return k;
    const ci = k % this.cols, cj = Math.floor(k / this.cols);
    for (let rad = 1; rad < 30; rad++) {
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
  // straight line is walkable and doesn't cross slower ground than its start (keeps smoothing honest)
  lineOk(ax, az, bx, bz) {
    const d = dist(ax, az, bx, bz);
    const n = Math.ceil(d / (CELL * 0.5));
    const c0 = this.cost[this.idx(ax, az)];
    for (let s = 1; s <= n; s++) {
      const t = s / n, k = this.idx(ax + (bx - ax) * t, az + (bz - az) * t);
      if (this.blocked[k] || this.cost[k] > c0 + 1e-6) return false;
    }
    return true;
  }
  path(ax, az, bx, bz) {
    const start = this.nearestFree(this.idx(ax, az));
    const goalRaw = this.idx(bx, bz), goal = this.nearestFree(goalRaw);
    const goalPt = goal === goalRaw ? { x: bx, z: bz } : this.center(goal);
    if (this.lineOk(ax, az, goalPt.x, goalPt.z)) return [goalPt];
    const C = this.cols, N = C * this.rows;
    const g = new Float32Array(N).fill(1e9), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const gc = this.center(goal);
    const h = k => { const c = this.center(k); const dx = Math.abs(c.x - gc.x), dz = Math.abs(c.z - gc.z); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    const heap = new Heap();
    g[start] = 0; heap.push(start, h(start));
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false, it = 0;
    while (heap.size && it++ < 40000) {
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
        if (di && dj && (this.blocked[j * C + ni] || this.blocked[nj * C + i])) continue;
        const ng = g[k] + c * CELL * (this.cost[k] + this.cost[kk]) / 2;
        if (ng < g[kk]) { g[kk] = ng; came[kk] = k; heap.push(kk, ng + h(kk)); }
      }
    }
    if (!found) return [goalPt];
    const cells = [];
    for (let k = goal; k !== -1 && k !== start; k = came[k]) cells.push(this.center(k));
    cells.reverse();
    if (cells.length) cells[cells.length - 1] = goalPt; else cells.push(goalPt);
    const out = [];
    let cx = ax, cz = az, idx = 0;
    while (idx < cells.length) {
      let far = idx;
      for (let k = cells.length - 1; k > idx; k--) if (this.lineOk(cx, cz, cells[k].x, cells[k].z)) { far = k; break; }
      out.push(cells[far]); cx = cells[far].x; cz = cells[far].z; idx = far + 1;
    }
    return out;
  }
}

// AP needed to walk a path for a squad with the given base tier (terrain-aware)
export function pathAP(terrain, ax, az, pts, tier) {
  const sp = tier * RULES.moveFactor;
  let ap = 0, x = ax, z = az;
  for (const p of pts) {
    const d = dist(x, z, p.x, p.z), n = Math.max(1, Math.ceil(d / 0.25));
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n;
      ap += (d / n) / (sp * terrainFactor(terrain, x + (p.x - x) * t, z + (p.z - z) * t));
    }
    x = p.x; z = p.z;
  }
  return ap;
}

// Walk along pts spending at most `ap`; returns the end point and the polyline walked
export function walkAP(terrain, ax, az, pts, ap, tier) {
  const sp = tier * RULES.moveFactor;
  let x = ax, z = az, left = ap;
  const line = [{ x, z }];
  for (const p of pts) {
    while (left > 1e-6) {
      const dx = p.x - x, dz = p.z - z, d = Math.sqrt(dx * dx + dz * dz);
      if (d < 1e-6) break;
      const step = Math.min(0.25, d);
      const f = terrainFactor(terrain, x + dx / d * step / 2, z + dz / d * step / 2);
      const cost = step / (sp * f);
      if (cost > left) { const s = left * sp * f; x += dx / d * s; z += dz / d * s; left = 0; break; }
      x += dx / d * step; z += dz / d * step; left -= cost;
    }
    line.push({ x, z });
    if (left <= 1e-6) break;
  }
  return { x, z, line, left };
}

class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p; K.push(k); P.push(p);
    let i = K.length - 1;
    while (i > 0) { const a = (i - 1) >> 1; if (P[a] <= P[i]) break; [K[a], K[i]] = [K[i], K[a]]; [P[a], P[i]] = [P[i], P[a]]; i = a; }
  }
  pop() {
    const K = this.k, P = this.p, top = K[0], lk = K.pop(), lp = P.pop();
    if (K.length) {
      K[0] = lk; P[0] = lp; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < K.length && P[l] < P[m]) m = l; if (r < K.length && P[r] < P[m]) m = r; if (m === i) break; [K[m], K[i]] = [K[i], K[m]]; [P[m], P[i]] = [P[i], P[m]]; i = m; }
    }
    return top;
  }
}
