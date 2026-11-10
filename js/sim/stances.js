// Stance plan builders. A stance builds a normal plan at the start of resolution using only
// what its owner knew during planning (the `view`), then it runs under the same rules as orders.
import { CONFIG } from '../config.js';
import { dist, norm, rot, ANG } from './geom.js';
import { apFor, moveSpeed, emptyPlan, retreatPoint, entRadius } from './state.js';
import { pathLength } from './nav.js';

const reachOf = (u, t) => CONFIG.unitRadius + entRadius(t) + CONFIG.meleeReach;

// AP needed to walk from unit to within `stopDist` of target point.
export function approachAP(nav, u, tx, tz, stopDist) {
  const sp = moveSpeed(u.type);
  const d = dist(u.x, u.z, tx, tz);
  if (d <= stopDist) return 0;
  let l = d;
  if (nav) { const p = nav.path(u.x, u.z, tx, tz); l = pathLength(u.x, u.z, p); }
  return Math.ceil(Math.max(0, l - stopDist) / sp) + 2;
}

function nearest(u, list, maxD, from = u) {
  let best = null, bd = 1e9;
  for (const e of list) {
    const d = dist(from.x, from.z, e.x, e.z) - entRadius(e);
    if (d <= maxD && d < bd) { bd = d; best = e; }
  }
  return best;
}

function fillDefends(u, plan, left) {
  const d = CONFIG.units[u.type];
  if (d.parry && !plan.parry && left >= CONFIG.parryCost) { plan.parry = true; left -= CONFIG.parryCost; }
  const n = Math.min(CONFIG.maxExtraDefends - plan.defends, Math.floor(left / CONFIG.extraDefendCost));
  if (n > 0) { plan.defends += n; left -= n * CONFIG.extraDefendCost; }
  return left;
}

function meleeAttackPlan(nav, u, target, budget, plan, leash = null) {
  const d = CONFIG.units[u.type];
  let left = budget;
  const need = approachAP(nav, u, target.x, target.z, reachOf(u, target) - 0.1);
  const moveAp = Math.min(need, Math.max(0, left - d.strike.ap));
  if (left < d.strike.ap) return left;
  plan.actions.push({ kind: 'attack', target: target.id, moveAp, ...(leash ? { leash } : {}) });
  left -= moveAp + d.strike.ap;
  // keep striking while AP allows
  while (left >= d.strike.ap + 6) {
    plan.actions.push({ kind: 'attack', target: target.id, moveAp: 6, ...(leash ? { leash } : {}) });
    left -= 6 + d.strike.ap;
  }
  return left;
}

function rangedFirePlan(u, target, budget, plan, spread) {
  const d = CONFIG.units[u.type];
  let left = budget;
  const dir = norm(target.x - u.x, target.z - u.z);
  const angles = spread ? CONFIG.stance.guardSpreadDeg : [0];
  let i = 0;
  while (left >= d.shot.ap) {
    const a = angles[i % angles.length];
    const cs = ANG[a] || ANG[0];
    const r = rot(dir.x, dir.z, cs[0], cs[1]);
    plan.actions.push({ kind: 'shoot', x: u.x + r.x * dir.l, z: u.z + r.z * dir.l });
    left -= d.shot.ap; i++;
  }
  return left;
}

// view: { units: [...enemy units visible at planning], buildings: [...] }
export function buildStancePlan(s, u, view, nav) {
  const def = CONFIG.units[u.type];
  const plan = emptyPlan();
  let left = apFor(u);
  const st = u.stance;
  const enemies = view.units;
  const enemyB = view.buildings;

  if (st === 'hold') {
    fillDefends(u, plan, left);
    return plan;
  }

  if (st === 'retreat') {
    const b = retreatPoint(s, u);
    if (b) {
      const r = CONFIG.buildings[b.type].r + CONFIG.unitRadius + 0.6;
      const dir = norm(u.x - b.x, u.z - b.z);
      const tx = b.x + (dir.l > 0 ? dir.x : 1) * r, tz = b.z + (dir.l > 0 ? dir.z : 0) * r;
      if (dist(u.x, u.z, tx, tz) > 0.8) { plan.actions.push({ kind: 'move', ap: left, x: tx, z: tz }); return plan; }
    }
    fillDefends(u, plan, left);
    return plan;
  }

  if (!def.melee) {
    // Ranged unit
    const range = def.shot.range;
    const anchorPt = st === 'holdground' ? (u.anchor || u) : u;
    const tgt = nearest(u, enemies, range) || nearest(u, enemyB, range);
    if (st === 'advance' && !tgt && u.anchor && dist(u.x, u.z, u.anchor.x, u.anchor.z) > 1.5) {
      plan.actions.push({ kind: 'move', ap: left, x: u.anchor.x, z: u.anchor.z });
      return plan;
    }
    if (tgt) {
      const isUnitT = tgt.id[0] === 'u';
      if (st === 'guard' || st === 'holdground') { plan.overwatch = 1; left -= CONFIG.overwatchCost; }
      left = rangedFirePlan(u, tgt, left, plan, isUnitT && st !== 'advance');
      fillDefends(u, plan, left);
    } else {
      plan.overwatch = 2; left -= 2 * CONFIG.overwatchCost;
      fillDefends(u, plan, left);
    }
    void anchorPt;
    return plan;
  }

  // Melee unit
  if (st === 'holdground') {
    const a = u.anchor || { x: u.x, z: u.z };
    const leash = { x: a.x, z: a.z, r: CONFIG.stance.holdGroundLeash };
    const tgt = nearest(u, enemies, leash.r + CONFIG.meleeReach + 2 * CONFIG.unitRadius, a);
    if (tgt) left = meleeAttackPlan(nav, u, tgt, left, plan, leash);
    else if (dist(u.x, u.z, a.x, a.z) > 0.6) {
      const need = approachAP(nav, u, a.x, a.z, 0);
      const ap = Math.min(need, left);
      plan.actions.push({ kind: 'move', ap, x: a.x, z: a.z });
      left -= ap;
    }
    fillDefends(u, plan, left);
    return plan;
  }

  const engage = st === 'advance' ? CONFIG.stance.advanceEngage : CONFIG.stance.guardRange;
  const tgt = nearest(u, enemies, engage) || nearest(u, enemyB, engage);
  if (tgt) {
    left = meleeAttackPlan(nav, u, tgt, left, plan);
    fillDefends(u, plan, left);
    return plan;
  }
  if (st === 'advance' && u.anchor && dist(u.x, u.z, u.anchor.x, u.anchor.z) > 1.5) {
    plan.actions.push({ kind: 'move', ap: left, x: u.anchor.x, z: u.anchor.z });
    return plan;
  }
  fillDefends(u, plan, left);
  return plan;
}
