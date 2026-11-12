// Stance plans: what a squad does when you don't control it. Built from what its side
// knew during planning (enemy positions at the start of the round), then run like orders.
//  guard   : strike enemies that come close (melee chases up to 8"); ranged volleys targets in range
//  hold    : stay put, all AP into defends
//  advance : like guard, but walks toward the nearest enemy when nobody is in reach
import { RULES, isMelee, isShooter } from '../data/units.js';
import { defOf, radiusOf, emptyPlan, apFor } from './state.js';
import { Nav, pathAP, walkAP } from './nav.js';
import { dist } from './geom.js';

const GUARD_RANGE = 8;

function fillDefends(plan, left) {
  const n = Math.min(RULES.maxDefends - plan.defends, Math.floor(left / RULES.defendCost));
  if (n > 0) plan.defends += n;
}

export function nearestEnemy(s, q, enemies, maxGap = 1e9) {
  let best = null, bd = 1e9;
  for (const e of enemies) {
    const gap = dist(q.x, q.z, e.x, e.z) - radiusOf(e) - radiusOf(q);
    if (gap <= maxGap && gap < bd) { bd = gap; best = e; }
  }
  return best;
}

// Move to striking distance of target e and swing at it (aimed at where it stands now).
// lead: optional {x,z} offset to aim where it is expected to be.
export function meleePlan(s, q, e, plan, left, lead = null) {
  const def = defOf(q);
  const r = radiusOf(q), re = radiusOf(e);
  const strike = def.attack.ap;
  const want = r + re + def.attack.reach * 0.55; // stop well inside reach
  const d = dist(q.x, q.z, e.x, e.z);
  let fromX = q.x, fromZ = q.z;
  if (d > want) {
    const nav = Nav.for(s.terrain, r, 'r');
    const pts = nav.path(q.x, q.z, e.x, e.z);
    // stop `want` short of the target
    const full = pathAP(s.terrain, q.x, q.z, pts, def.tier);
    const cut = trimPath(q.x, q.z, pts, want);
    const ap = Math.ceil(pathAP(s.terrain, q.x, q.z, cut, def.tier)) + 1;
    if (ap + strike > left) {
      // can't strike this round: walk toward it with everything
      plan.actions.push({ kind: 'move', pts: cut.length ? cut : pts, ap: left });
      void full;
      return 0;
    }
    plan.actions.push({ kind: 'move', pts: cut, ap });
    left -= ap;
    const end = walkAP(s.terrain, q.x, q.z, cut, ap, def.tier);
    fromX = end.x; fromZ = end.z;
  }
  const ax = e.x + (lead ? lead.x : 0), az = e.z + (lead ? lead.z : 0);
  while (left >= strike) {
    plan.actions.push({ kind: 'swing', x: ax, z: az });
    left -= strike;
  }
  void fromX; void fromZ;
  return left;
}

// polyline from (ax,az) through pts, shortened by `cut` at the end
export function trimPath(ax, az, pts, cut) {
  const all = [{ x: ax, z: az }, ...pts];
  let total = 0;
  for (let i = 1; i < all.length; i++) total += dist(all[i - 1].x, all[i - 1].z, all[i].x, all[i].z);
  let keep = total - cut;
  if (keep <= 0.05) return [];
  const out = [];
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1], b = all[i], l = dist(a.x, a.z, b.x, b.z);
    if (l >= keep) { const t = keep / l; out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); return out; }
    keep -= l; out.push(b);
  }
  return out;
}

export function buildStancePlan(s, q, enemies) {
  const def = defOf(q);
  const plan = emptyPlan();
  let left = apFor(q);
  const st = q.stance;
  if (st === 'hold' || !enemies.length) { fillDefends(plan, left); return plan; }
  if (isShooter(def)) {
    const range = def.attack.range;
    const t = nearestEnemy(s, q, enemies, range);
    if (t) {
      while (left >= def.attack.ap) { plan.actions.push({ kind: def.attack.kind, x: t.x, z: t.z }); left -= def.attack.ap; }
      fillDefends(plan, left);
      return plan;
    }
    const e = nearestEnemy(s, q, enemies);
    if (st === 'advance') {
      const nav = Nav.for(s.terrain, radiusOf(q), 'r');
      const pts = trimPath(q.x, q.z, nav.path(q.x, q.z, e.x, e.z), range * 0.8);
      if (pts.length) { plan.actions.push({ kind: 'move', pts, ap: left }); return plan; }
    }
    // guard: watch the nearest enemy's approach
    plan.overwatch = { x: e.x, z: e.z }; left -= RULES.overwatchCost;
    fillDefends(plan, left);
    return plan;
  }
  const t = nearestEnemy(s, q, enemies, st === 'advance' ? 1e9 : GUARD_RANGE);
  // already in contact: prepare a parry before trading blows
  if (t && def.parry && nearestEnemy(s, q, enemies, RULES.engageGap)) { plan.parry = true; left -= RULES.parryCost; }
  if (t) left = meleePlan(s, q, t, plan, left);
  fillDefends(plan, left);
  return plan;
}
