// Fog of war: who can see whom.
//  - within the observer's vision range
//  - the line is not cut by walls or rocks
//  - it does not pass through more than FOREST_DEPTH inches of forest
//  - a target standing inside a forest is only seen from within FOREST_CLOSE inches
// Deterministic (sqrt only) so the resolver can use it for stance plans.
import { defOf } from './state.js';
import { segRect, segCircle, dist } from './geom.js';
import { blocks } from './nav.js';
import { hitRadius } from './base.js';

export const FOREST_DEPTH = 2;
export const FOREST_CLOSE = 4;

// length of the segment a->b inside circle (c, r)
function chordIn(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  if (L2 < 1e-9) return 0;
  const fx = ax - cx, fz = az - cz;
  const b = (fx * dx + fz * dz) / L2, c = (fx * fx + fz * fz - r * r) / L2;
  const disc = b * b - c;
  if (disc <= 0) return 0;
  const sq = Math.sqrt(disc);
  const t0 = Math.max(0, -b - sq), t1 = Math.min(1, -b + sq);
  return t1 > t0 ? (t1 - t0) * Math.sqrt(L2) : 0;
}

export function canSee(terrain, ox, oz, range, tx, tz, extra = []) {
  const d = dist(ox, oz, tx, tz);
  if (d > range) return false;
  for (const t of terrain) {
    if (t.kind === 'forest') {
      if (dist(tx, tz, t.x, t.z) < t.r && d > FOREST_CLOSE) return false;
      if (chordIn(ox, oz, tx, tz, t.x, t.z, t.r) > FOREST_DEPTH + (dist(tx, tz, t.x, t.z) < t.r ? FOREST_CLOSE : 0)) return false;
      continue;
    }
    if (!blocks(t)) continue;
    const tt = t.r !== undefined ? segCircle(ox, oz, tx, tz, t.x, t.z, t.r) : segRect(ox, oz, tx, tz, t, 0);
    if (tt >= 0 && tt < 1) return false;
  }
  for (const t of extra) {            // e.g. buildings
    const tt = t.r !== undefined ? segCircle(ox, oz, tx, tz, t.x, t.z, t.r) : segRect(ox, oz, tx, tz, t, 0);
    if (tt >= 0 && tt < 1) return false;
  }
  return true;
}

// observers of side p: its living squads (and later its buildings): [{x, z, range}]
export function observers(s, p) {
  const out = [];
  for (const q of s.squads) if (q.owner === p && q.hp > 0) out.push({ x: q.x, z: q.z, range: defOf(q).vision });
  for (const b of s.buildings || []) if (b.owner === p && b.hp > 0 && b.vision) out.push({ x: b.x, z: b.z, range: b.vision });
  return out;
}

// ids of enemy squads that side p sees right now
export function visibleTo(s, p, obs = observers(s, p)) {
  const seen = new Set();
  for (const e of s.squads) {
    if (e.owner === p || e.hp <= 0) continue;
    for (const o of obs) if (canSee(s.terrain, o.x, o.z, o.range, e.x, e.z)) { seen.add(e.id); break; }
  }
  return seen;
}

// ids of enemy buildings side p sees right now
export function buildingsSeenBy(s, p, obs = observers(s, p)) {
  const seen = new Set();
  for (const b of s.buildings || []) {
    if (b.owner === p || b.hp <= 0) continue;
    const r = hitRadius(b);
    for (const o of obs) if (canSee(s.terrain, o.x, o.z, o.range + r, b.x, b.z)) { seen.add(b.id); break; }
  }
  return seen;
}
// what each side knows about enemy buildings: remembered once seen, forgotten when seen gone
const snap = b => ({ id: b.id, owner: b.owner, type: b.type, rot: b.rot, x: b.x, z: b.z, w: b.w, d: b.d, r: b.r, hp: b.hp, build: b.build });
export function updateIntel(s) {
  s.intel = s.intel || [{ known: {} }, { known: {} }];
  markSeen(s);
  for (const p of [0, 1]) {
    const obs = observers(s, p), known = s.intel[p].known;
    for (const id of buildingsSeenBy(s, p, obs)) known[id] = snap(s.buildings.find(b => b.id === id));
    for (const id of Object.keys(known)) {
      if ((s.buildings || []).some(b => b.id === id && b.hp > 0)) continue;
      const k = known[id];
      if (obs.some(o => canSee(s.terrain, o.x, o.z, o.range + 1, k.x, k.z))) delete known[id];
    }
  }
}
// ground each side has seen at least once: s.explored[p], one char per 1" cell ('1' = seen). Buildings
// may only be placed on seen ground (placeError). Marked from every observer at each intel update.
export function markSeen(s) {
  if (!s.board || !s.explored) return;
  const W = s.board.w, H = s.board.h;
  for (const p of [0, 1]) {
    const g = s.explored[p].split('');
    let changed = false;
    for (const o of observers(s, p)) {
      const r = o.range + 0.5;
      const i0 = Math.max(0, Math.floor(o.x - r)), i1 = Math.min(W - 1, Math.floor(o.x + r));
      const j0 = Math.max(0, Math.floor(o.z - r)), j1 = Math.min(H - 1, Math.floor(o.z + r));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * W + i;
        if (g[k] === '1') continue;
        if (canSee(s.terrain, o.x, o.z, o.range + 0.5, i + 0.5, j + 0.5)) { g[k] = '1'; changed = true; }
      }
    }
    if (changed) s.explored[p] = g.join('');
  }
}
// a fresh map: each side has seen its own third of the table
export function initSeen(s) {
  const W = s.board.w, H = s.board.h, zone = s.board.zone;
  s.explored = [0, 1].map(p => { let out = ''; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const x = i + 0.5; out += (p === 0 ? x < zone : x > W - zone) ? '1' : '0'; } return out; });
  markSeen(s);
}
export const knownEnemyHq = (s, p) => Object.values((s.intel && s.intel[p].known) || {}).find(b => b.type === 'hq') || null;
