// Stance plans: what a squad does when you don't control it. Built from what its side
// knew during planning (enemy positions at the start of the round), then run like orders.
//  guard   : strike enemies that come close (melee chases up to 8"); ranged volleys targets in range
//  hold    : stay put, all AP into defends
//  advance : (the default) fight the nearest enemy - squad, building or HQ alike - within
//            RULES.advanceEngage; otherwise march on: to its target point if it has one (then guard
//            there), else on the enemy HQ (searching its possible spots while unknown)
//  retreat : fall back to the nearest own Mine / Soul Well (else the HQ) and guard there
import { RULES, isMelee, isShooter } from '../data/units.js';
import { defOf, radiusOf, emptyPlan, apFor } from './state.js';
import { obstacles, navKey, hitRadius } from './base.js';
import { builderIdleTarget } from './builders.js';
import { knownEnemyHq, observers, canSee } from './vision.js';
import { HQ_X, mirrorOn } from '../data/maps.js';
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
    const gap = dist(q.x, q.z, e.x, e.z) - (e.r ?? radiusOf(e)) - radiusOf(q);
    if (gap <= maxGap && gap < bd) { bd = gap; best = e; }
  }
  return best;
}

// Move to striking distance of target e and swing at it (aimed at where it stands now).
// lead: optional {x,z} offset to aim where it is expected to be.
export function meleePlan(s, q, e, plan, left, lead = null) {
  const def = defOf(q);
  const r = radiusOf(q), re = e.r ?? radiusOf(e);
  const strike = def.attack.ap;
  const want = r + re + def.attack.reach * 0.55; // stop well inside reach
  const d = dist(q.x, q.z, e.x, e.z);
  let fromX = q.x, fromZ = q.z;
  if (d > want) {
    const nav = Nav.for(obstacles(s), r, navKey(s));
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
  if (q.role === 'builder') {
    // builders left alone keep at their task, finish a nearby site, or gather resources
    if (st === 'hold') return plan;
    const b = builderIdleTarget(s, q);
    if (b) plan.actions.push({ kind: 'work', x: b.x, z: b.z, ap: left });
    return plan;
  }
  const walkTo = (x, z, stop = 0) => {
    const nav = Nav.for(obstacles(s), radiusOf(q), navKey(s));
    const pts = trimPath(q.x, q.z, nav.path(q.x, q.z, x, z), stop);
    if (pts.length) plan.actions.push({ kind: 'move', pts, ap: left });
    return pts.length > 0;
  };
  // attack target t (a squad or a building target) with everything
  const attack = t => {
    if (isShooter(def)) {
      const range = def.attack.range, d = dist(q.x, q.z, t.x, t.z) - (t.r ?? radiusOf(t));
      if (d > range - 0.3) {
        // walk into range first (stopping inside it), then shoot with what is left
        const nav = Nav.for(obstacles(s), radiusOf(q), navKey(s));
        const pts = trimPath(q.x, q.z, nav.path(q.x, q.z, t.x, t.z), range * 0.8 + (t.r ?? radiusOf(t)));
        if (pts.length) plan.actions.push({ kind: 'move', pts, ap: left });
        return plan;
      }
      while (left >= def.attack.ap) { plan.actions.push({ kind: def.attack.kind, x: t.x, z: t.z }); left -= def.attack.ap; }
      fillDefends(plan, left);
      return plan;
    }
    if (def.parry && !t.building && nearestEnemy(s, q, [t], RULES.engageGap)) { plan.parry = true; left -= RULES.parryCost; }
    left = meleePlan(s, q, t, plan, left);
    fillDefends(plan, left);
    return plan;
  };

  if (st === 'advance') {
    // every enemy it knows of is a target, squads and buildings alike (the HQ too): the nearest wins
    const known = Object.values(s.intel?.[q.owner]?.known || {}).filter(b => b.hp > 0)
      .map(b => ({ id: b.id, owner: b.owner, x: b.x, z: b.z, r: hitRadius(b), building: true }));
    const t = nearestEnemy(s, q, enemies.concat(known), RULES.advanceEngage);
    if (t) return attack(t);
    if (q.goal) {
      // march to its target point, then guard there (fight what comes close)
      if (dist(q.x, q.z, q.goal.x, q.goal.z) > RULES.goalReach && walkTo(q.goal.x, q.goal.z)) return plan;
      return guardPlan(s, q, enemies, plan, left);
    }
    // no target point: march on the enemy HQ if we know where it is, else search its possible spots
    let hq = knownEnemyHq(s, q.owner);
    if (!hq) {
      const obs = observers(s, q.owner);
      const mirror = mirrorOn(s.board.w, s.board.h);
      const spots = s.hqSpots.map(z => q.owner === 0 ? mirror({ x: HQ_X, z }) : { x: HQ_X, z })
        .filter(sp => !obs.some(o => canSee(s.terrain, o.x, o.z, o.range, sp.x, sp.z)))
        .sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z));
      hq = spots[0] || { x: q.owner === 0 ? s.board.w - 8 : 8, z: s.board.h / 2 };
    }
    if (walkTo(hq.x, hq.z, 3.2)) return plan;
    return guardPlan(s, q, enemies, plan, left);
  }
  if (st === 'retreat') {
    // fall back to the nearest own mine / soul well (resource site), else the HQ, and guard there
    const home = (s.buildings || []).filter(b => b.owner === q.owner && b.hp > 0 && (b.type === 'mine' || b.type === 'well'))
      .sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0]
      || (s.buildings || []).find(b => b.owner === q.owner && b.type === 'hq' && b.hp > 0);
    if (home && dist(q.x, q.z, home.x, home.z) - hitRadius(home) > RULES.retreatReach) {
      if (walkTo(home.x, home.z, hitRadius(home) + radiusOf(q) + 0.6)) { const used = plan.actions.reduce((n, a) => n + a.ap, 0); fillDefends(plan, Math.max(0, apFor(q) - used)); return plan; }
    }
    return guardPlan(s, q, enemies, plan, left);
  }
  return guardPlan(s, q, enemies, plan, left);
}

// guard (and hold): fight what comes close; shooters volley what is in range or watch the nearest
function guardPlan(s, q, enemies, plan, left) {
  const def = defOf(q), st = q.stance;
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
    // guard: watch the nearest enemy's approach
    plan.overwatch = { x: e.x, z: e.z }; left -= RULES.overwatchCost;
    fillDefends(plan, left);
    return plan;
  }
  const t = nearestEnemy(s, q, enemies, GUARD_RANGE);
  // already in contact: prepare a parry before trading blows
  if (t && def.parry && nearestEnemy(s, q, enemies, RULES.engageGap)) { plan.parry = true; left -= RULES.parryCost; }
  if (t) left = meleePlan(s, q, t, plan, left);
  fillDefends(plan, left);
  return plan;
}
