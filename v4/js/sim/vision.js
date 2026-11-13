// Fog of war: who can see whom.
//  - within the observer's vision range
//  - the line is not cut by walls or rocks
//  - it does not pass through more than FOREST_DEPTH inches of forest
//  - a target standing inside a forest is only seen from within FOREST_CLOSE inches
// Deterministic (sqrt only) so the resolver can use it for stance plans.
import { defOf } from './state.js';
import { segRect, segCircle, dist } from './geom.js';
import { blocks } from './nav.js';

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
