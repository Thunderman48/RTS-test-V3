// Builders: walk next to a site and spend the AP that is left as work.
// Shared by the planner UI and the AI so both make the same orders.
import { RULES } from '../data/units.js';
import { defOf, radiusOf } from './state.js';
import { obstacles, navKey, footprint, edgeDist, gatherRate, bdef } from './base.js';
import { Nav, pathAP, pointBlocked } from './nav.js';
import { dist, norm } from './geom.js';

// closest point of a footprint ({x,z,r} or {x,z,w,d}) to (x,z)
function closestOn(f, x, z) {
  if (f.r !== undefined) { const d = norm(x - f.x, z - f.z); return d.l < 1e-6 ? { x: f.x + f.r, z: f.z } : { x: f.x + d.x * f.r, z: f.z + d.z * f.r }; }
  return { x: Math.max(f.x - f.w / 2, Math.min(f.x + f.w / 2, x)), z: Math.max(f.z - f.d / 2, Math.min(f.z + f.d / 2, z)) };
}

// a free spot touching the footprint, on the side facing (fromX, fromZ)
export function approachSpot(s, f, fromX, fromZ, rq, selfId = null) {
  const obs = obstacles(s);
  const c = closestOn(f, fromX, fromZ);
  let d = norm(fromX - c.x, fromZ - c.z);
  if (d.l < 1e-6) d = norm(fromX - f.x, fromZ - f.z);
  if (d.l < 1e-6) d = { x: 1, z: 0, l: 1 };
  const base = Math.atan2(d.z, d.x);
  const gap = rq + 0.3;
  for (let k = 0; k < 16; k++) {
    const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8;
    const px = f.x + Math.cos(a) * 50, pz = f.z + Math.sin(a) * 50;
    const e = closestOn(f, px, pz);
    const v = norm(px - e.x, pz - e.z);
    const x = e.x + v.x * gap, z = e.z + v.z * gap;
    if (x < rq || z < rq || x > s.board.w - rq || z > s.board.h - rq) continue;
    if (pointBlocked(obs, x, z, rq * 0.85)) continue;
    if (s.squads.some(o => o.hp > 0 && o.id !== selfId && dist(o.x, o.z, x, z) < rq + radiusOf(o) - 0.1)) continue;
    return { x, z };
  }
  return null;
}

// orders for builder q to work on a footprint f (a new site or an existing building): one
// self-contained `work` action (the resolver walks there and works); plus an estimate for previews
// { actions, arrive (AP walking), work (AP of work), reach (bool), pts (the walk) }
export function builderPlan(s, q, f, apLeft) {
  const rq = radiusOf(q), tier = defOf(q).tier;
  const actions = [{ kind: 'work', x: f.x, z: f.z, ap: apLeft }];
  if (edgeDist(f, q.x, q.z) - rq <= RULES.workReach) return { actions, arrive: 0, work: apLeft, reach: true, end: { x: q.x, z: q.z }, pts: [] };
  const spot = approachSpot(s, f, q.x, q.z, rq, q.id);
  if (!spot) return { actions: [], arrive: 0, work: 0, reach: false, end: { x: q.x, z: q.z } };
  const nav = Nav.for(obstacles(s), rq, navKey(s));
  const pts = nav.path(q.x, q.z, spot.x, spot.z);
  if (!pts.length) return { actions: [], arrive: 0, work: 0, reach: false, end: { x: q.x, z: q.z } };
  const walk = Math.ceil(pathAP(s.terrain, q.x, q.z, pts, tier));
  return { actions, arrive: Math.min(apLeft, walk), work: Math.max(0, apLeft - walk), reach: walk <= apLeft, end: spot, pts };
}
// buildings builder q could gather at, nearest first, that still have a free slot
export function gatherTarget(s, q) {
  const taken = b => s.squads.filter(o => o.id !== q.id && o.hp > 0 && o.owner === q.owner && o.task && o.task.kind === 'gather' && o.task.bid === b.id).length;
  return (s.buildings || []).filter(b => b.owner === q.owner && gatherRate(s, b) && taken(b) < RULES.gatherSlots)
    .sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0] || null;
}
// what a builder does with no orders: keep at its task, finish a nearby site, else gather
export function builderIdleTarget(s, q) {
  const tb = q.task && (s.buildings || []).find(b => b.id === q.task.bid && b.hp > 0 && b.owner === q.owner);
  if (tb && (tb.build > 0 || tb.hp < bdef(tb).hp || (q.task.kind === 'gather' && gatherRate(s, tb)))) return tb;
  const site = (s.buildings || []).filter(b => b.owner === q.owner && b.hp > 0 && b.build > 0 && dist(q.x, q.z, b.x, b.z) < 12)
    .sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0];
  return site || gatherTarget(s, q);
}
export const footprintOf = b => b.w !== undefined || b.r !== undefined ? b : footprint(b.type, b.x, b.z, b.rot || 0);
